// Co·labr — disaster repair, zero AI cost. The per-language translation FILES in
// GCS survived the dead-API wipe of 2026-08-10; only the records' inline TR index
// and the manifests were clobbered. This walks every published update, reads the
// surviving <recId>/<lang>.json files, and rebuilds the inline {src,h,tr} field +
// index.json from them. Idempotent; secret-gated; no Anthropic calls at all.
const crypto = require('crypto');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';
const TR_FIELD = 'fld9BeSNNbZpUAtd0';
const TARGETS = ['en', 'cs', 'pl', 'uk', 'sk', 'ro', 'bg', 'sl', 'lv', 'et', 'hu', 'sr', 'de', 'es'];
const LNAME = { en:'English', cs:'Czech', pl:'Polish', uk:'Ukrainian', sk:'Slovak', ro:'Romanian', bg:'Bulgarian', sl:'Slovenian', lv:'Latvian', et:'Estonian', hu:'Hungarian', sr:'Serbian (Latin script)', de:'German', es:'Spanish' };
const FIELDS = { text:['text'], heading:['text'], quote:['text','by'], prayer:['text'], praise:['text'], signoff:['text'], hero:['heading','sub'], photo:['caption'], numbers:['al','bl','cl'], give:['label'], button:['label'] };

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return j(405);
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return j(400); }
    if (!b.secret || (b.secret !== process.env.SESSION_SECRET && b.secret !== process.env.IMPORT_SECRET)) return j(401);
    const airToken = process.env.AIRTABLE_TOKEN, bucket = process.env.GCS_BUCKET;
    let sa; try { sa = JSON.parse(process.env.GCP_SA_KEY || ''); } catch { return j(500); }
    if (!airToken || !bucket) return j(500);
    const auth = { Authorization: 'Bearer ' + airToken, 'Content-Type': 'application/json' };
    const gcsToken = await gToken(sa, 'https://www.googleapis.com/auth/devstorage.read_write');

    // Every published update that has blocks.
    let recs = [], url = `https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100&filterByFormula=${encodeURIComponent(`{Status}='Published'`)}`;
    while (url) {
      const r = await fetch(url, { headers: auth }); if (!r.ok) break;
      const d = await r.json(); recs = recs.concat(d.records || []);
      url = d.offset ? url.split('&offset=')[0] + '&offset=' + d.offset : '';
    }

    let repaired = 0, untouched = 0, empty = 0;
    for (const rec of recs) {
      try {
        const c = rec.fields || {};
        let blocks = []; try { blocks = JSON.parse(c['Blocks'] || '[]'); } catch (e) {}
        if (!blocks.length) { empty++; continue; }
        const items = [];
        blocks.forEach((bk, i) => { (FIELDS[bk.type] || []).forEach(f => { if (bk[f] && String(bk[f]).trim()) items.push({ i, f, s: String(bk[f]) }); }); });
        const title = c['Title'] || '';
        const strings = [title, ...items.map(x => x.s)];
        if (!strings.join('').trim()) { empty++; continue; }
        const hash = crypto.createHash('sha1').update(strings.join('␞')).digest('hex').slice(0, 12);

        // Source language: surviving manifest first, else assume English.
        let src = 'en';
        try {
          const ir = await fetch(`https://storage.googleapis.com/${bucket}/translations/${rec.id}/index.json`, { cache: 'no-store' });
          if (ir.ok) { const idx = await ir.json(); if (idx && idx.src) src = idx.src; }
        } catch (e) {}

        // Gather every surviving language file into the inline index.
        const tr = {}, langs = [];
        for (const lang of TARGETS) {
          try {
            const fr = await fetch(`https://storage.googleapis.com/${bucket}/translations/${rec.id}/${lang}.json`, { cache: 'no-store' });
            if (!fr.ok) continue;
            const p = await fr.json();
            if (!p || !Array.isArray(p.blocks)) continue;
            langs.push(lang);
            if (lang === src) continue;
            const ex = p.blocks.filter(x => x && ['text', 'quote', 'prayer', 'praise'].includes(x.type) && x.text)
              .map(x => String(x.text)).join(' ').replace(/\s+/g, ' ').trim().slice(0, 220);
            tr[lang] = { title: p.title || title, ex };
          } catch (e) {}
        }

        // Only write when the rebuild KNOWS MORE than the record currently does.
        let curCount = -1;
        try { const cur = JSON.parse(c['TR'] || '{}'); if (cur && cur.h === hash && cur.tr) curCount = Object.keys(cur.tr).length; } catch (e) {}
        if (Object.keys(tr).length <= curCount) { untouched++; continue; }

        await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'PATCH', headers: auth,
          body: JSON.stringify({ records: [{ id: rec.id, fields: { [TR_FIELD]: JSON.stringify({ src, h: hash, tr }) } }], typecast: true }) });
        await putJson(gcsToken, bucket, `translations/${rec.id}/index.json`, { src, langs, names: LNAME });
        repaired++;
      } catch (e) {}
    }
    console.log('rebuild-inline done', JSON.stringify({ scanned: recs.length, repaired, untouched, empty }));
    return j(200);
  } catch (e) { console.log('rebuild-inline EXCEPTION', String(e && e.message || e)); return j(200); }
};

async function putJson(token, bucket, name, obj) {
  const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  return r.ok;
}
async function gToken(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), cl = b64u(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(h + '.' + cl).sign(sa.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: h + '.' + cl + '.' + sig }) });
  const jj = await res.json(); if (!jj.access_token) throw new Error('no token'); return jj.access_token;
}
function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function j(s) { return { statusCode: s || 200, headers: { 'Content-Type': 'application/json' }, body: '{}' }; }
