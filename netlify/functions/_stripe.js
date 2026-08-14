// Co·labr — one Stripe client, made once, for every function that needs it.
//
// Keys live in Netlify's environment, never in this repository. Use a RESTRICTED
// key (rk_…) rather than a secret key (sk_…): this integration only needs to read
// and write customers, checkout sessions, subscriptions and invoices, so a leaked
// key should not be able to do anything else.
const Stripe = require('stripe');

// Pinned deliberately. Stripe ships breaking changes behind version dates, and an
// integration that floats will break on a day nobody touched it.
const API_VERSION = '2026-07-29.dahlia';

let _client = null;
function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;                       // not configured yet — callers say so politely
  if (!_client) _client = new Stripe(key, { apiVersion: API_VERSION });
  return _client;
}

// Live keys in a test deploy (or the reverse) is a whole afternoon lost. Say which.
const isLive = () => String(process.env.STRIPE_SECRET_KEY || '').includes('_live_');

module.exports = { stripe, isLive, API_VERSION };
