// Co-Labr — lightweight event tracking (public). Currently logs Give-button clicks
// (interest, not gifts). Uses AIRTABLE_TOKEN (write).
// Signed-in members are never counted — engagement means people OUTSIDE the team.
const { sessionFromEvent } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl2Dm5W07cAMrJgs';
const F = { kind: 'fldNrmKtonmpty6Ks', updateId: 'fldYFmxTqQ4tgBLKM', updateTitle: 'fldrZdDFBAoJr12oT', missionary: 'fldJQEL5qOEQT1Jsh', supporter: 'fldAXWsuGoc1xXZXE' };
const KINDS = ['Give'];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  try { if (sessionFromEvent(event)) return r(200, { ok: true, skipped: 'staff' }); } catch (e) {}
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(200, { ok: false }); // never break the Give click over tracking
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(200, { ok: false }); }
  const kind = KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) return r(200, { ok: false });
  const fields = { [F.kind]: kind };
  if (b.updateId) fields[F.updateId] = String(b.updateId).slice(0, 40);
  if (b.updateTitle) fields[F.updateTitle] = String(b.updateTitle).slice(0, 200);
  if (b.missionary) fields[F.missionary] = String(b.missionary).slice(0, 120);
  // Attribute the click to the supporter whose wall key made the visit — so the
  // missionary's Conversations page can show each person's Give interest.
  const vt = (b.t || '').toString().trim();
  if (vt && /^[a-f0-9]{16,64}$/i.test(vt) && b.missionary) {
    try {
      const tf = encodeURIComponent(`AND({Token}='${vt}',{Missionary}='${String(b.missionary).replace(/'/g, "")}',{Active}=1)`);
      const trr = await fetch(`https://api.airtable.com/v0/${BASE}/tbl21LyWOBxln6bOy?maxRecords=1&filterByFormula=${tf}`, { headers: { Authorization: 'Bearer ' + token } });
      if (trr.ok) {
        const rec = (((await trr.json()).records) || [])[0];
        if (rec) fields[F.supporter] = `${rec.fields['Name'] || ''} <${(rec.fields['Email'] || '').toLowerCase()}>`.trim();
      }
    } catch (e) {}
  }
  try {
    await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: true })
    });
    return r(200, { ok: true });
  } catch (e) { return r(200, { ok: false }); }
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
