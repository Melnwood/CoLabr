// Co·labr — the only thing that is allowed to say somebody has paid.
//
// Fulfilment does NOT happen on the success page. A browser can be closed, a
// redirect can be lost, and some payment methods settle hours later. Stripe tells
// us here, and here is where "Paid Until" gets written — which is the one field
// _billing.js consults before it freezes, hides or deletes anything.
const { stripe } = require('./_stripe');
const B = require('./_billing');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const s = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s || !secret) return { statusCode: 503, body: 'Not configured' };

  // The signature is checked against the EXACT bytes Stripe sent. Netlify may
  // hand them to us base64-encoded, so decode rather than re-serialise — parsing
  // and re-stringifying the JSON would change the bytes and fail every time.
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : (event.body || '');
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];

  let evt;
  try {
    evt = s.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    // An unverified event is not a Stripe event. Never act on it.
    console.log('stripe-webhook BAD SIGNATURE', String(e && e.message || e));
    return { statusCode: 400, body: 'Bad signature' };
  }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return { statusCode: 500, body: 'No Airtable token' };
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  try {
    switch (evt.type) {
      // Checkout finished. Card payments are already paid; bank debits and other
      // delayed methods are not — hence the gate. The async twin below catches those.
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const cs = evt.data.object;
        if (cs.payment_status !== 'paid' && cs.payment_status !== 'no_payment_required') break;
        const id = cs.client_reference_id || (cs.metadata && cs.metadata.airtable_id);
        if (!id) break;
        let until = '';
        if (cs.subscription) {
          const sub = await s.subscriptions.retrieve(cs.subscription);
          until = periodEnd(sub);
          await patch(auth, id, { 'Stripe Subscription': sub.id, 'Stripe Customer': String(cs.customer || '') });
        }
        await markPaid(auth, id, until);
        console.log('stripe-webhook paid', id, until);
        break;
      }

      // Every renewal lands here. This is what keeps a long-standing subscriber
      // from quietly falling off the end of their paid-until date.
      case 'invoice.paid': {
        const inv = evt.data.object;
        const subId = inv.subscription || (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription);
        if (!subId) break;
        const sub = await s.subscriptions.retrieve(subId);
        const id = (sub.metadata && sub.metadata.airtable_id) || await findByCustomer(auth, sub.customer);
        if (!id) break;
        await markPaid(auth, id, periodEnd(sub));
        console.log('stripe-webhook renewed', id);
        break;
      }

      // A failed payment does NOT cut anyone off. Stripe retries for days, and our
      // own clock gives a fortnight of grace after that. Recorded, not acted on.
      case 'invoice.payment_failed': {
        const inv = evt.data.object;
        console.log('stripe-webhook payment failed', inv.customer, inv.id);
        break;
      }

      // Cancelled, or ended. We leave Paid Until where it is: they paid through
      // that date and they keep every day of it. The clock takes over afterwards.
      case 'customer.subscription.deleted': {
        const sub = evt.data.object;
        const id = (sub.metadata && sub.metadata.airtable_id) || await findByCustomer(auth, sub.customer);
        if (id) await patch(auth, id, { 'Stripe Subscription': '' });
        console.log('stripe-webhook cancelled', id);
        break;
      }

      // Plan changes, pauses, resumes — keep the paid-through date honest.
      case 'customer.subscription.updated': {
        const sub = evt.data.object;
        const id = (sub.metadata && sub.metadata.airtable_id) || await findByCustomer(auth, sub.customer);
        if (!id) break;
        if (['active', 'trialing'].includes(sub.status)) await markPaid(auth, id, periodEnd(sub));
        break;
      }

      default: break;   // everything else is none of our business
    }
  } catch (e) {
    // A 500 makes Stripe retry, which is what we want for a transient failure.
    console.log('stripe-webhook EXCEPTION', evt && evt.type, String(e && e.message || e));
    return { statusCode: 500, body: 'Retry please' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

// Stripe moved the period end onto the subscription item; fall back for older shapes.
function periodEnd(sub) {
  const secs = (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end)
    || sub.current_period_end;
  return secs ? new Date(secs * 1000).toISOString().slice(0, 10) : '';
}

// Paying always restores a page: the dark flag and the warning history go with it,
// so a returning subscriber never resumes someone else's countdown.
async function markPaid(auth, id, until) {
  const fields = { [B.F.hiddenOn]: null, [B.F.notified]: '' };
  if (until) fields[B.F.paidUntil] = until;
  await patch(auth, id, fields);
}
async function patch(auth, id, fields) {
  await fetch(`https://api.airtable.com/v0/${B.BASE}/${B.MISS}/${id}`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ fields, typecast: true }) }).catch(() => {});
}
async function findByCustomer(auth, customer) {
  if (!customer) return '';
  const f = encodeURIComponent(`{Stripe Customer}='${String(customer).replace(/'/g, "")}'`);
  const rr = await fetch(`https://api.airtable.com/v0/${B.BASE}/${B.MISS}?maxRecords=1&filterByFormula=${f}`, { headers: auth });
  if (!rr.ok) return '';
  const rec = (((await rr.json()).records) || [])[0];
  return rec ? rec.id : '';
}
