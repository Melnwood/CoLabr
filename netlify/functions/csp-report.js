// Co·labr — collector for Content-Security-Policy violation reports.
//
// The full policy runs in report-only mode first. Every page here is built from inline
// scripts and years of imported newsletter HTML pointing at hosts nobody remembers, so
// enforcing a guessed policy would break real pages for real supporters. This gathers
// what the policy WOULD have blocked, from actual use, so it can be tightened on
// evidence instead of hope.
//
// Deliberately unauthenticated: the browser posts these, not a signed-in person.
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const EVENTS = 'tbl2Dm5W07cAMrJgs';

// Browser extensions rewrite pages and trip CSP constantly. Those reports say nothing
// about our policy and would drown the ones that matter.
const NOISE = /^(chrome|moz|safari|webkit)-extension:|^about:|^blob:null/i;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };
  try {
    const body = JSON.parse(event.body || '{}');
    const r = body['csp-report'] || body.report || body || {};
    const directive = String(r['effective-directive'] || r['violated-directive'] || '?').slice(0, 40);
    const blocked = String(r['blocked-uri'] || '?').slice(0, 120);
    const page = String(r['document-uri'] || '').replace(/[?#].*$/, '').slice(0, 90);
    if (NOISE.test(blocked)) return { statusCode: 204, body: '' };

    const token = process.env.AIRTABLE_TOKEN;
    if (token) {
      await fetch(`https://api.airtable.com/v0/${BASE}/${EVENTS}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'Kind': 'CSP', 'Update ID': `${directive} blocked ${blocked} on ${page}` } })
      });
    }
  } catch (e) { /* a report that cannot be parsed is not worth an error page */ }
  return { statusCode: 204, body: '' };
};
