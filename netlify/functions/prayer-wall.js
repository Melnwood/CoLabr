// Co·labr — JV-wide prayer wall. Pulls the prayer requests out of every teammate's published
// updates so staff can pray together across the whole movement. Auth required. English where a
// native-language update carries a translation.
const { sessionFromEvent } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const MISS = 'tbli1L8AO0JUDL7Wl';
const U_MISS = 'fldpNShY6OSQBSbx0', U_TITLE = 'fldhkHAXyvqtrx3cu', U_DATE = 'fldvi8dFkZBFANacG', U_BLOCKS = 'fldN9B0v6YU0xptFu', U_TR = 'fld9BeSNNbZpUAtd0';
const M_NAME = 'fldPYSQwxoQJGb0Zd', M_ORG = 'fldCQ8c1Eu6SXmY98', M_PHOTO = 'fldiXSCuELTQiiT08';

exports.handler = async function (event) {
  const session = sessionFromEvent(event);
  if (!session) return resp(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(200, { items: [] });
  const auth = { Authorization: 'Bearer ' + token };
  try {
    const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?pageSize=100&returnFieldsByFieldId=true`, { headers: auth });
    const md = await mr.json(); const map = {};
    (md.records || []).forEach(r => { const f = r.fields || {}; map[r.id] = { name: f[M_NAME] || '', org: f[M_ORG] || '', photo: f[M_PHOTO] || '' }; });

    const flds = `&fields%5B%5D=${U_MISS}&fields%5B%5D=${U_TITLE}&fields%5B%5D=${U_DATE}&fields%5B%5D=${U_BLOCKS}&fields%5B%5D=${U_TR}`;
    const baseUrl = `https://api.airtable.com/v0/${BASE}/${UPDATES}?pageSize=100&returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent("{Status}='Published'")}${flds}`;
    let url = baseUrl; const items = [];
    while (url) {
      const r = await fetch(url, { headers: auth }); if (!r.ok) break;
      const d = await r.json();
      (d.records || []).forEach(rec => {
        const f = rec.fields || {}; const title = f[U_TITLE]; if (!title) return;
        const date = f[U_DATE] || '';
        const mid = (f[U_MISS] || [])[0]; const who = (mid && map[mid]) || { name: '', org: '', photo: '' };
        // The inline index only carries title+excerpt — the translated BODY lives in
        // the per-language file. Note which records need an English fetch below.
        const blocks = parseJSON(f[U_BLOCKS]) || [];
        const tr = parseJSON(f[U_TR]);
        const src = (tr && tr.src) || 'en';
        blocks.forEach((b, bi) => {
          if (b && b.type === 'prayer' && b.text && String(b.text).trim()) {
            items.push({ id: rec.id, author: who.name, org: who.org, photo: who.photo, title, date,
              text: String(b.text).trim(), src, bi,
              title0: title });
          }
        });
      });
      url = d.offset ? `${baseUrl}&offset=${d.offset}` : '';
    }
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const top = items.slice(0, 80);

    // English is the bridge language of the wall: a prayer written in Polish is
    // shown in English here. The translated body lives in the language file, so
    // fetch it for the handful of non-English items on this page.
    const bucket = process.env.GCS_BUCKET;
    if (bucket) {
      const need = [...new Set(top.filter(x => x.src && x.src !== 'en').map(x => x.id))];
      const byId = {};
      await Promise.all(need.map(async id => {
        try {
          const gr = await fetch(`https://storage.googleapis.com/${bucket}/translations/${id}/en.json`, { cache: 'no-store' });
          if (gr.ok) { const d = await gr.json(); if (d && Array.isArray(d.blocks)) byId[id] = d; }
        } catch (e) {}
      }));
      top.forEach(x => {
        const d = byId[x.id]; if (!d) return;
        const b = d.blocks[x.bi];
        if (b && b.type === 'prayer' && b.text && String(b.text).trim()) { x.text = String(b.text).trim(); x.translated = true; }
        else {
          const any = d.blocks.find(y => y && y.type === 'prayer' && y.text);
          if (any) { x.text = String(any.text).trim(); x.translated = true; }
        }
        if (d.title) x.title = d.title;
      });
    }
    return resp(200, { items: top });
  } catch (e) {
    return resp(200, { items: [] });
  }
};
function parseJSON(v) { if (!v) return null; try { return JSON.parse(v); } catch { return null; } }
function resp(s, b) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
