// Co·labr — sandbox feedback intake. A signed-in tester spots something wrong,
// types what happened (screenshot optional), and it lands in the Feedback table
// AND in Mel's inbox — one list to work through, nothing lost in chat threads.
const { sessionFromEvent, isAdmin } = require('./_auth');
const { sendMail, esc } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tblsPYpJB2IbdP975';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const sess = sessionFromEvent(event);
  if (!sess) return r(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }

  try {
    // Admin console: list + triage.
    if (b.action === 'list') {
      if (!isAdmin(sess.email)) return r(403, { error: 'Admins only.' });
      let rows = [], url = `https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100&sort%5B0%5D%5Bfield%5D=Status`;
      const fr = await fetch(url, { headers: auth });
      if (fr.ok) {
        rows = (((await fr.json()).records) || []).map(rec => {
          const c = rec.fields || {};
          return { id: rec.id, note: c['Note'] || '', name: c['Name'] || '', email: c['Email'] || '', page: c['Page'] || '', shot: c['Screenshot'] || '', status: c['Status'] || 'New', created: rec.createdTime || '' };
        }).sort((a, z) => (z.created || '').localeCompare(a.created || ''));
      }
      return r(200, { ok: true, rows });
    }
    if (b.action === 'status') {
      if (!isAdmin(sess.email)) return r(403, { error: 'Admins only.' });
      if (!b.id || !b.status) return r(400, { error: 'Missing id/status.' });
      const pr = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'PATCH', headers: auth,
        body: JSON.stringify({ records: [{ id: b.id, fields: { Status: b.status } }], typecast: true }) });
      return pr.ok ? r(200, { ok: true }) : r(502, { error: 'Could not update.' });
    }

    // Help-chat oversight: every question anyone asked the bot, with triage status.
    if (b.action === 'chatList') {
      if (!isAdmin(sess.email)) return r(403, { error: 'Admins only.' });
      const CHAT = 'tbl2fdiuKTDNyjVpR';
      let rows = [];
      const fr = await fetch(`https://api.airtable.com/v0/${BASE}/${CHAT}?pageSize=100`, { headers: auth });
      if (fr.ok) {
        rows = (((await fr.json()).records) || []).map(rec => {
          const c = rec.fields || {};
          const st = c['Status'];
          return { id: rec.id, name: c['Name'] || '', email: c['Email'] || '', message: c['Message'] || '', reply: c['AI Reply'] || '', page: c['Page'] || '', status: (st && st.name) ? st.name : (st || 'New'), created: rec.createdTime || '' };
        }).sort((a, z) => (z.created || '').localeCompare(a.created || ''));
      }
      return r(200, { ok: true, rows });
    }
    if (b.action === 'chatStatus') {
      if (!isAdmin(sess.email)) return r(403, { error: 'Admins only.' });
      if (!b.id || !b.status) return r(400, { error: 'Missing id/status.' });
      const pr = await fetch(`https://api.airtable.com/v0/${BASE}/tbl2fdiuKTDNyjVpR`, { method: 'PATCH', headers: auth,
        body: JSON.stringify({ records: [{ id: b.id, fields: { Status: b.status } }], typecast: true }) });
      return pr.ok ? r(200, { ok: true }) : r(502, { error: 'Could not update.' });
    }

    // Default: a tester filing a report.
    const note = (b.note || '').toString().trim().slice(0, 3000);
    if (!note) return r(400, { error: 'Describe what you saw first.' });
    const page = (b.page || '').toString().slice(0, 400);
    const shot = /^https:\/\/storage\.googleapis\.com\//.test(b.shot || '') ? b.shot : '';
    const fields = { Note: note, Name: sess.name || sess.email || '', Email: sess.email || '', Status: 'New' };
    if (page) fields.Page = page;
    if (shot) fields.Screenshot = shot;
    const cr = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'POST', headers: auth,
      body: JSON.stringify({ fields, typecast: true }) });
    if (!cr.ok) return r(502, { error: 'Could not save your report.' });

    // Straight to Mel's inbox too — best effort, the record is already saved.
    try {
      const admins = (process.env.ADMIN_EMAILS || 'mellenwood@josiahventure.com').split(',').map(s => s.trim()).filter(Boolean);
      await sendMail({
        to: admins[0], subject: `Sandbox: ${note.slice(0, 60)}${note.length > 60 ? '…' : ''}`,
        html: `<div style="font-family:-apple-system,Arial,sans-serif;max-width:560px;color:#241f1b">
          <p style="font-size:14px"><b>${esc(sess.name || sess.email || 'A tester')}</b> found something${page ? ` on <a href="${esc(page)}">${esc(page.replace(/^https?:\/\/[^/]+/, ''))}</a>` : ''}:</p>
          <blockquote style="border-left:3px solid #FF6600;margin:0 0 14px;padding:6px 0 6px 14px;font-size:14.5px;line-height:1.55;white-space:pre-wrap">${esc(note)}</blockquote>
          ${shot ? `<p><a href="${esc(shot)}"><img src="${esc(shot)}" style="max-width:100%;border-radius:10px;border:1px solid #e7e4e0"></a></p>` : ''}
          <p style="font-size:12px;color:#7a756f">The full working list is in Super Admin → Sandbox feedback.</p>
        </div>`,
        replyTo: sess.email || '', fromName: 'Co·labr Sandbox'
      });
    } catch (e) {}
    return r(200, { ok: true });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
