// Co·labr — the waitlist. While the platform is in its testing season, interested people
// leave their email here; when Co·labr opens past the testing group, they get one email.
// Public POST (it lives on the marketing page), gently rate-limited, upserts by email.
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tblxvLSHKNsTb4uvl';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const token = process.env.AIRTABLE_TOKEN; if (!token) return r(500, { error: 'Server not configured.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const email = (b.email || '').toString().trim().toLowerCase();
  const name = (b.name || '').toString().trim().slice(0, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return r(400, { error: 'That email doesn’t look right.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;

  // Already on the list? Just say yes — signing up twice should feel fine, not fail.
  const f = encodeURIComponent(`LOWER({Email})='${email.replace(/'/g, "")}'`);
  const gr = await fetch(`${api}?maxRecords=1&filterByFormula=${f}`, { headers: auth });
  if (gr.ok && (((await gr.json()).records || [])[0])) return r(200, { ok: true, already: true });

  const cr = await fetch(api, { method: 'POST', headers: auth,
    body: JSON.stringify({ records: [{ fields: { Email: email, Name: name } }], typecast: true }) });
  if (!cr.ok) return r(502, { error: 'Could not save — try again in a moment.' });
  return r(200, { ok: true });
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
