// Co·labr — compose-time transcription. Fired from the composer's "Translate" button
// (via caption-job.js) BEFORE publish: transcribes the uploaded video, translates the
// transcript to English, and parks the result in a hidden job row the composer polls.
// The uploader then reviews the English in the composer overlay — publish only happens
// once the subtitles are already checked. Secret-gated background function.
const crypto = require('crypto');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  let job = '';
  try {
    if (event.httpMethod !== 'POST') return j(405);
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return j(400); }
    if (!b.secret || (b.secret !== process.env.SESSION_SECRET && b.secret !== process.env.IMPORT_SECRET)) return j(401);
    job = String(b.job || '').replace(/[^a-f0-9]/g, '').slice(0, 32);
    if (!job) return j(400);

    // Lines mode: the uploader corrected their native-language cues in the composer;
    // translate exactly those corrected lines to English (no transcription involved).
    if (Array.isArray(b.lines) && b.lines.length) {
      const lines = b.lines.slice(0, 600).map(x => String(x || ''));
      const src = b.lang || 'en-US';
      let en = lines.slice();
      if (src.split('-')[0] !== 'en') {
        try { const t = await translate(lines, src, true); if (t && t.length === lines.length) en = t; }
        catch (e) { await park(job, { error: 'Translation failed — you can still fix the English by hand.' }); return j(200); }
        if (en === lines || en.length !== lines.length) { await park(job, { error: 'Translation failed — you can still fix the English by hand.' }); return j(200); }
      }
      await park(job, { en });
      return j(200);
    }

    if (!b.gsUri) return j(400);

    let sa; try { sa = JSON.parse(process.env.GCP_SA_KEY || ''); } catch { await park(job, { error: 'Server not configured.' }); return j(200); }
    const srcLang = b.lang || 'en-US';
    const token = await gToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

    const annotate = await fetch('https://videointelligence.googleapis.com/v1/videos:annotate', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputUri: b.gsUri, features: ['SPEECH_TRANSCRIPTION'],
        videoContext: { speechTranscriptionConfig: { languageCode: srcLang, enableAutomaticPunctuation: true, maxAlternatives: 1,
          speechContexts: [{ phrases: ['Josiah Venture', 'Kristus', 'Ježíš', 'evangelium', 'církev', 'učedník', 'mládež', 'tábor', 'English Camp', 'discipleship', 'gospel', 'church', 'Jesus'] }] } } })
    });
    const annJson = await annotate.json();
    if (!annotate.ok || !annJson.name) { await park(job, { error: 'Could not start transcription.' }); return j(200); }

    let done = null;
    for (let i = 0; i < 95; i++) {
      await sleep(8000);
      const pr = await fetch('https://videointelligence.googleapis.com/v1/' + annJson.name, { headers: { Authorization: 'Bearer ' + token } });
      const pj = await pr.json();
      if (pj.error) { await park(job, { error: 'Transcription failed.' }); return j(200); }
      if (pj.done) { done = pj; break; }
    }
    if (!done) { await park(job, { error: 'Transcription timed out — try again.' }); return j(200); }

    const results = (((done.response || {}).annotationResults || [])[0] || {});
    const words = [];
    for (const tsc of (results.speechTranscriptions || [])) {
      const alt = (tsc.alternatives || [])[0]; if (!alt || !alt.words) continue;
      for (const w of alt.words) words.push({ w: w.word, s: dur(w.startTime), e: dur(w.endTime) });
    }
    if (!words.length) { await park(job, { error: 'No speech was recognized — is the spoken language right?' }); return j(200); }
    const cues = groupCues(words);

    const srcShort = srcLang.split('-')[0];
    let en = cues.map(c => c.text);
    if (srcShort !== 'en') {
      try { const t = await translate(cues.map(c => c.text), srcLang); if (t && t.length === cues.length) en = t; }
      catch (e) {}
    }
    await park(job, { srcLang: srcShort, cues: cues.map(c => ({ s: c.s, e: c.e, t: c.text })), en });
    return j(200);
  } catch (e) {
    try { if (job) await park(job, { error: 'Something went wrong — try again.' }); } catch (e2) {}
    return j(200);
  }
};

// Job results live as hidden rows in the updates table (title __TRANSCRIBE__<job>) —
// the same invisible-row pattern the caption logs use; dashboards filter them out.
async function park(job, payload) {
  const token = process.env.AIRTABLE_TOKEN; if (!token) return;
  await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields: { Title: '__TRANSCRIBE__' + job, Body: JSON.stringify(payload), Status: 'Draft', Source: 'video-caption' } }], typecast: true })
  }).catch(() => {});
}

function groupCues(words) {
  const cues = []; let cur = [];
  const flush = () => { if (!cur.length) return; cues.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map(x => x.w).join(' ').replace(/\s+([,.!?;:])/g, '$1') }); cur = []; };
  for (const w of words) {
    cur.push(w);
    if (/[.!?]$/.test(w.w) || cur.length >= 9 || (w.e - cur[0].s) >= 4.5) flush();
  }
  flush();
  return cues;
}

async function translate(lines, srcLang, trusted) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  const full = lines.join(' ');
  const numbered = lines.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const provenance = trusted
    ? 'The source text was reviewed and corrected by the speaker themselves — treat it as exactly what was said and translate it faithfully; do not second-guess or "fix" it.'
    : 'The source text came from automatic speech recognition and may contain small errors — read the WHOLE transcript first and use the overall meaning to quietly fix obvious mis-hearings so the English reads true to what was said.';
  const prompt = `You are translating a Christian missionary's spoken video into natural, warm, accurate English (source language code: ${srcLang}). ${provenance}\n\nFull transcript (context only):\n"""\n${full}\n"""\n\nTranslate into English as exactly ${lines.length} caption segments matching these numbered source lines (same order, same count, so on-screen timing matches). Keep names, places, and Scripture references accurate. Return ONLY a JSON array of ${lines.length} English strings — no numbering, no commentary.\n\n${numbered}`;
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

function dur(d) { if (d == null) return 0; if (typeof d === 'string') return parseFloat(d.replace('s', '')) || 0; if (typeof d === 'object') return (Number(d.seconds || 0)) + (Number(d.nanos || 0) / 1e9); return Number(d) || 0; }
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
function j(s) { return { statusCode: s, body: '{}' }; }
