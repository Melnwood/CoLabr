// Co-Labr — an individual missionary creates their page. Signed-in (any Google account).
// Creates their Missionaries record in TEST MODE (Live unchecked): they can compose, publish
// to their wall, and preview freely — publishing emails no one until they choose to go live.
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const MISS = 'tbli1L8AO0JUDL7Wl';
const MF = {
  name: 'Name', email: 'Email', location: 'Field Location',
  org: 'Organization', signoff: 'Sign-off'
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const s = sessionFromEvent(event);
  if (!s) return r(401, { error: 'Please sign in first.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const token = process.env.AIRTABLE_TOKEN; if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  // Already have a page? Nothing to create.
  const existing = await missByEmail(auth, s.email);
  if (existing) return r(200, { ok: true, existing: true, name: existing.name });

  const name = (b.name || '').toString().trim().slice(0, 80);
  if (name.length < 3) return r(400, { error: 'Please give your page a name (like "The Novak Family").' });
  const location = (b.location || '').toString().trim().slice(0, 80);
  const org = (b.org || '').toString().trim().slice(0, 120);
  const signoff = (b.signoff || '').toString().trim().slice(0, 120);

  // Page names key everything — keep them unique.
  const nf = encodeURIComponent(`LOWER({Name})='${name.toLowerCase().replace(/'/g, "")}'`);
  const nr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?maxRecords=1&filterByFormula=${nf}`, { headers: auth });
  if (nr.ok && (((await nr.json()).records) || []).length) {
    return r(409, { error: 'That page name is taken — add your city or a middle initial to make it yours.' });
  }

  const fields = {
    [MF.name]: name, [MF.email]: s.email,
    [MF.signoff]: signoff ? ('With love,\n' + signoff) : ''
  };
  if (location) fields[MF.location] = location;
  if (org) fields[MF.org] = org;
  // Live is intentionally NOT set: every new page starts in test mode.
  const cr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}`, {
    method: 'POST', headers: auth, body: JSON.stringify({ fields, typecast: true })
  });
  if (!cr.ok) return r(502, { error: 'Could not create your page. Please try again.' });
  return r(200, { ok: true, name });
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
