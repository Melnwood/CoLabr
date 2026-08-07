// Co·labr — composer subtitle jobs. POST starts a transcription of an uploaded video
// (before publish — the "Translate" button); GET polls for the result. Staff only.
// Results are parked by transcribe-video-background in a hidden __TRANSCRIBE__<job> row;
// GET hands the payload to the composer and deletes the row.
const crypto = require('crypto');
const { sessionFromEvent } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  const s = sessionFromEvent(event);
  if (!s) return r(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN; if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
    if (!b.lang) return r(400, { error: 'Choose the spoken language first.' });
    const secret = process.env.SESSION_SECRET, site = process.env.SITE_BASE;
    if (!secret || !site) return r(500, { error: 'Server not configured.' });
    const job = crypto.randomBytes(12).toString('hex');

    // Lines mode: translate the uploader's corrected native lines to English.
    if (Array.isArray(b.lines) && b.lines.length) {
      if (b.lines.length > 600) return r(400, { error: 'Too many lines.' });
      await fetch(`${site}/.netlify/functions/transcribe-video-background`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, job, lang: b.lang, lines: b.lines.map(x => String(x || '')) })
      }).catch(() => {});
      return r(200, { job });
    }

    const url = (b.url || '').toString();
    if (!/^https:\/\/storage\.googleapis\.com\/.+\/videos\//.test(url)) return r(400, { error: 'Upload the video first.' });
    await fetch(`${site}/.netlify/functions/transcribe-video-background`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, job, lang: b.lang, gsUri: url.replace(/^https:\/\/storage\.googleapis\.com\//, 'gs://') })
    }).catch(() => {});
    return r(200, { job });
  }

  if (event.httpMethod === 'GET') {
    const job = ((event.queryStringParameters || {}).job || '').replace(/[^a-f0-9]/g, '').slice(0, 32);
    if (!job) return r(400, { error: 'Which job?' });
    const f = encodeURIComponent(`{Title}='__TRANSCRIBE__${job}'`);
    const gr = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?filterByFormula=${f}&pageSize=1`, { headers: auth });
    if (!gr.ok) return r(200, { ready: false });
    const rec = (((await gr.json()).records || [])[0]);
    if (!rec) return r(200, { ready: false });
    let payload = {}; try { payload = JSON.parse((rec.fields || {})['Body'] || '{}'); } catch {}
    await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}/${rec.id}`, { method: 'DELETE', headers: auth }).catch(() => {});
    return r(200, { ready: true, ...payload });
  }

  return r(405, { error: 'Method not allowed' });
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
