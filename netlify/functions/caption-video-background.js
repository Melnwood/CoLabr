// Co-Labr — heart-language pipeline stage 2. Transcribe a video already in GCS with Google
// Video Intelligence, translate the transcript to English with Claude, build a WebVTT caption
// track, and attach it to a Co-Labr update (published test) so it plays captioned on the page.
// Background function (up to 15 min) so long transcriptions don't time out. Secret-gated.
const crypto = require('crypto');
const BASE = 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  let scratch = 'start';
  try {
    if (event.httpMethod !== 'POST') return j(405, {});
    let raw = event.body || ''; if (event.isBase64Encoded) { try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch {} }
    const ct = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
    let b = {};
    if (/application\/json/i.test(ct)) { try { b = JSON.parse(raw || '{}'); } catch { return j(400, {}); } }
    else { const p = new URLSearchParams(raw); b = { secret: p.get('secret'), gsUri: p.get('gsUri'), lang: p.get('lang'), title: p.get('title') }; }
    if (!b.secret || (b.secret !== process.env.SESSION_SECRET && b.secret !== process.env.IMPORT_SECRET)) return j(401, {});
    if (!b.gsUri) return j(400, {});

    let sa; try { sa = JSON.parse(process.env.GCP_SA_KEY || ''); } catch { return j(500, {}); }
    const srcLang = b.lang || 'en-US';
    const token = await gToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

    // 1) Kick off Video Intelligence speech transcription.
    const annotate = await fetch('https://videointelligence.googleapis.com/v1/videos:annotate', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputUri: b.gsUri, features: ['SPEECH_TRANSCRIPTION'],
        videoContext: { speechTranscriptionConfig: { languageCode: srcLang, enableAutomaticPunctuation: true, maxAlternatives: 1 } } })
    });
    const annJson = await annotate.json();
    if (!annotate.ok || !annJson.name) { await log('ERROR annotate ' + JSON.stringify(annJson).slice(0, 300)); return j(200, {}); }
    const opName = annJson.name;

    // 2) Poll the long-running operation (up to ~13 min).
    let done = null;
    for (let i = 0; i < 95; i++) {
      await sleep(8000);
      const pr = await fetch('https://videointelligence.googleapis.com/v1/' + opName, { headers: { Authorization: 'Bearer ' + token } });
      const pj = await pr.json();
      if (pj.error) { await log('ERROR op ' + JSON.stringify(pj.error).slice(0, 300)); return j(200, {}); }
      if (pj.done) { done = pj; break; }
    }
    if (!done) { await log('ERROR transcription timed out'); return j(200, {}); }

    // 3) Pull word-level results → cues in the source language.
    const results = (((done.response || {}).annotationResults || [])[0] || {});
    const transcriptions = results.speechTranscriptions || [];
    const words = [];
    for (const tsc of transcriptions) {
      const alt = (tsc.alternatives || [])[0]; if (!alt || !alt.words) continue;
      for (const w of alt.words) words.push({ w: w.word, s: dur(w.startTime), e: dur(w.endTime) });
    }
    if (!words.length) { await log('ERROR no speech recognized (lang ' + srcLang + ')'); return j(200, {}); }
    const cues = groupCues(words);

    // 4) Translate the cue texts to English with Claude (fallback: keep source).
    let enTexts = cues.map(c => c.text);
    try { const t = await translate(cues.map(c => c.text), srcLang); if (t && t.length === cues.length) enTexts = t; } catch (e) { await log('WARN translate ' + String(e.message || e)); }

    // 5) Build a WebVTT track.
    const vtt = 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${vt(c.s)} --> ${vt(c.e)}\n${enTexts[i]}`).join('\n\n') + '\n';

    // 6) Attach to a published update so it plays captioned on the page.
    const httpUrl = b.gsUri.replace(/^gs:\/\//, 'https://storage.googleapis.com/');
    const blocks = [
      { type: 'video', url: httpUrl, lang: (srcLang.split('-')[0]), captions: [{ lang: 'en', label: 'English', vtt }] },
      { type: 'text', text: 'Captions were generated automatically (Google transcription + Claude translation) and may contain small errors.' }
    ];
    const title = b.title || '🎬 Video caption test (safe to delete)';
    await createUpdate(title, blocks);
    await log(JSON.stringify({ ok: true, cues: cues.length, srcLang, sample: enTexts.slice(0, 3) }));
    return j(200, { ok: true });
  } catch (e) {
    try { await log('EXCEPTION ' + String(e && e.message || e)); } catch {}
    return j(200, {});
  }
};

function groupCues(words) {
  const cues = []; let cur = [];
  const flush = () => { if (!cur.length) return; cues.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map(x => x.w).join(' ').replace(/\s+([,.!?;:])/g, '$1') }); cur = []; };
  for (const w of words) {
    cur.push(w);
    const endsSentence = /[.!?]$/.test(w.w);
    const longEnough = cur.length >= 9 || (w.e - cur[0].s) >= 4.5;
    if (endsSentence || longEnough) flush();
  }
  flush();
  return cues;
}

async function translate(lines, srcLang) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
  const numbered = lines.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const prompt = `You are translating spoken captions from a missionary video (source language code ${srcLang}) into natural, warm English. Translate each numbered line. Keep names and places accurate. Return ONLY a JSON array of strings, one per line, in the same order, no numbering.\n\n${numbered}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
  });
  const jd = await res.json();
  const txt = (((jd.content || [])[0]) || {}).text || '';
  const m = txt.match(/\[[\s\S]*\]/); if (!m) return null;
  const arr = JSON.parse(m[0]); return Array.isArray(arr) ? arr.map(String) : null;
}

async function createUpdate(title, blocks) {
  const token = process.env.AIRTABLE_TOKEN; if (!token) return;
  await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields: { Title: title, Status: 'Published', Blocks: JSON.stringify(blocks), Source: 'video-caption', Missionary: ['The Ellenwood Family'], Date: new Date().toISOString().slice(0, 10) } }], typecast: true })
  }).catch(() => {});
}

async function log(body) {
  const token = process.env.AIRTABLE_TOKEN; if (!token) return;
  await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields: { Title: '__VIDEO_CAPTION__', Body: body, Status: 'Draft', Source: 'video-caption' } }], typecast: true }) }).catch(() => {});
}

function dur(d) { if (d == null) return 0; if (typeof d === 'string') return parseFloat(d.replace('s', '')) || 0; if (typeof d === 'object') return (Number(d.seconds || 0)) + (Number(d.nanos || 0) / 1e9); return Number(d) || 0; }
function vt(t) { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000); return `${p2(h)}:${p2(m)}:${p2(s)}.${p3(ms)}`; }
function p2(n) { return String(n).padStart(2, '0'); } function p3(n) { return String(n).padStart(3, '0'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function gToken(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64u(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(h + '.' + c).sign(sa.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: h + '.' + c + '.' + sig }) });
  const jj = await res.json(); if (!jj.access_token) throw new Error('no token'); return jj.access_token;
}
function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function j(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }; }
