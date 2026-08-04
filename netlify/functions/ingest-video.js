// Co-Labr — pull a video from a shared Google Drive link into JV's Google Cloud Storage,
// server-side (no size cap on our side). Secret-gated. Writes the resulting GCS URL onto a
// scratch Airtable record (__VIDEO_INGEST__) so we can confirm it landed.
// This is the "any-size ingest" step of the heart-language (video subtitles) pipeline.
const crypto = require('crypto');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return j(405, { error: 'Method not allowed' });
    let raw = event.body || ''; if (event.isBase64Encoded) { try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch {} }
    const ct = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
    let b = {};
    if (/application\/json/i.test(ct)) { try { b = JSON.parse(raw || '{}'); } catch { return j(400, { error: 'Bad JSON' }); } }
    else { const p = new URLSearchParams(raw); b = { secret: p.get('secret'), fileId: p.get('fileId'), name: p.get('name') }; }

    const ok = b.secret && (b.secret === process.env.SESSION_SECRET || b.secret === process.env.IMPORT_SECRET);
    if (!ok) return j(401, { error: 'Unauthorized' });
    if (!b.fileId) return j(400, { error: 'Need a Drive fileId' });

    const bucket = process.env.GCS_BUCKET;
    let sa; try { sa = JSON.parse(process.env.GCP_SA_KEY || ''); } catch { return j(500, { error: 'SA key invalid' }); }
    if (!bucket) return j(500, { error: 'No bucket' });

    // 1) Fetch the file from Drive (must be shared "anyone with the link").
    const buf = await fetchDrive(b.fileId);
    const size = buf.length;

    // 2) Upload to GCS.
    const ext = (b.name && b.name.split('.').pop() || 'mov').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mov';
    const objName = `videos/${b.fileId}.${ext}`;
    const token = await gcsToken(sa);
    const up = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objName)}`,
      { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': mimeFor(ext) }, body: buf });
    if (!up.ok) { const t = await up.text(); await logScratch(b.fileId, 'ERROR upload ' + up.status + ' ' + t.slice(0, 120)); return j(502, { error: 'GCS upload failed ' + t.slice(0, 140) }); }

    const gsUri = `gs://${bucket}/${objName}`;
    const httpUrl = `https://storage.googleapis.com/${bucket}/${objName}`;
    await logScratch(b.fileId, JSON.stringify({ ok: true, size, gsUri, httpUrl }));
    return j(200, { ok: true, size, gsUri, httpUrl });
  } catch (e) {
    try { await logScratch('err', 'EXCEPTION ' + String(e && e.message || e)); } catch {}
    return j(500, { error: String(e && e.message || e) });
  }
};

// Google Drive public download, handling the large-file confirm interstitial.
async function fetchDrive(fileId) {
  const u1 = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  let res = await fetch(u1, { headers: { 'User-Agent': 'Mozilla/5.0 CoLabr' } });
  const ctype = res.headers.get('content-type') || '';
  if (/text\/html/i.test(ctype)) {
    const html = await res.text();
    const uuid = (html.match(/name="uuid" value="([^"]+)"/) || [])[1];
    const confirm = (html.match(/name="confirm" value="([^"]+)"/) || [])[1] || 't';
    const u2 = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${encodeURIComponent(confirm)}${uuid ? '&uuid=' + encodeURIComponent(uuid) : ''}`;
    res = await fetch(u2, { headers: { 'User-Agent': 'Mozilla/5.0 CoLabr' } });
  }
  if (!res.ok) throw new Error('drive fetch ' + res.status);
  const ct2 = res.headers.get('content-type') || '';
  if (/text\/html/i.test(ct2)) throw new Error('drive still returned HTML — is the file shared "anyone with the link"?');
  return Buffer.from(await res.arrayBuffer());
}

function mimeFor(ext) { return ({ mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm' })[ext] || 'application/octet-stream'; }

async function logScratch(fileId, body) {
  const token = process.env.AIRTABLE_TOKEN; if (!token) return;
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'POST', headers: auth,
    body: JSON.stringify({ records: [{ fields: { Title: '__VIDEO_INGEST__', Body: body, Status: 'Draft', Source: 'video-ingest' } }], typecast: true }) }).catch(() => {});
}

async function gcsToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/devstorage.read_write', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(header + '.' + claim).sign(sa.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: header + '.' + claim + '.' + sig }) });
  const jj = await res.json(); if (!jj.access_token) throw new Error('no gcs token'); return jj.access_token;
}
function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function j(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
