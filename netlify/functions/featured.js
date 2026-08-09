// Co-Labr — the "Across Josiah Venture" rail. Returns the teammate stories that have been
// approved to appear on a given supporter page. Gated like the wall itself: a locked
// visitor gets NOTHING — no teammate story leaks past the sign-up card.
const { sessionFromEvent } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const SHARES = 'tblKLXrYICtkiSp40';
const SUBS = 'tbl21LyWOBxln6bOy';
const MISS = 'tbli1L8AO0JUDL7Wl';
const M_NAME = 'fldPYSQwxoQJGb0Zd', M_PHOTO = 'fldiXSCuELTQiiT08';

exports.handler = async function (event) {
  const token = process.env.AIRTABLE_TOKEN;
  const q = event.queryStringParameters || {};
  const page = q.page || 'The Ellenwood Family';
  const hdr = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' };
  if (!token) return { statusCode: 200, headers: hdr, body: JSON.stringify({ items: [] }) };
  try {
    // Proof of belonging: staff session, or a supporter token active on THIS page.
    let allowed = false;
    try { if (sessionFromEvent(event)) allowed = true; } catch (e) {}
    const vt = (q.t || '').trim();
    if (!allowed && vt && /^[a-f0-9]{16,64}$/i.test(vt)) {
      const tf = encodeURIComponent(`AND({Token}='${vt}',{Missionary}='${page.replace(/'/g, "")}',{Active}=1)`);
      const trr = await fetch(`https://api.airtable.com/v0/${BASE}/${SUBS}?maxRecords=1&filterByFormula=${tf}`, { headers: { Authorization: 'Bearer ' + token } });
      if (trr.ok && ((((await trr.json()).records) || []).length)) allowed = true;
    }
    if (!allowed) return { statusCode: 200, headers: hdr, body: JSON.stringify({ items: [] }) };
    const formula = `AND({Requester Page}='${page.replace(/'/g, "\\'")}',{Status}='Approved')`;
    const url = `https://api.airtable.com/v0/${BASE}/${SHARES}?pageSize=50&filterByFormula=${encodeURIComponent(formula)}`;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return { statusCode: 200, headers: hdr, body: JSON.stringify({ items: [] }) };
    const d = await r.json();
    // Author portraits, keyed by missionary name (small table — one fetch covers everyone).
    const photos = {};
    try {
      const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?pageSize=100&returnFieldsByFieldId=true`, { headers: { Authorization: 'Bearer ' + token } });
      if (mr.ok) ((await mr.json()).records || []).forEach(m => { const mf = m.fields || {}; if (mf[M_NAME]) photos[mf[M_NAME]] = mf[M_PHOTO] || ''; });
    } catch (_) {}
    const items = (d.records || []).map(rec => {
      const f = rec.fields || {};
      return { id: rec.id, updateId: f['Update ID'] || '', title: f['Update Title'] || '', excerpt: f['Excerpt'] || '', cover: f['Cover URL'] || '', author: f['Author'] || '', country: f['Country'] || '', photo: f['Author Photo'] || photos[f['Author'] || ''] || '' };
    });
    return { statusCode: 200, headers: hdr, body: JSON.stringify({ items }) };
  } catch (e) {
    return { statusCode: 200, headers: hdr, body: JSON.stringify({ items: [] }) };
  }
};
