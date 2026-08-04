// Co-Labr — live updates feed. Reads published updates for one missionary's page from Airtable.
// The Airtable token lives ONLY here (server-side), never sent to the browser.
// ?m=<Missionary Name> selects whose page this is (defaults to the Ellenwoods).

const BASE = 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';
const MIS_TABLE = 'tbli1L8AO0JUDL7Wl';         // Missionaries
const MIS_STYLE = 'fldvLZXckaQVUbD7F';          // Style (single select)
const MIS_NAME = 'fldPYSQwxoQJGb0Zd';
const MIS_LOC = 'fld0mx3Sp4JnNnIfc';
const MIS_ORG = 'fldCQ8c1Eu6SXmY98';
const DEFAULT_MISSIONARY = process.env.SITE_MISSIONARY || 'The Ellenwood Family';
const F = {
  title:  'fldhkHAXyvqtrx3cu',
  date:   'fldvi8dFkZBFANacG',
  opens:  'fldaZUAn4m3idZliI',
  cover:  'fldsU5p6r9LzdeTF7',
  video:  'fldzK9sIREqMYJU5e',
  excerpt:'fld9PBqSvmd4vNiyh',
  arc:    'fldGKATli4f8Kk8d7',
  aud:    'fld6ZpC94Aq43d5ZY',
  blocks: 'fldN9B0v6YU0xptFu',
  tr:     'fld9BeSNNbZpUAtd0'
};

exports.handler = async function (event) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return json(500, { error: 'Missing AIRTABLE_TOKEN environment variable in Netlify.' });
  const auth = { Authorization: 'Bearer ' + token };

  const q = (event && event.queryStringParameters) || {};
  const missionary = (q.m && q.m.trim()) || DEFAULT_MISSIONARY;
  const isDefault = missionary === DEFAULT_MISSIONARY;
  const nameEsc = missionary.replace(/'/g, "\\'");
  // Default page: this missionary OR legacy untagged updates. Teammate page: exact match only.
  const formula = isDefault
    ? `AND({Status}='Published', OR(LEN(ARRAYJOIN({Missionary}))=0, FIND('${nameEsc}', ARRAYJOIN({Missionary}))>0))`
    : `AND({Status}='Published', FIND('${nameEsc}', ARRAYJOIN({Missionary}))>0)`;

  const url = `https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100&returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent(formula)}`;
  try {
    const r = await fetch(url, { headers: auth });
    if (!r.ok) return json(r.status, { error: 'Airtable request failed (' + r.status + ')' });
    const data = await r.json();
    const updates = (data.records || []).map(rec => {
      const c = rec.fields || {};
      const trObj = parseJSON(c[F.tr]);
      return {
        id:      rec.id,
        title:   c[F.title] || '',
        rawdate: c[F.date] || '',
        opens:   c[F.opens] || 0,
        cover:   https(c[F.cover] || ''),
        video:   c[F.video] || '',
        excerpt: c[F.excerpt] || '',
        arc:     c[F.arc] || '',
        aud:     (c[F.aud] || []).map(a => (a && a.name) ? a.name : a),
        blocks:  parseBlocks(c[F.blocks]),
        src:     (trObj && trObj.src) || '',            // original language, if not English
        tr:      (trObj && trObj.tr) || null            // inline { en: {title, blocks}, ... }
      };
    }).filter(u => u.title).sort((a, b) => (b.rawdate).localeCompare(a.rawdate));

    // Page identity + chosen layout for this missionary.
    let style = 'Field Notes', page = { name: missionary, location: '', org: '' };
    try {
      const mf = encodeURIComponent(`{Name}='${nameEsc}'`);
      const mUrl = `https://api.airtable.com/v0/${BASE}/${MIS_TABLE}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${mf}`;
      const mr = await fetch(mUrl, { headers: auth });
      if (mr.ok) {
        const rec = ((await mr.json()).records || [])[0];
        const mfields = (rec && rec.fields) || {};
        const s = mfields[MIS_STYLE]; if (s) style = (s && s.name) ? s.name : s;
        page = { name: mfields[MIS_NAME] || missionary, location: mfields[MIS_LOC] || '', org: mfields[MIS_ORG] || '' };
      }
    } catch (e) { /* fall back */ }

    return json(200, { style, page, updates }, 'no-store');
  } catch (e) {
    return json(502, { error: 'Could not reach Airtable.' });
  }
};

function parseJSON(v) { if (!v) return null; try { return JSON.parse(v); } catch { return null; } }
function parseBlocks(v) {
  if (!v) return [];
  try {
    const a = JSON.parse(v);
    if (!Array.isArray(a)) return [];
    return a.map(bk => (bk && bk.url) ? { ...bk, url: https(bk.url) } : bk);
  } catch { return []; }
}
function https(u) { return typeof u === 'string' ? u.replace(/^http:\/\//i, 'https://') : u; }
function json(statusCode, body, cache) {
  const headers = { 'Content-Type': 'application/json' };
  if (cache) headers['Cache-Control'] = cache;
  return { statusCode, headers, body: JSON.stringify(body) };
}
