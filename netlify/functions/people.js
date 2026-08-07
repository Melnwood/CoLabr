// Co-Labr — "your people": the signed-in missionary's subscriber list, with status.
// list → everyone tied to your page (Following / Invited — waiting / Not following)
// remove → delete one person from your list
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const SUBS = 'tbl21LyWOBxln6bOy';
const SF = {
  name: 'fld95CZHX6o0uNKEb', email: 'fldzhY8nJPjWLKjUK', phone: 'fldBXPbdBiwEyaoEg',
  pref: 'fldI3ED38BzW05kzQ', missionary: 'fldz4NfdnkTC9dw3t', active: 'fld5jtmsj3FtyZCJj',
  source: 'fldm94aUyvI8LHxRf'
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const session = sessionFromEvent(event);
  if (!session) return r(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = `https://api.airtable.com/v0/${BASE}/${SUBS}`;
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }

  let missionary = null;
  try { const me = await missByEmail(auth, session.email); if (me && me.name) missionary = me.name; } catch (_) {}
  if (!missionary) return r(403, { error: 'Your page isn\'t set up yet — create it first.', join: true });

  try {
    if (b.action === 'list') {
      const f = encodeURIComponent(`{Missionary}='${missionary.replace(/'/g, "")}'`);
      let recs = [], offset = '';
      do {
        const rr = await fetch(`${api}?pageSize=100&returnFieldsByFieldId=true&filterByFormula=${f}${offset ? '&offset=' + offset : ''}`, { headers: auth });
        if (!rr.ok) return r(502, { error: 'Could not read your people.' });
        const d = await rr.json(); recs = recs.concat(d.records || []); offset = d.offset || '';
      } while (offset);
      const sel = v => (v && v.name) ? v.name : (v || '');
      const people = recs.map(rec => {
        const c = rec.fields || {};
        return {
          id: rec.id, name: c[SF.name] || '', email: c[SF.email] || '', phone: c[SF.phone] || '',
          pref: sel(c[SF.pref]), active: !!c[SF.active], source: sel(c[SF.source]), lastVisit: c['fldxUuNMuqyafBfDp'] || ''
        };
      }).sort((a, b2) => (a.name || a.email).localeCompare(b2.name || b2.email));
      return r(200, { people, missionary });
    }

    if (b.action === 'approve') {
      if (!b.id) return r(400, { error: 'Missing person.' });
      const gr = await fetch(`${api}/${b.id}?returnFieldsByFieldId=true`, { headers: auth });
      if (!gr.ok) return r(404, { error: 'Not found.' });
      const gf = (await gr.json()).fields || {};
      if ((gf[SF.missionary] || '') !== missionary) return r(403, { error: 'Not one of your people.' });
      const ur = await fetch(api, { method: 'PATCH', headers: auth, body: JSON.stringify({ records: [{ id: b.id, fields: { [SF.active]: true } }] }) });
      if (!ur.ok) return r(502, { error: 'Could not approve.' });
      return r(200, { ok: true });
    }
    if (b.action === 'remove') {
      if (!b.id) return r(400, { error: 'Missing person.' });
      // Only allow removing someone from YOUR page.
      const gr = await fetch(`${api}/${b.id}?returnFieldsByFieldId=true`, { headers: auth });
      if (!gr.ok) return r(404, { error: 'Not found.' });
      const gf = (await gr.json()).fields || {};
      if ((gf[SF.missionary] || '') !== missionary) return r(403, { error: 'Not one of your people.' });
      const dr = await fetch(`${api}/${b.id}`, { method: 'DELETE', headers: auth });
      if (!dr.ok) return r(502, { error: 'Could not remove.' });
      return r(200, { ok: true });
    }

    return r(400, { error: 'Unknown action.' });
  } catch (e) {
    return r(502, { error: 'Something went wrong.' });
  }
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
