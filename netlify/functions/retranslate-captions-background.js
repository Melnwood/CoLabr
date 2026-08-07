// Co·labr — redo subtitle translations from corrected English. After the uploader fixes
// the English track (captions.js), this regenerates every other language FROM that English,
// so one human correction propagates to all thirteen translations. The English track and
// the speaker's native-language track are left exactly as they are. Secret-gated background.
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const TARGETS = ['en', 'cs', 'pl', 'uk', 'sk', 'ro', 'bg', 'sl', 'lv', 'et', 'hu', 'sr', 'de', 'es'];
const LNAME = { en:'English', cs:'Czech', pl:'Polish', uk:'Ukrainian', sk:'Slovak', ro:'Romanian', bg:'Bulgarian', sl:'Slovenian', lv:'Latvian', et:'Estonian', hu:'Hungarian', sr:'Serbian (Latin script)', ru:'Russian', de:'German', es:'Spanish', fr:'French' };

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return j(405);
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return j(400); }
    if (!b.secret || (b.secret !== process.env.SESSION_SECRET && b.secret !== process.env.IMPORT_SECRET)) return j(401);
    const token = process.env.AIRTABLE_TOKEN; if (!token || !b.u) return j(400);
    const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const api = `https://api.airtable.com/v0/${BASE}`;

    const gr = await fetch(`${api}/${UPDATES}/${b.u}`, { headers: auth });
    if (!gr.ok) return j(200);
    const f = (await gr.json()).fields || {};
    let blocks = []; try { blocks = JSON.parse(f['Blocks'] || '[]'); } catch {}
    let idx = parseInt(b.b || '-1', 10);
    if (!(blocks[idx] && blocks[idx].type === 'video' && (blocks[idx].captions || []).length)) {
      idx = blocks.findIndex(x => x && x.type === 'video' && (x.captions || []).length);
    }
    if (idx < 0) return j(200);
    const block = blocks[idx];
    const en = (block.captions || []).find(t => t.lang === 'en');
    if (!en) return j(200);
    const cues = parseVtt(en.vtt || '');
    if (!cues.length) return j(200);
    const native = block.lang || '';
    const keep = (block.captions || []).filter(t => t.lang === 'en' || t.lang === native);

    const mkVtt = texts => 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${vt(c.s)} --> ${vt(c.e)}\n${texts[i]}`).join('\n\n') + '\n';
    const fresh = [];
    for (const tgt of TARGETS) {
      if (tgt === 'en' || tgt === native) continue;
      try {
        const t = await translate(cues.map(c => c.t), tgt, LNAME[tgt] || tgt);
        if (t && t.length === cues.length) fresh.push({ lang: tgt, label: LNAME[tgt] || tgt, vtt: mkVtt(t) });
      } catch (e) {}
    }

    // Re-read before writing so a concurrent edit of another block isn't clobbered.
    const gr2 = await fetch(`${api}/${UPDATES}/${b.u}`, { headers: auth });
    if (gr2.ok) { try { blocks = JSON.parse(((await gr2.json()).fields || {})['Blocks'] || '[]'); } catch {} }
    if (!(blocks[idx] && blocks[idx].type === 'video')) return j(200);
    blocks[idx].captions = keep.concat(fresh);
    await fetch(`${api}/${UPDATES}`, { method: 'PATCH', headers: auth,
      body: JSON.stringify({ records: [{ id: b.u, fields: { Blocks: JSON.stringify(blocks) } }], typecast: true }) });
    console.log('retranslate-captions', b.u, 'tracks', keep.length + fresh.length);
    return j(200);
  } catch (e) { console.log('retranslate EXCEPTION', String(e && e.message || e)); return j(200); }
};

async function translate(lines, tgtCode, tgtName) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  const full = lines.join(' ');
  const numbered = lines.map((t, i) => `${i + 1}. ${t}`).join('\n');
  // The English here is HUMAN-CORRECTED — translate it faithfully, no guessing needed.
  const prompt = `Translate a Christian missionary's video subtitles from English into natural, warm, accurate ${tgtName}. The English was reviewed and corrected by the speaker, so treat it as exactly what was said.\n\nFull transcript (context only):\n"""\n${full}\n"""\n\nTranslate into ${tgtName} as exactly ${lines.length} caption segments matching these numbered lines (same order, same count, so on-screen timing matches). Keep names, places, and Scripture references accurate. Return ONLY a JSON array of ${lines.length} ${tgtName} strings — no numbering, no commentary.\n\n${numbered}`;
  const models = [process.env.ANTHROPIC_TRANSLATE_MODEL || 'claude-sonnet-4-5', 'claude-haiku-4-5'];
  for (const model of models) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 3000, messages: [{ role: 'user', content: prompt }] })
      });
      const jd = await res.json();
      if (jd.error) continue;
      const txt = (((jd.content || [])[0]) || {}).text || '';
      const m = txt.match(/\[[\s\S]*\]/); if (!m) continue;
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr) && arr.length) return arr.map(String);
    } catch (e) {}
  }
  return null;
}

function parseVtt(vtt) {
  const cues = [];
  for (const p of String(vtt).replace(/\r/g, '').split(/\n\n+/)) {
    const lines = p.split('\n').filter(x => x.trim() !== '');
    const tl = lines.findIndex(x => x.includes('-->'));
    if (tl < 0) continue;
    const m = lines[tl].match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
    if (!m) continue;
    cues.push({ s: sec(m[1]), e: sec(m[2]), t: lines.slice(tl + 1).join('\n') });
  }
  return cues;
}
function sec(ts) { const a = ts.split(':').map(Number); return a.length === 3 ? a[0] * 3600 + a[1] * 60 + a[2] : a[0] * 60 + a[1]; }
function vt(t) { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000); return `${p2(h)}:${p2(m)}:${p2(s)}.${p3(ms)}`; }
function p2(n) { return String(n).padStart(2, '0'); } function p3(n) { return String(n).padStart(3, '0'); }
function j(s) { return { statusCode: s, body: '{}' }; }
