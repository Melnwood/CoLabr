// Co-Labr — live updates feed. Reads published updates for one missionary's page from Airtable.
// The Airtable token lives ONLY here (server-side), never sent to the browser.
// ?m=<Missionary Name> selects whose page this is (defaults to the Ellenwoods).

const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';
const MIS_TABLE = 'tbli1L8AO0JUDL7Wl';         // Missionaries
const MIS_STYLE = 'fldvLZXckaQVUbD7F';          // Style (single select)
const MIS_NAME = 'fldPYSQwxoQJGb0Zd';
const MIS_LOC = 'fld0mx3Sp4JnNnIfc';
const MIS_ORG = 'fldCQ8c1Eu6SXmY98';
const MIS_PHOTO = 'fldiXSCuELTQiiT08';
const MIS_GIVE = 'fldKf7jxzKIQQ0S6d';
const MIS_NATIONAL = 'fld4WE8NRwSrNj7ih';        // National staff (checkbox) — authoritative co-brand switch
const ORGS_TABLE = 'tbl152sVfqGyrqpJQ';        // National Orgs (brand)
const ORG_CODE = 'fldYMMDdsP2DgNzmZ', ORG_NAME = 'fldsyU3dpzLdkXI7t';
const ORG_INK = 'fldhe4BdqqpM37Hod', ORG_ACCENT = 'fldqjEmVMB9lVTOzG', ORG_BG = 'fldpgLMC8jv9YHtxm', ORG_TEXTON = 'fldufCKMaSCYUh3xt';
const ORG_COUNTRY = 'fldsJCCbZgD5wcamY';           // Country (for the "Josiah Venture | <country>" co-brand mark)
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

    // A page is "national" when the person's "National staff" toggle is on (set by an admin in the
    // console). That authoritatively turns on the reader-language brand switch + co-brand mark.
    let native = false;

    // Page identity + chosen layout for this missionary.
    let style = 'Field Notes', page = { name: missionary, location: '', org: '', photo: '', country: '', orgName: '', native };
    try {
      const mf = encodeURIComponent(`{Name}='${nameEsc}'`);
      const mUrl = `https://api.airtable.com/v0/${BASE}/${MIS_TABLE}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${mf}`;
      const mr = await fetch(mUrl, { headers: auth });
      if (mr.ok) {
        const rec = ((await mr.json()).records || [])[0];
        const mfields = (rec && rec.fields) || {};
        const s = mfields[MIS_STYLE]; if (s) style = (s && s.name) ? s.name : s;
        native = !!mfields[MIS_NATIONAL];
        page = { name: mfields[MIS_NAME] || missionary, location: mfields[MIS_LOC] || '', org: mfields[MIS_ORG] || '', photo: mfields[MIS_PHOTO] || '', give: mfields[MIS_GIVE] || '', country: '', orgName: '', native };
      }
    } catch (e) { /* fall back */ }

    // Brand: the org's three-color system (ink / accent / background). The page falls back to JV
    // defaults if the org has no brand set.
    let brand = null;
    if (page.org) {
      try {
        const oe = page.org.replace(/'/g, "\\'");
        const of = encodeURIComponent(`OR({Code}='${oe}',{Name}='${oe}',{Country}='${oe}')`);
        const oUrl = `https://api.airtable.com/v0/${BASE}/${ORGS_TABLE}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${of}`;
        const or = await fetch(oUrl, { headers: auth });
        if (or.ok) {
          const orec = ((await or.json()).records || [])[0];
          if (orec) {
            const of2 = orec.fields || {};
            const t = of2[ORG_TEXTON];
            brand = { ink: of2[ORG_INK] || '', accent: of2[ORG_ACCENT] || '', bg: of2[ORG_BG] || '', textOn: (t && t.name) ? t.name : (t || 'Light') };
            page.country = of2[ORG_COUNTRY] || '';
            page.orgName = of2[ORG_NAME] || '';
          }
        }
      } catch (e) { /* no brand → JV defaults */ }
      // If the org string didn't match an org record, still show it as the co-brand country label.
      if (!page.country) page.country = page.org;
    }

    return json(200, { style, page, brand, updates }, 'no-store');
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
