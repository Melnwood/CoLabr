// Co·labr — live updates feed. Reads published updates for one missionary's page from Airtable.
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
const MIS_SIGN = 'fldD1inZ2xxgQ3OXv';   // the FULL sign-off, their words, possibly multiline
const MIS_NATIONAL = 'fld4WE8NRwSrNj7ih';        // National staff (checkbox) — authoritative co-brand switch
const ORGS_TABLE = 'tbl152sVfqGyrqpJQ';        // National Orgs (brand)
const ORG_CODE = 'fldYMMDdsP2DgNzmZ', ORG_NAME = 'fldsyU3dpzLdkXI7t';
const ORG_INK = 'fldhe4BdqqpM37Hod', ORG_ACCENT = 'fldqjEmVMB9lVTOzG', ORG_BG = 'fldpgLMC8jv9YHtxm', ORG_TEXTON = 'fldufCKMaSCYUh3xt';
const ORG_COUNTRY = 'fldsJCCbZgD5wcamY';
const ORG_GIVE = 'fldxLnwhxtFv88MGn';           // the org's general fund — used when a missionary has no link of their own           // Country (for the "Josiah Venture | <country>" co-brand mark)
const DEFAULT_MISSIONARY = process.env.SITE_MISSIONARY || 'The Ellenwood Family';
const { sessionFromEvent } = require('./_auth');
const SUBS = 'tbl21LyWOBxln6bOy';
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
  type:   'fldY0VaoPZjHrvzYD',
  tags:   'fldeNZl0v7u7w2WAp',
  tr:     'fld9BeSNNbZpUAtd0',
  hl:     'fldT4O1aeyqmxqqrH'
};

exports.handler = async function (event) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return json(500, { error: 'Missing AIRTABLE_TOKEN environment variable in Netlify.' });
  const auth = { Authorization: 'Bearer ' + token };

  const q = (event && event.queryStringParameters) || {};
  let missionary = (q.m && q.m.trim()) || DEFAULT_MISSIONARY;
  // Renamed pages: links minted before a rename carry the old name. Resolve it to the
  // current one via Former Names, so no supporter's saved link ever dies.
  try {
    const rf = encodeURIComponent(`{Name}='${missionary.replace(/'/g, "\\'")}'`);
    const rr = await fetch(`https://api.airtable.com/v0/${BASE}/${MIS_TABLE}?maxRecords=1&filterByFormula=${rf}`, { headers: auth });
    if (rr.ok && !(((await rr.json()).records || [])[0])) {
      const ff = encodeURIComponent(`FIND('${missionary.replace(/'/g, "")}', {Former Names})>0`);
      const fr = await fetch(`https://api.airtable.com/v0/${BASE}/${MIS_TABLE}?maxRecords=1&filterByFormula=${ff}`, { headers: auth });
      if (fr.ok) { const rec = (((await fr.json()).records) || [])[0]; if (rec && (rec.fields || {})['Name']) missionary = rec.fields['Name']; }
    }
  } catch (e) {}
  const isDefault = missionary === DEFAULT_MISSIONARY;
  const nameEsc = missionary.replace(/'/g, "\\'");

  // ---- The wall is for the curated supporter team, not the open web. ----
  // Proof of belonging: a supporter token (carried in every email link) matching an
  // ACTIVE subscriber of this missionary, or a signed-in staff session (inside the org).
  // Without proof: the landing card only — identity + ask-to-follow, no updates.
  let viewer = null;   // { audience } for supporters, { staff:true } for staff
  // Staff first: a signed-in member browsing (even via an emailed supporter link)
  // is one of US — never stamped as a supporter visit, never counted as engagement.
  try { if (sessionFromEvent(event)) viewer = { staff: true }; } catch (e) {}
  const vt = (q.t || '').trim();
  if (!viewer && vt && /^[a-f0-9]{16,64}$/i.test(vt)) {
    try {
      const tf = encodeURIComponent(`AND({Token}='${vt}',{Missionary}='${missionary.replace(/'/g, "")}',{Active}=1)`);
      const trr = await fetch(`https://api.airtable.com/v0/${BASE}/${SUBS}?maxRecords=1&filterByFormula=${tf}`, { headers: auth });
      if (trr.ok) {
        const rec = (((await trr.json()).records) || [])[0];
        if (rec) {
          const a = rec.fields['Audience'];
          viewer = { audience: (a && a.name) ? a.name : (a || 'International'), name: rec.fields['Name'] || '', email: rec.fields['Email'] || '' };
          // Stamp the visit — fire and forget; the wall never waits on it.
          fetch(`https://api.airtable.com/v0/${BASE}/${SUBS}`, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: [{ id: rec.id, fields: { 'Last visit': new Date().toISOString() } }], typecast: true }) }).catch(() => {});
        }
      }
    } catch (e) {}
  }
  if (!viewer) { try { if (sessionFromEvent(event)) viewer = { staff: true }; } catch (e) {} }
  // Owner lens: a signed-in member can see the wall exactly as one supporter circle
  // sees it (?as=International|National|Both). Audience gates apply for real, but it
  // stays a staff session — nothing is ever counted from a preview.
  const asLens = (q.as || '').trim().toLowerCase();
  if (viewer && viewer.staff && ['international', 'national', 'both'].includes(asLens)) {
    viewer = { staff: true, preview: true, audience: asLens.charAt(0).toUpperCase() + asLens.slice(1) };
  }
  // A page that has gone dark returns nothing at all — no updates, no identity
  // beyond the name on the link. It is paused, not deleted, and it comes back the
  // moment somebody pays. The owner still gets in, so they can see their own work.
  try {
    const bill = require('./_billing');
    const auth2 = { Authorization: 'Bearer ' + token };
    if (await bill.enforcing(auth2)) {
      const rr = await fetch(`https://api.airtable.com/v0/${BASE}/${bill.MISS}?maxRecords=1&filterByFormula=${encodeURIComponent(`{Name}='${nameEsc}'`)}`, { headers: auth2 });
      if (rr.ok) {
        const rec = (((await rr.json()).records) || [])[0];
        const st = rec ? bill.stateOf(rec.fields) : null;
        if (st && !st.canRead && !(viewer && viewer.staff)) {
          return json(200, { paused: true, locked: true, page: { name: missionary }, updates: [] });
        }
      }
    }
  } catch (e) { /* never let a billing wobble take a wall down */ }

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
        created: rec.createdTime || '',
        opens:   c[F.opens] || 0,
        cover:   https(c[F.cover] || ''),
        video:   c[F.video] || '',
        excerpt: c[F.excerpt] || '',
        type:    (c[F.type] && c[F.type].name) ? c[F.type].name : (c[F.type] || ''),
        tags:    String(c[F.tags] || '').split(',').map(s => s.trim()).filter(Boolean),
        arc:     c[F.arc] || '',
        aud:     (c[F.aud] || []).map(a => (a && a.name) ? a.name : a),
        hl:      !!c[F.hl],
        blocks:  parseBlocks(c[F.blocks]),
        src:     (trObj && trObj.src) || '',            // original language, if not English
        tr:      (trObj && trObj.tr) || null            // inline { en: {title, blocks}, ... }
      };
    }).filter(u => u.title)
      // Circles within the team: national-only updates reach only the national circle.
      // Staff see everything; National/Both supporters see everything; International
      // supporters skip national-only posts.
      .filter(u => {
        const natOnly = u.aud.some(a => /in-country|national/i.test(a)) && !u.aud.some(a => /international/i.test(a));
        if (!natOnly) return true;
        if (viewer && viewer.staff && !viewer.preview) return true;
        return !!(viewer && (viewer.audience === 'National' || viewer.audience === 'Both'));
      })
      .sort((a, b) => (b.rawdate).localeCompare(a.rawdate) || (b.created || '').localeCompare(a.created || ''));

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
        // "first" = the names line of the sign-off (skip closing phrases like "With love,")
        // — it feeds personal touches like "Mel and Amy's highlights" and the give box.
        const soLines = (mfields[MIS_SIGN] || '').split('\n').map(l => l.trim()).filter(Boolean);
        const soFirst = (soLines.find(l => !/[,，:]$/.test(l)) || soLines[0] || '').trim();
        page = { name: mfields[MIS_NAME] || missionary, location: mfields[MIS_LOC] || '', org: mfields[MIS_ORG] || '', photo: mfields[MIS_PHOTO] || '', give: mfields[MIS_GIVE] || '', first: soFirst, country: '', orgName: '', native,
          rails: { hl: !mfields['fldhuobGXx9rv3vaO'], picks: !mfields['fldviqu0XW23doCM2'] } };
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
            page.orgGive = of2[ORG_GIVE] || '';
            if (!page.give && page.orgGive) page.give = page.orgGive;   // org general fund
          }
        }
      } catch (e) { /* no brand → JV defaults */ }
      // If the org string didn't match an org record, still show it as the co-brand country label.
      if (!page.country) page.country = page.org;
    }

    if (!viewer) {
      // Landing card only: who this is and how to ask to follow — no updates, ever.
      return json(200, { locked: true, style, page, brand, updates: [] }, 'no-store');
    }
    return json(200, { style, page, brand, updates, viewer: viewer && viewer.name ? { name: viewer.name, email: viewer.email } : null }, 'no-store');
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
