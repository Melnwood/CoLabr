// Co·labr — move a prefix out of the public photo bucket into the private one.
//
// translations/ and feedback/ hold supporter content and were readable by anyone. The
// code now serves them through a gate, but the objects themselves are still sitting in
// the public bucket, so the exposure is not closed until they physically move.
//
// A background function because there are thousands of objects and a normal one gets
// ten seconds. Progress is written to the Events table so it can be watched without
// keeping a browser tab open, and so a run that dies halfway leaves a record of where
// it got to.
//
// Copy, verify, then delete. Never the other way round: a half-finished migration that
// has already deleted is how you lose somebody's translations.
const { sessionFromEvent, isAdmin } = require('./_auth');
const { gToken } = require('./_gcs');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const EVENTS = 'tbl2Dm5W07cAMrJgs';
const ALLOWED = ['translations/', 'feedback/'];

async function say(msg) {
  try {
    const token = process.env.AIRTABLE_TOKEN;
    if (!token) return;
    await fetch(`https://api.airtable.com/v0/${BASE}/${EVENTS}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { 'Kind': 'Migrate', 'Update ID': String(msg).slice(0, 240) } })
    });
  } catch (e) {}
}

exports.handler = async function (event) {
  const sess = sessionFromEvent(event);
  if (!sess || !isAdmin(sess.email)) return { statusCode: 404, body: 'Not found.' };

  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (e) {}
  const prefix = String(b.prefix || '');
  if (!ALLOWED.includes(prefix)) return { statusCode: 400, body: 'Prefix not allowed.' };

  const src = process.env.GCS_BUCKET;
  const dst = process.env.GCS_PRIVATE_BUCKET || process.env.GCS_BACKUP_BUCKET;
  if (!src || !dst) return { statusCode: 500, body: 'Buckets not configured.' };

  const token = await gToken('https://www.googleapis.com/auth/devstorage.read_write');
  if (!token) return { statusCode: 500, body: 'No storage token.' };
  const H = { Authorization: 'Bearer ' + token };

  let moved = 0, failed = 0, pageToken = '', pages = 0;
  const started = Date.now();
  await say(`${prefix} migration started`);

  try {
    do {
      const listUrl = `https://storage.googleapis.com/storage/v1/b/${src}/o`
        + `?prefix=${encodeURIComponent(prefix)}&maxResults=200&fields=items(name),nextPageToken`
        + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const lr = await fetch(listUrl, { headers: H });
      if (!lr.ok) { await say(`${prefix} list failed ${lr.status}`); break; }
      const ld = await lr.json();
      pageToken = ld.nextPageToken || '';
      pages++;

      for (const it of (ld.items || [])) {
        const name = it.name;
        // Leave nearly two minutes of headroom. Whatever is not moved this run is
        // simply moved by the next one, because the list only ever shows what is left.
        if (Date.now() - started > 13 * 60 * 1000) { pageToken = ''; break; }

        const copyUrl = `https://storage.googleapis.com/storage/v1/b/${src}/o/${encodeURIComponent(name)}`
          + `/copyTo/b/${dst}/o/${encodeURIComponent(name)}`;
        const cr = await fetch(copyUrl, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' });
        if (!cr.ok) { failed++; continue; }

        // Prove it is really there before removing the only other copy.
        const vr = await fetch(`https://storage.googleapis.com/storage/v1/b/${dst}/o/${encodeURIComponent(name)}?fields=size`, { headers: H });
        if (!vr.ok) { failed++; continue; }

        const dr = await fetch(`https://storage.googleapis.com/storage/v1/b/${src}/o/${encodeURIComponent(name)}`, { method: 'DELETE', headers: H });
        if (dr.ok || dr.status === 404) moved++; else failed++;
      }
    } while (pageToken);

    await say(`${prefix} run finished: ${moved} moved, ${failed} failed, ${pages} pages`);
  } catch (e) {
    await say(`${prefix} run threw: ${String(e && e.message).slice(0, 120)}`);
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, prefix, moved, failed }) };
};
