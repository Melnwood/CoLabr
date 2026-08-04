// Co-Labr — JV-wide prayer wall. Pulls the prayer requests out of every teammate's published
// updates so staff can pray together across the whole movement. Auth required. English where a
// native-language update carries a translation.
const { sessionFromEvent } = require('./_auth');
const BASE = 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const MISS = 'tbli1L8AO0JUDL7Wl';
const U_MISS = 'fldpNShY6OSQBSbx0', U_TITLE = 'fldhkHAXyvqtrx3cu', U_DATE = 'fldvi8dFkZBFANacG', U_BLOCKS = 'fldN9B0v6YU0xptFu', U_TR = 'fld9BeSNNbZpUAtd0';
const M_NAME = 'fldPYSQwxoQJGb0Zd', M_ORG = 'fldCQ8c1Eu6SXmY98';

exports.handler = async function (event) {
  const session = sessionFromEvent(event);
  if (!session) return resp(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(200, { items: [] });
  const auth = { Authorization: 'Bearer ' + token };
  try {
    const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?pageSize=100&returnFieldsByFieldId=true`, { headers: auth });
    const md = await mr.json(); const map = {};
    (md.records || []).forEach(r => { const f = r.fields || {}; map[r.id] = { name: f[M_NAME] || '', org: f[M_ORG] || '' }; });

    const flds = `&fields%5B%5D=${U_MISS}&fields%5B%5D=${U_TITLE}&fields%5B%5D=${U_DATE}&fields%5B%5D=${U_BLOCKS}&fields%5B%5D=${U_TR}`;
    const baseUrl = `https://api.airtable.com/v0/${BASE}/${UPDATES}?pageSize=100&returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent("{Status}='Published'")}${flds}`;
    let url = baseUrl; const items = [];
    while (url) {
      const r = await fetch(url, { headers: auth }); if (!r.ok) break;
      const d = await r.json();
      (d.records || []).forEach(rec => {
        const f = rec.fields || {}; const title = f[U_TITLE]; if (!title) return;
        const date = f[U_DATE] || '';
        const mid = (f[U_MISS] || [])[0]; const who = (mid && map[mid]) || { name: '', org: '' };
        // Prefer an English translation's prayer blocks when the original isn't English.
        let blocks = parseJSON(f[U_BLOCKS]) || [];
        const tr = parseJSON(f[U_TR]);
        if (tr && tr.src && tr.src !== 'en' && tr.tr && tr.tr.en && Array.isArray(tr.tr.en.blocks)) blocks = tr.tr.en.blocks;
        blocks.forEach(b => {
          if (b && b.type === 'prayer' && b.text && String(b.text).trim()) {
            items.push({ id: rec.id, author: who.name, org: who.org, title, date, text: String(b.text).trim() });
          }
        });
      });
      url = d.offset ? `${baseUrl}&offset=${d.offset}` : '';
    }
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return resp(200, { items: items.slice(0, 80) });
  } catch (e) {
    return resp(200, { items: [] });
  }
};
function parseJSON(v) { if (!v) return null; try { return JSON.parse(v); } catch { return null; } }
function resp(s, b) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
