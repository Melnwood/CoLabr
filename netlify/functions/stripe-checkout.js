// Co·labr — send a signed-in missionary to Stripe Checkout to start a subscription.
//
// The 14-day free trial is NOT Stripe's. It is ours, and it runs before anyone has
// touched a card (see _billing.js) — that is the whole point of "try it free".
// By the time somebody arrives here they have decided to pay, so the subscription
// starts now and no trial is passed to Stripe.
const { sessionFromEvent } = require('./_auth');
const { stripe } = require('./_stripe');
const B = require('./_billing');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const sess = sessionFromEvent(event);
  if (!sess) return r(401, { error: 'Please sign in.' });

  const s = stripe();
  const price = process.env.STRIPE_PRICE_ID;
  if (!s) return r(503, { error: 'Payments aren’t switched on yet.' });
  if (!price) return r(503, { error: 'No plan has been set up yet.' });

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  try {
    const rec = await B.recordFor({ Authorization: 'Bearer ' + token }, sess.email);
    if (!rec) return r(404, { error: 'No page found for your account.' });
    const f = rec.fields || {};

    // Organizations pay for their own people. Never sell a seat to somebody who
    // already has one — they would be charged for nothing.
    if (f[B.F.covered]) {
      return r(400, { error: 'Your organization already covers your Co·labr account — there’s nothing to pay.' });
    }

    // Reuse their customer if we have made one, so a second subscription can never
    // be stacked onto a second customer record for the same person.
    let customer = f['Stripe Customer'] || '';
    if (!customer) {
      const c = await s.customers.create({
        email: String(f['Email'] || sess.email).split(',')[0].trim(),
        name: f['Name'] || '',
        metadata: { airtable_id: rec.id, page: f['Name'] || '' }
      });
      customer = c.id;
      await fetch(`https://api.airtable.com/v0/${B.BASE}/${B.MISS}/${rec.id}`, {
        method: 'PATCH', headers: auth,
        body: JSON.stringify({ fields: { 'Stripe Customer': customer }, typecast: true }) }).catch(() => {});
    }

    const site = process.env.SITE_BASE || `https://${event.headers.host}`;
    const checkout = await s.checkout.sessions.create({
      mode: 'subscription',
      customer,
      // No payment_method_types — Stripe picks the eligible methods from the
      // Dashboard, which is what keeps conversion up in every country we serve.
      line_items: [{ price, quantity: 1 }],
      client_reference_id: rec.id,
      subscription_data: { metadata: { airtable_id: rec.id, page: f['Name'] || '' } },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      integration_identifier: 'colabr-seat-kqmwtzvr',
      success_url: `${site}/manage.html?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/pricing.html`
    });

    return r(200, { ok: true, url: checkout.url });
  } catch (e) {
    console.log('stripe-checkout', String(e && e.message || e));
    return r(502, { error: 'Could not start checkout. Please try again.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
