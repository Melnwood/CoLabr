// CoLabr — supporter subscribe (public, no login). Creates/updates a Subscriber and
// how they want updates. Uses AIRTABLE_TOKEN (write). Returns a manage-preferences token.
const crypto = require('crypto');
const BASE = 'appsSmwptTnmK4luA';
const TABLE = 'tbl21LyWOBxln6bOy';
const F = {
  name: 'fld95CZHX6o0uNKEb', email: 'fldzhY8nJPjWLKjUK', phone: 'fldBXPbdBiwEyaoEg',
  pref: 'fldI3ED38BzW05kzQ', missionary: 'fldz4NfdnkTC9dw3t', active: 'fld5jtmsj3FtyZCJj',
  source: 'fldm94aUyvI8LHxRf', token: 'fldUS2VRksgaVipcC'
};
const PREFS = ['Full email', 'Link email', 'Monthly digest', 'Text', 'Site only'];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }

  const name = (b.name || '').toString().trim().slice(0, 80);
  const email = (b.email || '').toString().trim().slice(0, 120);
  const phone = (b.phone || '').toString().trim().slice(0, 40);
  const pref = PREFS.includes(b.preference) ? b.preference : 'Link email';
  const missionary = (b.missionary || '').toString().trim().slice(0, 120);
  if (!name) return r(400, { error: 'Please add your name.' });
  if (pref === 'Text') { if (!phone) return r(400, { error: 'Please add a phone number for texts.' }); }
  else if (!email || !/.+@.+\..+/.test(email)) return r(400, { error: 'Please add a valid email.' });

  const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  try {
    // Already subscribed (same email + missionary)? Update their preference instead of duplicating.
    let existing = null, mtoken = crypto.randomBytes(16).toString('hex');
    if (email) {
      const f = encodeURIComponent(`AND(LOWER({Email})='${email.toLowerCase().replace(/'/g, "")}',{Missionary}='${missionary.replace(/'/g, "")}')`);
      const sr = await fetch(`${api}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${f}`, { headers: auth });
      if (sr.ok) { const sd = await sr.json(); existing = (sd.records || [])[0] || null; if (existing && existing.fields && existing.fields[F.token]) mtoken = existing.fields[F.token]; }
    }
    const fields = { [F.name]: name, [F.pref]: pref, [F.missionary]: missionary, [F.active]: true, [F.token]: mtoken };
    if (email) fields[F.email] = email;
    if (phone) fields[F.phone] = phone;
    let resp;
    if (existing) {
      resp = await fetch(api, { method: 'PATCH', headers: auth, body: JSON.stringify({ records: [{ id: existing.id, fields }], typecast: true }) });
    } else {
      fields[F.source] = 'Site';
      resp = await fetch(api, { method: 'POST', headers: auth, body: JSON.stringify({ fields, typecast: true }) });
    }
    const data = await resp.json();
    if (!resp.ok) return r(resp.status, { error: (data.error && data.error.message) || 'Could not save.' });
    const site = process.env.SITE_BASE || '';
    return r(200, { ok: true, token: mtoken, manageUrl: site ? `${site}/prefs.html?t=${mtoken}` : `prefs.html?t=${mtoken}` });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
