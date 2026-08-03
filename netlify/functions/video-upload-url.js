// Co-Labr — start a resumable upload straight to GCS so the browser can send a large video
// directly (no function body-size limit). Signed-in staff only. Returns a one-time upload URL
// plus the eventual public URL. The browser PUTs the file bytes to uploadUrl.
const { sessionFromEvent } = require('./_auth');
const crypto = require('crypto');

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return j(405, { error: 'Method not allowed' });
    if (!sessionFromEvent(event)) return j(401, { error: 'Please sign in.' });
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'Bad request.' }); }
    const type = (b.type || 'video/mp4').toString();
    if (!/^video\//.test(type)) return j(400, { error: 'That is not a video file.' });
    const bucket = process.env.GCS_BUCKET;
    let sa; try { sa = JSON.parse(process.env.GCP_SA_KEY || ''); } catch { return j(500, { error: 'Storage not set up.' }); }

    const ext = (type.split('/')[1] || 'mp4').replace('quicktime', 'mov').replace('x-m4v', 'm4v').replace(/[^a-z0-9]/g, '') || 'mp4';
    const name = `videos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const token = await gToken(sa, 'https://www.googleapis.com/auth/devstorage.read_write');
    const start = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=resumable&name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type }, body: JSON.stringify({})
    });
    if (!start.ok) { const t = await start.text(); return j(start.status, { error: 'Could not start upload. ' + t.slice(0, 140) }); }
    const uploadUrl = start.headers.get('location');
    if (!uploadUrl) return j(502, { error: 'No upload URL returned.' });
    return j(200, { uploadUrl, publicUrl: `https://storage.googleapis.com/${bucket}/${name}`, gsUri: `gs://${bucket}/${name}`, contentType: type });
  } catch (e) { return j(500, { error: String(e && e.message || e) }); }
};

async function gToken(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64u(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(h + '.' + c).sign(sa.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: h + '.' + c + '.' + sig }) });
  const jj = await res.json(); if (!jj.access_token) throw new Error('no token'); return jj.access_token;
}
function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function j(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
