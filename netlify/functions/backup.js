// Co-Labr — automated off-Airtable backup. Every few hours (see netlify.toml schedule) this reads
// every table in the Airtable base and writes one complete, timestamped JSON snapshot into the
// JV Google Cloud bucket (backups/…), independent of Airtable. Keeps a rolling history and a
// backups/latest.json pointer. Restoring is just reading one of those files back.
//
// Runs on: the Netlify scheduler (body carries {next_run}). Can also be triggered manually with a
// POST carrying the shared secret. Public requests without either are denied.
const crypto = require('crypto');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLES = {
  'Missionaries':    'tbli1L8AO0JUDL7Wl',
  'Entity Accounts': 'tblkP1sgm5dx11Uf0',
  'Gifts':           'tblWCp3JAZX7GsJ8m',
  'Updates':         'tbl7aVErl35Qw36QZ',
  'National Orgs':   'tbl152sVfqGyrqpJQ',
  'Responses':       'tblVNMG5VnOnFFeto',
  'Subscribers':     'tbl21LyWOBxln6bOy',
  'Events':          'tbl2Dm5W07cAMrJgs',
  'Feature Shares':  'tblKLXrYICtkiSp40'
};
const KEEP = 240;   // rolling history to retain (240 snapshots ≈ 30 days at every 3h)

exports.handler = async function (event) {
  // Gate: allow the Netlify scheduler (its invocation body has next_run) or a secret-carrying POST.
  let scheduled = false, secretOk = false;
  try { const b = JSON.parse((event && event.body) || '{}'); if (b && b.next_run) scheduled = true; if (b && b.secret && b.secret === process.env.SESSION_SECRET) secretOk = true; } catch {}
  if (!scheduled && !secretOk) return { statusCode: 401, body: 'Not authorized.' };

  const token = process.env.AIRTABLE_TOKEN, bucket = process.env.GCS_BUCKET;
  let sa; try { sa = JSON.parse(process.env.GCP_SA_KEY || ''); } catch { return done(500, 'No GCP key.'); }
  if (!token || !bucket) return done(500, 'Missing config.');
  const auth = { Authorization: 'Bearer ' + token };

  try {
    // 1) Pull every table in full.
    const snapshot = { generatedAt: new Date().toISOString(), base: BASE, tables: {} };
    let totalRecords = 0;
    for (const [name, tid] of Object.entries(TABLES)) {
      const recs = await pullTable(auth, tid);
      snapshot.tables[name] = recs;
      totalRecords += recs.length;
    }

    // 2) Upload the snapshot + update the "latest" pointer.
    const gcs = await gToken(sa, 'https://www.googleapis.com/auth/devstorage.read_write');
    const stamp = snapshot.generatedAt.replace(/[:.]/g, '-');
    const objName = `backups/colabr-${stamp}.json`;
    const okA = await putJson(gcs, bucket, objName, snapshot);
    await putJson(gcs, bucket, 'backups/latest.json', snapshot);

    // 3) Prune old snapshots (keep the most recent KEEP).
    let pruned = 0;
    try { pruned = await prune(gcs, bucket); } catch (e) {}

    await log(auth, JSON.stringify({ ok: okA, tables: Object.keys(TABLES).length, records: totalRecords, file: objName, pruned }));
    return done(200, 'Backup complete: ' + totalRecords + ' records → ' + objName);
  } catch (e) {
    try { await log(auth, 'ERROR ' + String(e && e.message || e)); } catch {}
    return done(200, 'Backup error (logged).');
  }
};

async function pullTable(auth, tableId) {
  const out = [];
  let url = `https://api.airtable.com/v0/${BASE}/${tableId}?pageSize=100&returnFieldsByFieldId=true`;
  while (url) {
    const r = await fetch(url, { headers: auth });
    if (!r.ok) break;
    const d = await r.json();
    (d.records || []).forEach(rec => out.push({ id: rec.id, createdTime: rec.createdTime, fields: rec.fields }));
    url = d.offset ? `https://api.airtable.com/v0/${BASE}/${tableId}?pageSize=100&returnFieldsByFieldId=true&offset=${d.offset}` : '';
  }
  return out;
}

async function prune(token, bucket) {
  const listUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent('backups/colabr-')}&maxResults=1000&fields=items(name)`;
  const r = await fetch(listUrl, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) return 0;
  const items = ((await r.json()).items || []).map(i => i.name).sort();  // names sort chronologically
  const excess = items.length - KEEP;
  if (excess <= 0) return 0;
  const toDelete = items.slice(0, excess);
  let n = 0;
  for (const name of toDelete) {
    const dr = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
    if (dr.ok || dr.status === 404) n++;
  }
  return n;
}

async function putJson(token, bucket, name, obj) {
  const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  return r.ok;
}
async function log(auth, body) {
  await fetch(`https://api.airtable.com/v0/${BASE}/${TABLES['Updates']}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields: { Title: '__BACKUP__', Body: body, Status: 'Draft', Source: 'backup' } }], typecast: true }) }).catch(() => {});
}
async function gToken(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64u(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(h + '.' + c).sign(sa.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: h + '.' + c + '.' + sig }) });
  const jj = await res.json(); if (!jj.access_token) throw new Error('no gcs token'); return jj.access_token;
}
function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function done(statusCode, message) { return { statusCode, headers: { 'Content-Type': 'text/plain' }, body: message }; }
