// Co-Labr — one-time: allow the browser to upload directly to the GCS bucket (CORS).
// Secret-gated; run once. Needs the SA to have storage.buckets.update on the bucket.
const crypto = require('crypto');

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return j(405, {});
    let raw = event.body || ''; if (event.isBase64Encoded) { try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch {} }
    const ct = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
    let b = {}; if (/application\/json/i.test(ct)) { try { b = JSON.parse(raw || '{}'); } catch {} } else { const p = new URLSearchParams(raw); b = { secret: p.get('secret') }; }
    if (!b.secret || (b.secret !== process.env.SESSION_SECRET && b.secret !== process.env.IMPORT_SECRET)) return j(401, {});

    const bucket = process.env.GCS_BUCKET;
    let sa; try { sa = JSON.parse(process.env.GCP_SA_KEY || ''); } catch { return j(500, { error: 'bad SA' }); }
    const token = await gToken(sa, 'https://www.googleapis.com/auth/devstorage.full_control');
    const cors = [{ origin: ['https://colabr.netlify.app', 'https://main--colabr.netlify.app', 'http://localhost:8888'], method: ['GET', 'HEAD', 'PUT', 'POST', 'OPTIONS'], responseHeader: ['*'], maxAgeSeconds: 3600 }];
    const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}?fields=cors`, {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ cors })
    });
    const jr = await r.json();
    return j(r.ok ? 200 : r.status, r.ok ? { ok: true, cors: jr.cors } : { error: (jr.error && jr.error.message) || 'failed' });
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
function j(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }; }
