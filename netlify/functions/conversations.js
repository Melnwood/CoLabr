// Co·labr — conversations, grouped by PERSON. The missionary's messages view:
// every prayer, note, encouragement and reply from one supporter lives in one
// stream, alongside which update sparked it. GET returns the raw material
// (responses + subscribers + update art); the page groups it per person.
// POST starts/continues a direct message to a supporter (Type: Message).
const crypto = require('crypto');
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const { sendMail, esc } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const RTABLE = 'tblVNMG5VnOnFFeto';   // Responses
const STABLE = 'tbl21LyWOBxln6bOy';   // Subscribers
const UTABLE = 'tbl7aVErl35Qw36QZ';   // Updates

exports.handler = async function (event) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const sess = sessionFromEvent(event);
  if (!sess) return r(401, { error: 'Please sign in.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  let me = null;
  try { me = await missByEmail({ Authorization: 'Bearer ' + token }, sess.email); } catch (e) {}
  if (!me || !me.name) return r(403, { error: 'Your page isn\'t set up yet.' });
  const myName = me.name;
  const nameEsc = String(myName).replace(/'/g, "\\'");

  try {
    if (event.httpMethod === 'GET') {
      // Every response ever written to this missionary.
      const rows = [];
      let url = `https://api.airtable.com/v0/${BASE}/${RTABLE}?pageSize=100&filterByFormula=${encodeURIComponent(`{Missionary}='${nameEsc}'`)}`;
      while (url) {
        const rr = await fetch(url, { headers: auth }); if (!rr.ok) break;
        const d = await rr.json();
        (d.records || []).forEach(rec => {
          const c = rec.fields || {};
          let thread = []; try { thread = JSON.parse(c['Thread'] || '[]'); } catch (e) {}
          if (!Array.isArray(thread)) thread = [];
          if (!thread.length && c['Reply']) thread = [{ f: 'm', t: c['Reply'], at: '' }];
          rows.push({
            id: rec.id, name: c['Name'] || 'A supporter', type: c['Type'] || 'Note',
            message: c['Message'] || '', email: (c['Email'] || '').toLowerCase(),
            isPublic: !!c['Public'], read: !!c['Read'], thread,
            updateId: c['Update ID'] || '', updateTitle: c['Update Title'] || '',
            created: rec.createdTime || ''
          });
        });
        url = d.offset ? `https://api.airtable.com/v0/${BASE}/${RTABLE}?pageSize=100&filterByFormula=${encodeURIComponent(`{Missionary}='${nameEsc}'`)}&offset=${d.offset}` : '';
      }

      // The supporter team — EVERYONE, following Airtable's 100-row pages to the end,
      // so an imported list of hundreds all show up.
      const subs = [];
      const subsBase = `https://api.airtable.com/v0/${BASE}/${STABLE}?pageSize=100&filterByFormula=${encodeURIComponent(`AND({Missionary}='${nameEsc}',{Active}=1)`)}`;
      let surl = subsBase;
      while (surl) {
        const sr = await fetch(surl, { headers: auth }); if (!sr.ok) break;
        const sd = await sr.json();
        (sd.records || []).forEach(rec => {
          const c = rec.fields || {};
          subs.push({ name: c['Name'] || '', email: (c['Email'] || '').toLowerCase(), since: rec.createdTime || '', lastVisit: c['Last visit'] || '' });
        });
        surl = sd.offset ? subsBase + '&offset=' + sd.offset : '';
      }

      // Cover art for every update that shows up in a conversation.
      const ids = [...new Set(rows.map(x => x.updateId).filter(Boolean))];
      const updates = {};
      for (let i = 0; i < ids.length; i += 20) {
        const or = 'OR(' + ids.slice(i, i + 20).map(id => `RECORD_ID()='${id}'`).join(',') + ')';
        const ur = await fetch(`https://api.airtable.com/v0/${BASE}/${UTABLE}?pageSize=20&filterByFormula=${encodeURIComponent(or)}&fields%5B%5D=Title&fields%5B%5D=Cover%20Image%20URL&fields%5B%5D=Cover%20Focus`, { headers: auth });
        if (!ur.ok) continue;
        ((await ur.json()).records || []).forEach(rec => {
          const c = rec.fields || {};
          updates[rec.id] = { title: c['Title'] || '', cover: c['Cover Image URL'] || '', focus: c['Cover Focus'] || '50% 35%' };
        });
      }

      // Give-button clicks that we could attribute to a person (newer clicks carry
      // the supporter's wall key) — shown as engagement in their conversation.
      const gives = [];
      let gurl = `https://api.airtable.com/v0/${BASE}/tbl2Dm5W07cAMrJgs?pageSize=100&filterByFormula=${encodeURIComponent(`AND({Kind}='Give',{Missionary}='${nameEsc}',LEN({Supporter})>0)`)}`;
      while (gurl) {
        const gr = await fetch(gurl, { headers: auth }); if (!gr.ok) break;
        const gd = await gr.json();
        (gd.records || []).forEach(rec => {
          const c = rec.fields || {};
          const m = String(c['Supporter'] || '').match(/^(.*?)\s*<([^>]*)>$/);
          gives.push({ name: (m ? m[1] : String(c['Supporter'] || '')).trim(), email: (m ? m[2] : '').toLowerCase(), at: rec.createdTime || '', updateTitle: c['Update Title'] || '' });
        });
        gurl = gd.offset ? gurl.split('&offset=')[0] + '&offset=' + gd.offset : '';
      }

      return r(200, { ok: true, me: myName, rows, subs, updates, gives });
    }

    if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
    // Start (or continue) a direct message with a supporter — the missionary reaches out first.
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
    const toEmail = (b.email || '').toString().trim().toLowerCase().slice(0, 120);
    const toName = (b.name || '').toString().trim().slice(0, 80) || 'friend';
    const msg = (b.message || '').toString().trim().slice(0, 2000);
    if (!toEmail) return r(400, { error: 'This person didn\'t leave an email, so there\'s no way to message them.' });
    if (!msg) return r(400, { error: 'Write something first.' });

    const tkey = crypto.randomBytes(16).toString('hex');
    const thread = [{ f: 'm', t: msg, at: new Date().toISOString() }];
    const cr = await fetch(`https://api.airtable.com/v0/${BASE}/${RTABLE}`, { method: 'POST', headers: auth,
      body: JSON.stringify({ fields: {
        'Name': toName, 'Type': 'Message', 'Email': toEmail, 'Missionary': myName,
        'Read': true, 'Replied': true, 'Thread': JSON.stringify(thread), 'Thread Key': tkey
      }, typecast: true }) });
    const cd = await cr.json();
    if (!cr.ok) return r(502, { error: (cd.error && cd.error.message) || 'Could not save the message.' });

    const site = process.env.SITE_BASE || '';
    const mail = await sendMail({
      to: toEmail, subject: `A message from ${myName}`,
      html: `<div style="font-family:-apple-system,Arial,sans-serif;max-width:520px;color:#241f1b">
        <p style="font-size:15px">Hi ${esc(toName)},</p>
        <div style="font-size:15px;line-height:1.55;white-space:pre-wrap">${esc(msg)}</div>
        ${site ? `<p style="margin:20px 0"><a href="${site}/my.html?c=${cd.id}&k=${tkey}" style="background:#FF6600;color:#fff;font-weight:700;text-decoration:none;border-radius:10px;padding:11px 20px;display:inline-block">Reply →</a></p>
        <p style="font-size:12px;color:#7a756f">That link opens your own Co·labr page — this conversation, every missionary you follow, all in one place.</p>` : ''}
      </div>`,
      replyTo: sess.email || '', fromName: `${myName} via Co-Labr`
    });
    if (!mail.ok) return r(502, { error: 'Saved, but the email could not be sent: ' + (mail.error || 'email not set up') });
    return r(200, { ok: true, id: cd.id, thread });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
