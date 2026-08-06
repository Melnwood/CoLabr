// Co·labr — Mailchimp image exodus. Downloads every mcusercontent/mailchimp-hosted image
// referenced by a missionary's updates (covers + block content), re-hosts them in our own
// GCS bucket, and rewrites the records. After this runs clean, the Mailchimp account can be
// closed without the wall losing a single photo. Secret-gated background fn; idempotent —
// already-migrated URLs no longer match the pattern, so reruns only pick up leftovers.
// Writes a summary row to Events (Kind='MC migrate') when done.
const crypto = require('crypto');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const EVENTS = 'tbl2Dm5W07cAMrJgs';
const COVER = 'fldsU5p6r9LzdeTF7';
const BLOCKS = 'fldN9B0v6YU0xptFu';
const MISSLINK = 'fldpNShY6OSQBSbx0';
const MC_URL = /https?:\/\/[a-z0-9.-]*(?:mcusercontent\.com|gallery\.mailchimp\.com|cdn-images\.mailchimp\.com)\/[^"'\\\s)]+/gi;

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return j(405);
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return j(400); }
    if (!b.secret || (b.secret !== process.env.SESSION_SECRET && b.secret !== process.env.IMPORT_SECRET)) return j(401);
    const missionary = (b.missionary || 'The Ellenwood Family').toString();
    const token = process.env.AIRTABLE_TOKEN, bucket = process.env.GCS_BUCKET;
    let sa; try { sa = JSON.parse(process.env.GCP_SA_KEY || ''); } catch { return j(500); }
    if (!token || !bucket) return j(500);
    const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const api = `https://api.airtable.com/v0/${BASE}`;
    const gtok = await gToken(sa);

    // All of this missionary's updates.
    let recs = [], offset = '';
    const f = encodeURIComponent(`FIND('${missionary.replace(/'/g, "")}', ARRAYJOIN({Missionary}))>0`);
    do {
      const r = await fetch(`${api}/${UPDATES}?pageSize=100&filterByFormula=${f}${offset ? '&offset=' + offset : ''}`, { headers: auth });
      if (!r.ok) break;
      const d = await r.json(); recs = recs.concat(d.records || []); offset = d.offset || '';
    } while (offset);

    const map = {};   // old URL -> new URL (deduped across the whole run)
    let migrated = 0, failed = 0, patched = 0;

    async function rehost(url) {
      if (map[url]) return map[url];
      const fetchUrl = url.replace('gallery.mailchimp.com', 'mcusercontent.com').replace(/^http:\/\//i, 'https://');
      try {
        const r = await fetch(fetchUrl, { headers: { 'User-Agent': 'Mozilla/5.0 CoLabr-migrate' } });
        if (!r.ok) { failed++; return null; }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 200 || buf.length > 15 * 1024 * 1024) { failed++; return null; }
        const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
        const ext = ct.includes('png') ? 'png' : ct.includes('gif') ? 'gif' : ct.includes('webp') ? 'webp' : 'jpg';
        const name = `mcmigrate/${crypto.createHash('sha1').update(url).digest('hex')}.${ext}`;
        const up = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`,
          { method: 'POST', headers: { Authorization: 'Bearer ' + gtok, 'Content-Type': ct }, body: buf });
        if (!up.ok) { failed++; return null; }
        migrated++;
        map[url] = `https://storage.googleapis.com/${bucket}/${name}`;
        return map[url];
      } catch (e) { failed++; return null; }
    }

    // Scrub mode: {killUrl} removes photo blocks referencing an image that is dead
    // everywhere (e.g. retired Mailchimp graphics that 403 even on the new CDN).
    const killUrl = (b.killUrl || '').toString();

    for (const rec of recs) {
      const flds = rec.fields || {};
      const cover = flds['Cover Image URL'] || '';
      const blocks = flds['Blocks'] || '';
      if (killUrl && String(blocks).includes(killUrl)) {
        try {
          const arr = JSON.parse(blocks);
          const kept = arr.filter(bk => !(bk && typeof bk.url === 'string' && bk.url.includes(killUrl)));
          const patch = { [BLOCKS]: JSON.stringify(kept) };
          if (cover.includes(killUrl)) patch[COVER] = '';
          const pr = await fetch(`${api}/${UPDATES}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ records: [{ id: rec.id, fields: patch }] }) });
          if (pr.ok) patched++;
        } catch (e) {}
        continue;
      }
      const urls = new Set();
      (cover.match(MC_URL) || []).forEach(u => urls.add(u));
      (String(blocks).match(MC_URL) || []).forEach(u => urls.add(u));
      if (!urls.size) continue;
      // Re-host every image this update references (small parallel batches).
      const list = [...urls];
      for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(rehost));
      let newCover = cover, newBlocks = String(blocks);
      for (const u of list) { if (map[u]) { newCover = newCover.split(u).join(map[u]); newBlocks = newBlocks.split(u).join(map[u]); } }
      const patch = {};
      if (newCover !== cover) patch[COVER] = newCover;
      if (newBlocks !== String(blocks)) patch[BLOCKS] = newBlocks;
      if (Object.keys(patch).length) {
        const pr = await fetch(`${api}/${UPDATES}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ records: [{ id: rec.id, fields: patch }] }) });
        if (pr.ok) patched++;
      }
    }

    const summary = `updates:${recs.length} patched:${patched} images:${migrated} failed:${failed}`;
    console.log('mc-rehost', summary);
    try { await fetch(`${api}/${EVENTS}`, { method: 'POST', headers: auth, body: JSON.stringify({ fields: { 'Kind': 'MC migrate', 'Update ID': missionary, 'Update Title': summary } }) }); } catch (e) {}
    return j(200);
  } catch (e) { console.log('mc-rehost EXCEPTION', String(e && e.message || e)); return j(200); }
};

async function gToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64u = s => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/devstorage.read_write', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(h + '.' + c).sign(sa.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: h + '.' + c + '.' + sig }) });
  const jj = await res.json(); if (!jj.access_token) throw new Error('no gcs token'); return jj.access_token;
}
function j(s) { return { statusCode: s, body: '{}' }; }
