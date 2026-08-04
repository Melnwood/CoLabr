// Co-Labr — send the real rendered email of one update to a chosen address (a "see the true
// email" preview). Secret-gated (SESSION_SECRET or IMPORT_SECRET). Reuses the exact email
// renderer the live subscriber-send uses, so what lands is what supporters would get.
const { sendMail, esc } = require('./_mail');
const { wrap, renderBlocks } = require('./_emailrender');
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
    if (/application\/json/i.test(ctype)) { try { b = JSON.parse(raw || '{}'); } catch { return j(400, { error: 'Bad JSON' }); } }
    else { const p = new URLSearchParams(raw); b = { secret: p.get('secret'), recordId: p.get('recordId'), to: p.get('to') }; }

    const ok = b.secret && (b.secret === process.env.SESSION_SECRET || b.secret === process.env.IMPORT_SECRET);
    if (!ok) return j(401, { error: 'Unauthorized' });
    const to = (b.to || process.env.GMAIL_SENDER || '').trim();
    if (!to || !b.recordId) return j(400, { error: 'Need recordId and to' });

    const auth = { Authorization: 'Bearer ' + token };
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}/${b.recordId}`, { headers: auth });
    if (!r.ok) return j(r.status, { error: 'Could not load that update' });
    const c = (await r.json()).fields || {};

    const site = process.env.SITE_BASE || '';
    const title = c['Title'] || 'A new update';
    const cover = (c['Cover Image URL'] || '').replace(/^http:\/\//i, 'https://');
    let blocks = []; try { blocks = JSON.parse(c['Blocks'] || '[]'); } catch {}
    const fullBody = blocks.length
      ? renderBlocks(blocks, site)
      : `<p style="font-size:15px;line-height:1.65;color:#3c3733">${esc(c['Body'] || c['Excerpt'] || '').replace(/\n/g, '<br>')}</p>`;
    const coverHtml = cover ? `<img src="${esc(cover)}" alt="" style="width:100%;max-width:560px;border-radius:12px;margin:0 0 16px">` : '';
    const html = wrap(`${coverHtml}<h1 style="font-size:24px;font-weight:800;color:#241f1b;margin:0 0 14px">${esc(title)}</h1>${fullBody}`, site, site ? `${site}/prefs.html?t=SAMPLE` : '');

    const res = await sendMail({ to, subject: `Preview · ${title}`, html, replyTo: to, fromName: process.env.SITE_MISSIONARY || 'The Ellenwood Family' });
    if (!res.ok) return j(502, { error: 'Send failed: ' + (res.error || 'email not configured') });
    return j(200, { ok: true, to, via: res.via, photoCount: blocks.filter(x => x.type === 'photo').length });
  } catch (e) {
    return j(500, { error: String(e && e.message || e) });
  }
};
function j(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
