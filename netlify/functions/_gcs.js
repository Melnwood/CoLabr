// Co·labr — read an object out of a PRIVATE bucket, server side.
//
// Anything that is not a photo destined for an email belongs in a bucket strangers
// cannot reach. That means the browser can no longer fetch it directly, so these
// helpers let a function fetch it instead, after checking who is asking.
//
// The private bucket is GCS_PRIVATE_BUCKET, falling back to GCS_BACKUP_BUCKET so this
// works today without another bucket to create. Split them later if the tidiness is
// worth five minutes.
const crypto = require('crypto');

function privateBucket() {
  return process.env.GCS_PRIVATE_BUCKET || process.env.GCS_BACKUP_BUCKET || '';
}
function publicBucket() {
  return process.env.GCS_BUCKET || '';
}

function b64u(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function gToken(scope) {
  let sa;
  try { sa = JSON.parse(process.env.GCP_SA_KEY || ''); } catch (e) { return ''; }
  if (!sa || !sa.private_key) return '';
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key)
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig })
  });
  const j = await res.json().catch(() => ({}));
  return j.access_token || '';
}

// Read one object. Tries the private bucket first, then the public one, because
// objects written before the move are still sitting in the old place and a reader
// that only knows the new home breaks every wall until migration finishes. Drop the
// fallback once nothing is left in the public bucket.
async function readObject(name) {
  const priv = privateBucket();
  if (priv) {
    const token = await gToken('https://www.googleapis.com/auth/devstorage.read_only');
    if (token) {
      const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${priv}/o/${encodeURIComponent(name)}?alt=media`,
        { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) return { ok: true, body: await r.arrayBuffer(), type: r.headers.get('content-type') || 'application/octet-stream', from: 'private' };
    }
  }
  const pub = publicBucket();
  if (pub) {
    const r = await fetch(`https://storage.googleapis.com/${pub}/${name}`);
    if (r.ok) return { ok: true, body: await r.arrayBuffer(), type: r.headers.get('content-type') || 'application/octet-stream', from: 'public' };
  }
  return { ok: false };
}

module.exports = { privateBucket, publicBucket, gToken, readObject, b64u };
