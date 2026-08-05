// Co-Labr — the "Across Josiah Venture" rail. Returns the teammate stories that have been
// approved to appear on a given supporter page. Public (read-only).
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const SHARES = 'tblKLXrYICtkiSp40';
const MISS = 'tbli1L8AO0JUDL7Wl';
const M_NAME = 'fldPYSQwxoQJGb0Zd', M_PHOTO = 'fldiXSCuELTQiiT08';

exports.handler = async function (event) {
  const token = process.env.AIRTABLE_TOKEN;
  const page = (event.queryStringParameters && event.queryStringParameters.page) || 'The Ellenwood Family';
  const hdr = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' };
  if (!token) return { statusCode: 200, headers: hdr, body: JSON.stringify({ items: [] }) };
  try {
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
