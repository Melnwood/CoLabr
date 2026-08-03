// Co-Labr — manage-preferences (public, token-gated). A supporter reads/updates how they
// hear from a missionary, or unsubscribes, via their private token. Uses AIRTABLE_TOKEN.
const BASE = 'appsSmwptTnmK4luA';
const TABLE = 'tbl21LyWOBxln6bOy';
const F = {
  name: 'fld95CZHX6o0uNKEb', email: 'fldzhY8nJPjWLKjUK', phone: 'fldBXPbdBiwEyaoEg',
  pref: 'fldI3ED38BzW05kzQ', missionary: 'fldz4NfdnkTC9dw3t', active: 'fld5jtmsj3FtyZCJj', token: 'fldUS2VRksgaVipcC'
};
const PREFS = ['Full email', 'Link email', 'Monthly digest', 'Text', 'Site only'];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const t = (b.token || '').toString().trim();
  if (!t) return r(400, { error: 'Missing token.' });

  const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  try {
    const f = encodeURIComponent(`{Token}='${t.replace(/'/g, "")}'`);
    const sr = await fetch(`${api}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${f}`, { headers: auth });
    if (!sr.ok) return r(sr.status, { error: 'Could not look you up.' });
    const sd = await sr.json(); const rec = (sd.records || [])[0];
    if (!rec) return r(404, { error: 'This preferences link is not valid.' });
    const c = rec.fields || {};
    const sel = c[F.pref]; const pref = (sel && sel.name) ? sel.name : (sel || 'Link email');

    if (b.action === 'get') {
      return r(200, { ok: true, name: c[F.name] || '', email: c[F.email] || '', preference: pref, active: !!c[F.active], missionary: c[F.missionary] || '' });
    }
    if (b.action === 'update' || b.action === 'unsubscribe') {
      const fields = {};
      if (b.action === 'unsubscribe') fields[F.active] = false;
      else { fields[F.active] = true; if (PREFS.includes(b.preference)) fields[F.pref] = b.preference; if (b.phone) fields[F.phone] = String(b.phone).slice(0, 40); }
      const up = await fetch(api, { method: 'PATCH', headers: auth, body: JSON.stringify({ records: [{ id: rec.id, fields }], typecast: true }) });
      if (!up.ok) { const e = await up.json().catch(() => ({})); return r(up.status, { error: (e.error && e.error.message) || 'Could not save.' }); }
      return r(200, { ok: true });
    }
    return r(400, { error: 'Unknown action.' });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
