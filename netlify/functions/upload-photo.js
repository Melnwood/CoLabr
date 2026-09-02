// Co·labr — photo upload to Google Cloud Storage (one central JV bucket).
// Requires a signed-in staff session. Env: GCS_BUCKET, GCP_SA_KEY (service-account JSON).
const { sessionFromEvent } = require('./_auth');
const crypto = require('crypto');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  if (!sessionFromEvent(event)) return r(401, { error: 'Please sign in.' });

  // Update photos have to be public: they are embedded in emails that people open
  // weeks later, and a signed URL would have expired by then. Sandbox screenshots are
  // the opposite. They show whatever was on a tester's screen when something broke,
  // which is routinely a live dashboard or somebody's private wall, and only signed-in
  // members ever look at them. Those go somewhere strangers cannot reach.
  const PRIVATE_FOLDERS = ['feedback'];
  const privateBucket = process.env.GCS_PRIVATE_BUCKET || process.env.GCS_BACKUP_BUCKET || '';
  const keyRaw = process.env.GCP_SA_KEY;
  if (!bucket || !keyRaw) return r(500, { error: 'Photo storage is not set up yet.' });
  let sa; try { sa = JSON.parse(keyRaw); } catch { return r(500, { error: 'Service account key is not valid JSON.' }); }

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  if (!b.data) return r(400, { error: 'No image data.' });

  const type = b.type || 'image/jpeg';
  const ext = (type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const folder = /^[a-z0-9_-]{1,24}$/i.test(b.folder || '') ? b.folder : 'updates';
  const wantsPrivate = PRIVATE_FOLDERS.includes(folder) && !!privateBucket;
  const bucket = wantsPrivate ? privateBucket : process.env.GCS_BUCKET;
  const name = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    const token = await getAccessToken(sa);
    const bytes = Buffer.from(b.data, 'base64');
    const up = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`,
      { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': type }, body: bytes }
    );
    if (!up.ok) { const t = await up.text(); return r(up.status, { error: 'Upload failed. ' + t.slice(0, 140) }); }
    // A private object has no public URL, so hand back the reader that checks the
    // caller instead. Everything else keeps the direct storage link it has always had.
    return r(200, { url: wantsPrivate
      ? `/.netlify/functions/shot?f=${encodeURIComponent(name)}`
      : `https://storage.googleapis.com/${bucket}/${name}` });
  } catch (e) {
    return r(502, { error: 'Could not upload the photo.' });
  }
};

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.read_write',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  });
  const input = header + '.' + claim;
  const sig = crypto.createSign('RSA-SHA256').update(input).sign(sa.private_key)
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = input + '.' + sig;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('no token');
  return j.access_token;
}
function b64(o) { return Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
