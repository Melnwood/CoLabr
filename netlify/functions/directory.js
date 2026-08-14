// Co·labr — staff directory. Lists every JV missionary who has published updates, so a signed-in
// staff member can browse teammates' Co·labr pages and feature their stories. Auth required.
const { sessionFromEvent } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const MISS = 'tbli1L8AO0JUDL7Wl';
const U_MISS = 'fldpNShY6OSQBSbx0', U_TITLE = 'fldhkHAXyvqtrx3cu', U_COVER = 'fldsU5p6r9LzdeTF7', U_DATE = 'fldvi8dFkZBFANacG', U_FOCUS = 'fldPfHW8WdHgHK921';
const M_NAME = 'fldPYSQwxoQJGb0Zd', M_ORG = 'fldCQ8c1Eu6SXmY98', M_LOC = 'fld0mx3Sp4JnNnIfc', M_PHOTO = 'fldiXSCuELTQiiT08';

exports.handler = async function (event) {
  const session = sessionFromEvent(event);
  if (!session) return resp(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(200, { missionaries: [] });
  const auth = { Authorization: 'Bearer ' + token };
  try {
    // All missionaries → map by record id.
    const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?pageSize=100&returnFieldsByFieldId=true`, { headers: auth });
    const md = await mr.json(); const map = {};
    (md.records || []).forEach(r => { const f = r.fields || {}; map[r.id] = { id: r.id, name: f[M_NAME] || '', org: f[M_ORG] || '', location: f[M_LOC] || '', photo: f[M_PHOTO] || '', count: 0, latest: null }; });

    // All published updates → tally per missionary.
    const flds = `&fields%5B%5D=${U_MISS}&fields%5B%5D=${U_TITLE}&fields%5B%5D=${U_COVER}&fields%5B%5D=${U_DATE}&fields%5B%5D=${U_FOCUS}`;
    const base = `https://api.airtable.com/v0/${BASE}/${UPDATES}?pageSize=100&returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent("{Status}='Published'")}${flds}`;
    let url = base;
    while (url) {
      const r = await fetch(url, { headers: auth }); if (!r.ok) break;
      const d = await r.json();
      (d.records || []).forEach(rec => {
        const f = rec.fields || {}; const title = f[U_TITLE]; if (!title) return;
        const date = f[U_DATE] || '', cover = f[U_COVER] || '', focus = f[U_FOCUS] || '';
        (f[U_MISS] || []).forEach(mid => { const m = map[mid]; if (!m) return; m.count++; if (!m.latest || date > m.latest.date) m.latest = { id: rec.id, title, cover, date, focus }; });
      });
      url = d.offset ? `${base}&offset=${d.offset}` : '';
    }

    const missionaries = Object.values(map).filter(m => m.count > 0).sort((a, b) => a.name.localeCompare(b.name));
    return resp(200, { missionaries, me: session.email });
  } catch (e) {
    return resp(200, { missionaries: [] });
  }
};
function resp(s, b) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
