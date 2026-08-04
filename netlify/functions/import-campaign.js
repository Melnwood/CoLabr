// Co-Labr — parse one Mailchimp campaign's HTML into photo+text blocks and save them onto
// the matching Airtable update. Called by the Make import (or a one-off) with a shared secret.
// Idempotent: it overwrites Blocks for the target record each run, so re-running is safe.
const { htmlToBlocks } = require('./_htmlblocks');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return j(405, { error: 'Method not allowed' });
    const token = process.env.AIRTABLE_TOKEN;
    if (!token) return j(500, { error: 'Missing AIRTABLE_TOKEN' });
    let raw = event.body || '';
    if (event.isBase64Encoded) { try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch {} }
    const ctype = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
    let b = {};
    if (/application\/json/i.test(ctype)) {
      try { b = JSON.parse(raw || '{}'); } catch { return j(400, { error: 'Bad JSON' }); }
    } else {
      // form-urlencoded (Make sends the large HTML this way)
      const p = new URLSearchParams(raw);
      b = { secret: p.get('secret'), recordId: p.get('recordId'), mailchimpId: p.get('mailchimpId'), html: p.get('html') };
    }
    const ok = b.secret && (b.secret === process.env.SESSION_SECRET || b.secret === process.env.IMPORT_SECRET);
    if (!ok) return j(401, { error: 'Unauthorized' });
    if (!b.html) return j(400, { error: 'No html provided' });

    const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;

    // Resolve the target record: by recordId, or by Mailchimp ID.
    let recId = b.recordId || '';
    let existingCover = '';
    if (!recId && b.mailchimpId) {
      const f = encodeURIComponent(`{Mailchimp ID}='${String(b.mailchimpId).replace(/'/g, "")}'`);
      const sr = await fetch(`${api}?maxRecords=1&filterByFormula=${f}`, { headers: auth });
      if (sr.ok) { const sd = await sr.json(); const r0 = (sd.records || [])[0]; if (r0) { recId = r0.id; existingCover = (r0.fields || {})['Cover Image URL'] || ''; } }
    } else if (recId) {
      const gr = await fetch(`${api}/${recId}`, { headers: auth });
      if (gr.ok) { const gd = await gr.json(); existingCover = (gd.fields || {})['Cover Image URL'] || ''; }
    }
    if (!recId) return j(404, { error: 'No matching update found' });

    const { cover, blocks } = htmlToBlocks(b.html, { cover: existingCover });
    const photoCount = blocks.filter(x => x.type === 'photo').length;
    const textCount = blocks.filter(x => x.type === 'text').length;

    const fields = { 'Blocks': JSON.stringify(blocks) };
    if (!existingCover && cover) fields['Cover Image URL'] = cover;

    const pr = await fetch(api, { method: 'PATCH', headers: auth,
      body: JSON.stringify({ records: [{ id: recId, fields }], typecast: true }) });
    if (!pr.ok) { const e = await pr.json().catch(() => ({})); return j(pr.status, { error: (e.error && e.error.message) || 'Airtable write failed' }); }

    return j(200, { ok: true, recordId: recId, photoCount, textCount, blockCount: blocks.length, coverSet: !existingCover && !!cover });
  } catch (e) {
    return j(500, { error: String(e && e.message || e) });
  }
};

function j(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
