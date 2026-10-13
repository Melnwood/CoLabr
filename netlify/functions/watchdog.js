// Co·labr — check every morning that the things we believe are true, still are.
//
// The checks in scripts/check.mjs run against the source at deploy time. This runs
// against the LIVE system, which is where the difference between "the code is right"
// and "the system is safe" shows up. A database snapshot sat in a public bucket for
// weeks while the code that wrote it was entirely correct.
//
// Every assertion here is a lesson, not a guess. Findings go to the Events table and
// the morning digest reports them, so a quiet inbox means a healthy system rather than
// an unasked question.
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const EVENTS = 'tbl2Dm5W07cAMrJgs';
const SITE = process.env.SITE_BASE || 'https://co-labr.com';
const PUBLIC_BUCKET = process.env.GCS_BUCKET || 'colabr-photos-jv';
const PRIVATE_BUCKET = process.env.GCS_PRIVATE_BUCKET || process.env.GCS_BACKUP_BUCKET || '';

async function note(msg) {
  try {
    const token = process.env.AIRTABLE_TOKEN; if (!token) return;
    await fetch(`https://api.airtable.com/v0/${BASE}/${EVENTS}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { Kind: 'Watch', 'Update ID': String(msg).slice(0, 240) } })
    });
  } catch (e) {}
}

// Ask the way a stranger would: no credentials, no session, nothing.
async function asAStranger(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); return r.status; }
  catch (e) { return 0; }
}
async function listed(prefix) {
  try {
    const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${PUBLIC_BUCKET}/o?prefix=${encodeURIComponent(prefix)}&maxResults=1&fields=items(name)`,
      { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return 0;
    return (((await r.json()).items) || []).length;
  } catch (e) { return 0; }
}

exports.handler = async function () {
  const found = [];

  // 1. Nothing sensitive readable by anyone. This is the one that bit.
  for (const p of ['backups/', 'translations/', 'feedback/']) {
    if (await listed(p)) found.push(`${p} is readable by anyone in the public bucket`);
  }

  // 2. The private bucket must refuse a stranger. If this ever answers 200, the
  //    bucket has been made public and everything above is moot.
  if (PRIVATE_BUCKET) {
    const st = await asAStranger(`https://storage.googleapis.com/${PRIVATE_BUCKET}/backups/latest.json`);
    if (st === 200) found.push(`the private bucket ${PRIVATE_BUCKET} is answering strangers`);
  }

  // 3. A backup actually happened. The job can be configured, scheduled, and silently
  //    failing, and nothing would say so until the day it was needed.
  if (PRIVATE_BUCKET) {
    try {
      const { gToken } = require('./_gcs');
      const tk = await gToken('https://www.googleapis.com/auth/devstorage.read_only');
      if (tk) {
        const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${PRIVATE_BUCKET}/o/${encodeURIComponent('backups/latest.json')}?fields=updated,size`,
          { headers: { Authorization: 'Bearer ' + tk } });
        if (!r.ok) found.push('no backups/latest.json in the private bucket');
        else {
          const d = await r.json();
          const hours = (Date.now() - Date.parse(d.updated || 0)) / 3600000;
          if (!(hours < 6)) found.push(`newest backup is ${Math.round(hours)} hours old, the job runs every 3`);
          if (Number(d.size || 0) < 100000) found.push(`newest backup is only ${d.size} bytes, suspiciously small`);
        }
      }
    } catch (e) { found.push('could not check the backup: ' + String(e && e.message).slice(0, 80)); }
  }

  // 4. The gates still refuse a stranger. A refactor can quietly open one of these,
  //    and nothing on screen would look any different to us.
  const gates = [
    ['the wall', `${SITE}/.netlify/functions/updates?m=Mel%20%26%20Amy`, [200]],   // locked card, not updates
    ['translations', `${SITE}/.netlify/functions/translation?u=rec3KVmIGdjUJxahl&lang=en`, [404, 401]],
    ['screenshots', `${SITE}/.netlify/functions/shot?f=feedback/none.png`, [404, 401, 400]]
  ];
  for (const [name, url, ok] of gates) {
    const st = await asAStranger(url);
    if (st && !ok.includes(st)) found.push(`${name} gate answered ${st} to a stranger, expected ${ok.join(' or ')}`);
  }

  // 5. The site is up at all.
  const home = await asAStranger(`${SITE}/home`);
  if (home !== 200) found.push(`the home page answered ${home || 'nothing'}`);

  for (const f of found) await note(f);
  return { statusCode: 200, body: JSON.stringify({ ok: found.length === 0, found }) };
};
