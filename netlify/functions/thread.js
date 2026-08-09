// Co·labr — one conversation, kept forever. A supporter's note and every reply
// (both directions) live on the Response record. Supporters reach it through the
// secret link in their email (?r=<recId>&k=<thread key>) — no account needed.
// The missionary reads and replies from their dashboard; this endpoint also lets
// them post from thread.html when signed in.
const crypto = require('crypto');
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const { sendMail, esc } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const RTABLE = 'tblVNMG5VnOnFFeto';
const MIS_TABLE = 'tbli1L8AO0JUDL7Wl', MIS_EMAIL = 'fld65nJ51ewtIWTxj';

exports.handler = async function (event) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const q = event.queryStringParameters || {};
  let body = {};
  if (event.httpMethod === 'POST') { try { body = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); } }
  const id = (q.r || body.r || '').trim();
  const key = (q.k || body.k || '').trim();
  if (!/^rec[a-zA-Z0-9]{14}$/.test(id)) return r(400, { error: 'Bad link.' });

  try {
    const gr = await fetch(`https://api.airtable.com/v0/${BASE}/${RTABLE}/${id}`, { headers: auth });
    if (!gr.ok) return r(404, { error: 'This conversation could not be found.' });
    const rec = await gr.json();
    const c = rec.fields || {};

    // Who is asking? The signed-in missionary who OWNS this conversation always wins —
    // even when they arrived through a link carrying the supporter's key. Otherwise,
    // the supporter with the right key.
    let isOwner = false;
    const sess = sessionFromEvent(event);
    if (sess && sess.email) {
      try { const me = await missByEmail({ Authorization: 'Bearer ' + token }, sess.email); isOwner = !!(me && me.name && me.name === (c['Missionary'] || '')); } catch (e) {}
    }
    const keyOk = !isOwner && !!(key && c['Thread Key'] && key === c['Thread Key']);
    if (!keyOk && !isOwner) return r(403, { error: 'This link is not valid.', signin: !key });

    let thread = []; try { thread = JSON.parse(c['Thread'] || '[]'); } catch (e) {}
    if (!Array.isArray(thread)) thread = [];
    if (!thread.length && c['Reply']) thread = [{ f: 'm', t: c['Reply'], at: '' }];

    if (event.httpMethod === 'GET') {
      return r(200, {
        ok: true, you: isOwner ? 'm' : 's',
        name: c['Name'] || 'A supporter', missionary: c['Missionary'] || '',
        updateTitle: c['Update Title'] || '', message: c['Message'] || '',
        created: rec.createdTime || '', thread
      });
    }

    if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
    const msg = (body.message || '').toString().trim().slice(0, 2000);
    if (!msg) return r(400, { error: 'Write something first.' });

    const from = isOwner ? 'm' : 's';
    thread.push({ f: from, t: msg, at: new Date().toISOString() });
    const fields = { Thread: JSON.stringify(thread) };
    // Older records may predate threading — mint the supporter's reply key on first use.
    let tkeySave = c['Thread Key'] || '';
    if (!tkeySave && from === 'm') { tkeySave = crypto.randomBytes(16).toString('hex'); fields['Thread Key'] = tkeySave; }
    // A supporter reply re-opens the item on the missionary's dashboard.
    if (from === 's') fields.Read = false;
    else { fields.Read = true; fields.Replied = true; }
    const pr = await fetch(`https://api.airtable.com/v0/${BASE}/${RTABLE}`, { method: 'PATCH', headers: auth,
      body: JSON.stringify({ records: [{ id, fields }], typecast: true }) });
    if (!pr.ok) return r(502, { error: 'Could not save your reply.' });

    // Tell the other side — best-effort, the reply itself is already saved.
    try {
      const site = process.env.SITE_BASE || '';
      if (from === 's') {
        // Supporter replied → the missionary's inbox, steering them to the dashboard.
        let to = process.env.NOTIFY_EMAIL || '';
        const mf = encodeURIComponent(`{Name}='${String(c['Missionary'] || '').replace(/'/g, "")}'`);
        const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MIS_TABLE}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${mf}`, { headers: { Authorization: 'Bearer ' + token } });
        if (mr.ok) { const rec = (((await mr.json()).records) || [])[0]; const em = rec && rec.fields && rec.fields[MIS_EMAIL]; if (em) to = em; }
        if (to) await sendMail({
          to, subject: `${c['Name'] || 'A supporter'} replied` + (c['Update Title'] ? ` · ${c['Update Title']}` : ''),
          html: `<div style="font-family:-apple-system,Arial,sans-serif;max-width:520px;color:#241f1b">
            <p style="font-size:15px"><b>${esc(c['Name'] || 'A supporter')}</b> wrote back:</p>
            <blockquote style="border-left:3px solid #FF6600;margin:0 0 14px;padding:6px 0 6px 14px;font-size:15px;line-height:1.5;white-space:pre-wrap">${esc(msg)}</blockquote>
            ${site ? `<p><a href="${site}/messages.html?c=${id}" style="background:#FF6600;color:#fff;font-weight:700;text-decoration:none;border-radius:10px;padding:11px 20px;display:inline-block">Reply in Co·labr →</a><br><span style="font-size:12px;color:#7a756f">Opens your conversation table — they'll be right at the top, and the whole history stays in one place.</span></p>` : ''}
          </div>`,
          replyTo: c['Email'] || '', fromName: 'Co-Labr'
        });
      } else if (c['Email']) {
        // Missionary replied from thread.html → the supporter's inbox with the thread link.
        const tkey = tkeySave || key;
        await sendMail({
          to: c['Email'], subject: (c['Update Title'] ? `Re: ${c['Update Title']}` : 'A note back from us'),
          html: `<div style="font-family:-apple-system,Arial,sans-serif;max-width:520px;color:#241f1b">
            <p style="font-size:15px">Hi ${esc(c['Name'] || 'friend')},</p>
            <div style="font-size:15px;line-height:1.55;white-space:pre-wrap">${esc(msg)}</div>
            ${(site && tkey) ? `<p style="margin:20px 0"><a href="${site}/my.html?c=${id}&k=${tkey}" style="background:#FF6600;color:#fff;font-weight:700;text-decoration:none;border-radius:10px;padding:11px 20px;display:inline-block">Reply →</a></p>` : ''}
          </div>`,
          replyTo: (sess && sess.email) || '', fromName: (c['Missionary'] ? `${c['Missionary']} via Co-Labr` : 'Co-Labr')
        });
      }
    } catch (e) {}

    return r(200, { ok: true, thread });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
