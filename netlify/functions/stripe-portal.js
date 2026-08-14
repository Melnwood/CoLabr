// Co·labr — the Customer Portal. Changing a card, seeing invoices, and cancelling
// are all Stripe's own screens: we should never rebuild those, and we should never
// make somebody email us to stop paying.
const { sessionFromEvent } = require('./_auth');
const { stripe } = require('./_stripe');
const B = require('./_billing');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const sess = sessionFromEvent(event);
  if (!sess) return r(401, { error: 'Please sign in.' });
  const s = stripe();
  if (!s) return r(503, { error: 'Payments aren’t switched on yet.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });

  try {
    const rec = await B.recordFor({ Authorization: 'Bearer ' + token }, sess.email);
    const customer = rec && rec.fields && rec.fields['Stripe Customer'];
    if (!customer) return r(400, { error: 'There’s no subscription on this account yet.' });
    const site = process.env.SITE_BASE || `https://${event.headers.host}`;
    const portal = await s.billingPortal.sessions.create({ customer, return_url: `${site}/manage.html` });
    return r(200, { ok: true, url: portal.url });
  } catch (e) {
    console.log('stripe-portal', String(e && e.message || e));
    return r(502, { error: 'Could not open billing. Please try again.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
