// Co-Labr — heart-language for written updates. When an update is published, translate its
// text into every JV field language + English with Claude, and store one JSON per language in
// GCS (translations/<recordId>/<lang>.json) so the supporter page & emails can show each reader
// their own language. Background function (up to 15 min). Secret-gated. Idempotent (overwrites).
const crypto = require('crypto');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';
const TARGETS = ['en', 'cs', 'pl', 'uk', 'sk', 'ro', 'bg', 'sl', 'lv', 'et', 'hu', 'sr', 'de', 'es'];
const LNAME = { en:'English', cs:'Czech', pl:'Polish', uk:'Ukrainian', sk:'Slovak', ro:'Romanian', bg:'Bulgarian', sl:'Slovenian', lv:'Latvian', et:'Estonian', hu:'Hungarian', sr:'Serbian (Latin script)' , de:'German', es:'Spanish' };
// Which fields of each block hold translatable text.
const FIELDS = { text:['text'], heading:['text'], quote:['text','by'], prayer:['text'], praise:['text'], signoff:['text'], hero:['heading','sub'], photo:['caption'], numbers:['al','bl','cl'], give:['label'], button:['label'] };

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return j(405);
    let raw = event.body || ''; if (event.isBase64Encoded) { try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch {} }
    const ct = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
    let b = {}; if (/application\/json/i.test(ct)) { try { b = JSON.parse(raw || '{}'); } catch { return j(400); } }
    else { const p = new URLSearchParams(raw); b = { secret: p.get('secret'), recordId: p.get('recordId') }; }
    if (!b.secret || (b.secret !== process.env.SESSION_SECRET && b.secret !== process.env.IMPORT_SECRET)) return j(401);
    if (!b.recordId) return j(400);

    const airToken = process.env.AIRTABLE_TOKEN, key = process.env.ANTHROPIC_API_KEY, bucket = process.env.GCS_BUCKET;
    let sa; try { sa = JSON.parse(process.env.GCP_SA_KEY || ''); } catch { return j(500); }
    if (!airToken || !key || !bucket) return j(500);
    const auth = { Authorization: 'Bearer ' + airToken, 'Content-Type': 'application/json' };

    const gr = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}/${b.recordId}`, { headers: auth });
    if (!gr.ok) return j(200);
    const c = (await gr.json()).fields || {};
    let blocks = []; try { blocks = JSON.parse(c['Blocks'] || '[]'); } catch {}
    if (!blocks.length) return j(200);

    // Extract the ordered list of translatable strings + where each came from.
    const items = [];
    blocks.forEach((bk, i) => { (FIELDS[bk.type] || []).forEach(f => { if (bk[f] && String(bk[f]).trim()) items.push({ i, f, s: String(bk[f]) }); }); });
    const title = c['Title'] || '';
    const strings = [title, ...items.map(x => x.s)];  // index 0 = title
    if (!strings.join('').trim()) return j(200);

    const gcsToken = await gToken(sa, 'https://www.googleapis.com/auth/devstorage.read_write');
    const src = await detectLang(key, strings.slice(0, 3).join(' \n '));

    // RESUMABLE: the record carries {src, h(content hash), tr:{lang:{title,ex}}}.
    // Same content + language already done = skip. Changed content = start fresh.
    // Progress is saved after EVERY language, so a timed-out run loses nothing.
    const hash = crypto.createHash('sha1').update(strings.join('␞')).digest('hex').slice(0, 12);
    let inline = { src, h: hash, tr: {} };
    try {
      const prev = JSON.parse(c['Translations'] || '{}');
      if (prev && prev.h === hash && prev.src === src && prev.tr) inline.tr = prev.tr;
    } catch (e) {}
    const saveInline = async () => {
      try {
        await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'PATCH', headers: auth,
          body: JSON.stringify({ records: [{ id: b.recordId, fields: { 'fld9BeSNNbZpUAtd0': JSON.stringify(inline) } }], typecast: true }) });
      } catch (e) {}
    };
    const langsDone = [];

    for (const lang of TARGETS) {
      if (lang !== src && inline.tr[lang]) { langsDone.push(lang); continue; }   // already translated for this content
      let outStrings;
      if (lang === src) { outStrings = strings; }                 // source language = original text
      else {
        try { outStrings = await translateAll(key, strings, lang); } catch (e) { outStrings = null; }
        if (!outStrings || outStrings.length !== strings.length) continue;  // skip a language that failed
      }
      // Rebuild blocks with translated text.
      const tb = JSON.parse(JSON.stringify(blocks));
      items.forEach((it, idx) => { if (tb[it.i]) tb[it.i][it.f] = outStrings[idx + 1]; });
      const payload = { lang, title: outStrings[0], blocks: tb };
      const okUp = await putJson(gcsToken, bucket, `translations/${b.recordId}/${lang}.json`, payload);
      if (okUp) langsDone.push(lang);
      if (lang !== src) {
        const bodyBits = items.map((it, idx) => ({ t: it, s: outStrings[idx + 1] }))
          .filter(x => ['text', 'quote', 'prayer', 'praise'].includes(blocks[x.t.i] && blocks[x.t.i].type))
          .map(x => x.s);
        inline.tr[lang] = { title: outStrings[0], ex: bodyBits.join(' ').replace(/\s+/g, ' ').trim().slice(0, 220) };
        await saveInline();   // progress survives any timeout
      }
    }

    // Manifest so the page knows what's available + the source language.
    await putJson(gcsToken, bucket, `translations/${b.recordId}/index.json`, { src, langs: langsDone, names: LNAME });
    await saveInline();
    await log(auth, JSON.stringify({ ok: true, src, langs: langsDone }));
    return j(200);
  } catch (e) { try { await log({ Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN, 'Content-Type': 'application/json' }, 'EXCEPTION ' + String(e && e.message || e)); } catch {} return j(200); }
};

async function detectLang(key, sample) {
  try {
    const r = await claude(key, `What ISO 639-1 two-letter language code is this text written in? Reply with ONLY the two-letter code.\n\n${sample.slice(0, 500)}`, 8);
    const m = (r || '').toLowerCase().match(/[a-z]{2}/); return m ? m[0] : 'en';
  } catch { return 'en'; }
}
async function translateAll(key, strings, lang) {
  const numbered = strings.map((t, i) => `${i}⟶ ${t.replace(/\n/g, ' ⏎ ')}`).join('\n');
  const prompt = `Translate each numbered line into ${LNAME[lang] || lang}. These are pieces of a missionary's support update — keep names, places, and Scripture references accurate, and keep the warm, personal tone. Preserve the ⏎ markers exactly (they are line breaks). Return ONLY a JSON array of strings, one per numbered line, in the same order, with the same count (${strings.length}). Do not include the numbers.\n\n${numbered}`;
  const txt = await claude(key, prompt, 8000);
  const m = txt.match(/\[[\s\S]*\]/); if (!m) return null;
  const arr = JSON.parse(m[0]);
  return Array.isArray(arr) ? arr.map(s => String(s).replace(/ ⏎ /g, '\n').replace(/⏎/g, '\n')) : null;
}
async function claude(key, prompt, maxTokens) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
  // Rate limits happen on bulk runs — back off and retry instead of silently
  // skipping a language (a skipped language = an untranslated wall card).
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }) });
    const jd = await res.json();
    if (res.status === 429 || (jd.error && /rate|overloaded/i.test(jd.error.type || jd.error.message || ''))) {
      await new Promise(r => setTimeout(r, 15000 * (attempt + 1)));
      continue;
    }
    return (((jd.content || [])[0]) || {}).text || '';
  }
  return '';
}
async function putJson(token, bucket, name, obj) {
  const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  return r.ok;
}
async function log(auth, body) { await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'POST', headers: auth, body: JSON.stringify({ records: [{ fields: { Title: '__TRANSLATE__', Body: body, Status: 'Draft', Source: 'translate' } }], typecast: true }) }).catch(() => {}); }
async function gToken(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), cl = b64u(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(h + '.' + cl).sign(sa.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: h + '.' + cl + '.' + sig }) });
  const jj = await res.json(); if (!jj.access_token) throw new Error('no token'); return jj.access_token;
}
function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function j(s) { return { statusCode: s || 200, headers: { 'Content-Type': 'application/json' }, body: '{}' }; }
