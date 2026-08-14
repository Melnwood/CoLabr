// Co·labr — invoice an organization for its seats. This is the Josiah Venture
// shape: nobody on staff pays personally, the org is billed once for everyone,
// and their people stay marked Org Covered so the trial clock never touches them.
//
// Admins only, and it DRAFTS by default — an invoice is not sent to a real finance
// department because a script felt like it.
const { sessionFromEvent, isAdmin } = require('./_auth');
const { stripe } = require('./_stripe');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const sess = sessionFromEvent(event);
  if (!sess || !isAdmin(sess.email)) return r(403, { error: 'Admins only.' });
  const s = stripe();
  if (!s) return r(503, { error: 'Payments aren’t switched on yet.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }

  const org = String(b.org || '').trim();
  const email = String(b.email || '').trim();
  const seats = Math.max(1, parseInt(b.seats, 10) || 0);
  const price = b.price || process.env.STRIPE_PRICE_ID;
  if (!org || !email) return r(400, { error: 'Which organization, and which billing email?' });
  if (!price) return r(503, { error: 'No plan has been set up yet.' });

  try {
    // One customer per organization, found by email so re-running never forks it.
    const found = await s.customers.list({ email, limit: 1 });
    const customer = found.data[0] || await s.customers.create({ name: org, email, metadata: { colabr_org: org } });

    const invoice = await s.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: Number.isFinite(+b.daysUntilDue) ? +b.daysUntilDue : 30,
      auto_advance: false,
      description: `Co·labr — ${seats} seat${seats === 1 ? '' : 's'} for ${org}`,
      metadata: { colabr_org: org, seats: String(seats) }
    });
    await s.invoiceItems.create({ customer: customer.id, invoice: invoice.id, price, quantity: seats });

    // Drafted, not sent. Someone reads it first.
    if (b.send === true) {
      const sent = await s.invoices.sendInvoice(invoice.id);
      return r(200, { ok: true, sent: true, id: sent.id, url: sent.hosted_invoice_url, total: sent.total });
    }
    const fresh = await s.invoices.retrieve(invoice.id);
    return r(200, { ok: true, sent: false, id: fresh.id, url: fresh.hosted_invoice_url || '', total: fresh.total,
      note: 'Drafted only. Review it in Stripe, then send it from there or call again with send:true.' });
  } catch (e) {
    console.log('stripe-invoice', String(e && e.message || e));
    return r(502, { error: e.message || 'Could not create the invoice.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
