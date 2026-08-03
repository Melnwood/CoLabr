// Co-Labr — staff admin actions (list / publish-unpublish / delete).
// Passcode-gated with EDIT_KEY. Uses AIRTABLE_TOKEN (read+write scope).

const { sessionFromEvent } = require('./_auth');
const { sendMail } = require('./_mail');
const { fireNotify } = require('./_notify');
const BASE = 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';
const RTABLE = 'tblVNMG5VnOnFFeto'; // Responses
const MIS_TABLE = 'tbli1L8AO0JUDL7Wl';          // Missionaries
const MIS_STYLE = 'fldvLZXckaQVUbD7F';           // Style (single select)
const STYLES = ['Field Notes', 'Cover Grid', 'Timeline', 'Gallery Wall'];
const SITE_MISSIONARY = process.env.SITE_MISSIONARY || 'The Ellenwood Family';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(500, { error: 'Server not configured.' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Bad request.' }); }
  const editKey = process.env.EDIT_KEY;
  const authed = sessionFromEvent(event) || (editKey && b.key === editKey);
  if (!authed) return resp(401, { error: 'Please sign in.' });

  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;

  try {
    if (b.action === 'list') {
      const r = await fetch(`${api}?pageSize=100`, { headers: auth });
      const data = await r.json();
      if (!r.ok) return resp(r.status, { error: 'Airtable read failed.' });
      const rows = (data.records || []).map(rec => {
        const c = rec.fields || {};
        return {
          id: rec.id,
          title: c['Title'] || '(untitled)',
          date: c['Date'] || '',
          type: c['Type'] || '',
          status: c['Status'] || 'Draft',
          opens: c['Opens'] || 0,
          source: c['Source'] || '',
          aud: c['Audiences'] || [],
          hasCover: !!c['Cover Image URL'],
          hasVideo: !!c['Video URL']
        };
      }).sort((a, b2) => (b2.date).localeCompare(a.date));
      return resp(200, { ok: true, rows });
    }

    if (b.action === 'get') {
      if (!b.id) return resp(400, { error: 'Missing id.' });
      const r = await fetch(`${api}/${b.id}`, { headers: auth });
      const rec = await r.json();
      if (!r.ok) return resp(r.status, { error: 'Could not load that update.' });
      const c = rec.fields || {};
      let blocks = []; try { blocks = JSON.parse(c['Blocks'] || '[]'); } catch {}
      return resp(200, { ok: true, record: {
        id: rec.id, title: c['Title'] || '', date: c['Date'] || '',
        type: c['Type'] || 'Newsletter', audiences: c['Audiences'] || [],
        status: c['Status'] || 'Draft', blocks
      }});
    }

    if (b.action === 'setStatus') {
      if (!b.id || !b.status) return resp(400, { error: 'Missing id/status.' });
      const r = await fetch(api, { method: 'PATCH', headers: auth,
        body: JSON.stringify({ records: [{ id: b.id, fields: { Status: b.status } }], typecast: true }) });
      if (!r.ok) return resp(r.status, { error: 'Update failed.' });
      // Publishing from the dashboard? Notify subscribers (best-effort, async, idempotent).
      if (b.status === 'Published') { try { await fireNotify(b.id); } catch (e) {} }
      return resp(200, { ok: true });
    }

    if (b.action === 'delete') {
      if (!b.id) return resp(400, { error: 'Missing id.' });
      const r = await fetch(`${api}/${b.id}`, { method: 'DELETE', headers: auth });
      if (!r.ok) return resp(r.status, { error: 'Delete failed.' });
      return resp(200, { ok: true });
    }

    if (b.action === 'getStyle') {
      const rec = await findMissionary(auth);
      if (!rec) return resp(404, { error: 'Missionary record not found.' });
      const s = rec.fields && rec.fields[MIS_STYLE];
      return resp(200, { ok: true, style: (s && s.name) ? s.name : (s || 'Field Notes'), styles: STYLES });
    }

    if (b.action === 'setStyle') {
      if (!b.style || !STYLES.includes(b.style)) return resp(400, { error: 'Unknown style.' });
      const rec = await findMissionary(auth);
      if (!rec) return resp(404, { error: 'Missionary record not found.' });
      const misApi = `https://api.airtable.com/v0/${BASE}/${MIS_TABLE}`;
      const r = await fetch(misApi, { method: 'PATCH', headers: auth,
        body: JSON.stringify({ records: [{ id: rec.id, fields: { [MIS_STYLE]: b.style } }], typecast: true }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return resp(r.status, { error: (e.error && e.error.message) || 'Could not save style.' }); }
      return resp(200, { ok: true, style: b.style });
    }

    if (b.action === 'metrics') {
      // Give-button clicks + active subscribers, for the dashboard.
      const ev = await fetch(`https://api.airtable.com/v0/${BASE}/tbl2Dm5W07cAMrJgs?pageSize=100&filterByFormula=${encodeURIComponent("{Kind}='Give'")}`, { headers: auth });
      const subs = await fetch(`https://api.airtable.com/v0/${BASE}/tbl21LyWOBxln6bOy?pageSize=100&filterByFormula=${encodeURIComponent('{Active}=1')}`, { headers: auth });
      let giveClicks = 0, subscribers = 0;
      if (ev.ok) { const d = await ev.json(); giveClicks = (d.records || []).length; }
      if (subs.ok) { const d = await subs.json(); subscribers = (d.records || []).length; }
      return resp(200, { ok: true, giveClicks, subscribers });
    }

    if (b.action === 'responses') {
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${RTABLE}?pageSize=100`, { headers: auth });
      const data = await r.json();
      if (!r.ok) return resp(r.status, { error: 'Could not load responses.' });
      const rows = (data.records || []).map(rec => {
        const c = rec.fields || {};
        return {
          id: rec.id,
          name: c['Name'] || 'A supporter',
          type: c['Type'] || 'Note',
          message: c['Message'] || '',
          email: c['Email'] || '',
          isPublic: !!c['Public'],
          read: !!c['Read'],
          replied: !!c['Replied'],
          reply: c['Reply'] || '',
          updateTitle: c['Update Title'] || '',
          updateId: c['Update ID'] || '',
          created: rec.createdTime
        };
      }).sort((a, b2) => (b2.created || '').localeCompare(a.created || ''));
      return resp(200, { ok: true, rows });
    }

    if (b.action === 'markRead') {
      if (!b.id) return resp(400, { error: 'Missing id.' });
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${RTABLE}`, { method: 'PATCH', headers: auth,
        body: JSON.stringify({ records: [{ id: b.id, fields: { Read: b.read !== false } }], typecast: true }) });
      if (!r.ok) return resp(r.status, { error: 'Update failed.' });
      return resp(200, { ok: true });
    }

    if (b.action === 'reply') {
      if (!b.id || !b.message || !b.message.trim()) return resp(400, { error: 'Write a reply first.' });
      // Load the response to get the supporter's email + context.
      const gr = await fetch(`https://api.airtable.com/v0/${BASE}/${RTABLE}/${b.id}`, { headers: auth });
      const rec = await gr.json();
      if (!gr.ok) return resp(gr.status, { error: 'Could not find that message.' });
      const c = rec.fields || {};
      const toEmail = c['Email'];
      if (!toEmail) return resp(400, { error: "This person didn't leave an email, so there's no way to reply to them." });
      const supporter = c['Name'] || 'friend';
      const title = c['Update Title'] || '';
      const missionary = c['Missionary'] || '';
      // Who is replying (their JV inbox becomes Reply-To so the conversation continues in Gmail).
      let replyTo = '';
      const sess = sessionFromEvent(event); if (sess && sess.email) replyTo = sess.email;
      const site = process.env.SITE_BASE || '';
      const html =
        `<div style="font-family:-apple-system,Arial,sans-serif;max-width:520px;color:#241f1b">
          <p style="font-size:15px">Hi ${escH(supporter)},</p>
          <div style="font-size:15px;line-height:1.55;white-space:pre-wrap">${escH(b.message.trim())}</div>
          ${title ? `<p style="font-size:12px;color:#7a756f;margin-top:18px">In reply to your message on “${escH(title)}”.</p>` : ''}
        </div>`;
      const mail = await sendMail({ to: toEmail, subject: (title ? `Re: ${title}` : 'A note back from us'), html, replyTo, fromName: (missionary ? `${missionary} via Co-Labr` : 'Co-Labr') });
      if (!mail.ok) return resp(502, { error: 'Could not send the reply: ' + (mail.error || 'email not set up') });
      // Record the reply and mark handled.
      await fetch(`https://api.airtable.com/v0/${BASE}/${RTABLE}`, { method: 'PATCH', headers: auth,
        body: JSON.stringify({ records: [{ id: b.id, fields: { Reply: b.message.trim(), Replied: true, Read: true } }], typecast: true }) });
      return resp(200, { ok: true, via: mail.via });
    }

    return resp(400, { error: 'Unknown action.' });
  } catch (e) {
    return resp(502, { error: 'Could not reach Airtable.' });
  }

  async function findMissionary(headers) {
    const mf = encodeURIComponent(`{Name}='${SITE_MISSIONARY.replace(/'/g, "\\'")}'`);
    const u = `https://api.airtable.com/v0/${BASE}/${MIS_TABLE}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${mf}`;
    const r = await fetch(u, { headers });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.records || [])[0] || null;
  }
};

function resp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function escH(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
