// Co-Labr — send the personalized invite letter to supporters. Signed-in staff only.
//
// The flow, end to end:
//   1. Each recipient is added to Subscribers immediately (Active=false, Source=Invited)
//      with a private token — so "your people" exist in the database from the moment
//      you invite them, and you can see who's still deciding.
//   2. The letter's button is their PERSONAL link (prefs.html?t=…&welcome=1): one click,
//      no typing their details again — they choose how to follow, or decline.
//   3. When they choose, Active flips on with their preference; delivery then happens
//      straight from Co-Labr (no Mailchimp, no Google Group — this IS the list).
//
// Sends in small batches (the browser loops) so we never hit the function timeout.
const crypto = require('crypto');
const { sessionFromEvent } = require('./_auth');
const { sendMail, esc } = require('./_mail');
const { missByEmail } = require('./_shares');
const MAX = 25;
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const SUBS = 'tbl21LyWOBxln6bOy';
const SF = {
  name: 'fld95CZHX6o0uNKEb', email: 'fldzhY8nJPjWLKjUK', pref: 'fldI3ED38BzW05kzQ',
  missionary: 'fldz4NfdnkTC9dw3t', active: 'fld5jtmsj3FtyZCJj', source: 'fldm94aUyvI8LHxRf', token: 'fldUS2VRksgaVipcC'
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const session = sessionFromEvent(event);
  if (!session) return r(401, { error: 'Please sign in.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }

  const subject = (b.subject || '').toString().trim().slice(0, 160) || 'Come follow our journey';
  const bodyText = (b.body || '').toString();
  if (!bodyText.trim()) return r(400, { error: 'The letter is empty.' });
  const fromName = (b.fromName || '').toString().trim().slice(0, 80) || 'Co-Labr';
  const recipients = Array.isArray(b.recipients) ? b.recipients.slice(0, MAX) : [];
  const existingSupporters = !!b.existing;   // they already receive updates — start them as Following
  if (!recipients.length) return r(400, { error: 'No recipients in this batch.' });
  const site = process.env.SITE_BASE || '';
  const replyTo = session.email || '';
  const atoken = process.env.AIRTABLE_TOKEN;
  if (!atoken) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + atoken, 'Content-Type': 'application/json' };
  const api = `https://api.airtable.com/v0/${BASE}/${SUBS}`;

  // Whose page is inviting — that's the Missionary these people belong to.
  let missionary = null, missId = null;
  try { const me = await missByEmail(auth, session.email); if (me && me.name) { missionary = me.name; missId = me.id; } } catch (_) {}
  if (!missionary) return r(403, { error: 'Your page isn\'t set up yet — create it first.', join: true });

  // A bulk import of existing supporters must never silently arm the cannon:
  // real audience arriving puts the page (back) into test mode. Going live again
  // is a separate, conscious step on the dashboard.
  if (existingSupporters && missId) {
    try { await fetch(`https://api.airtable.com/v0/${BASE}/tbli1L8AO0JUDL7Wl/${missId}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ fields: { 'Live': false } }) }); } catch (_) {}
  }

  const sent = []; const failed = [];
  for (const rc of recipients) {
    const email = (rc && rc.email || '').toString().trim();
    if (!/.+@.+\..+/.test(email)) { failed.push({ email, error: 'bad email' }); continue; }
    const fullName = ((rc && rc.name) || '').toString().trim().slice(0, 80);
    const first = (fullName.split(/\s+/)[0] || '').trim();

    // 1) Make sure they exist in Subscribers (keep their token and status if they already do).
    let token = crypto.randomBytes(16).toString('hex');
    try {
      const f = encodeURIComponent(`AND(LOWER({Email})='${email.toLowerCase().replace(/'/g, "")}',{Missionary}='${missionary.replace(/'/g, "")}')`);
      const sr = await fetch(`${api}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${f}`, { headers: auth });
      const existing = sr.ok ? (((await sr.json()).records || [])[0] || null) : null;
      if (existing) {
        const ef = existing.fields || {};
        const patch = {};
        if (ef[SF.token]) token = ef[SF.token]; else patch[SF.token] = token;
        if (fullName && !ef[SF.name]) patch[SF.name] = fullName;
        if (Object.keys(patch).length) await fetch(api, { method: 'PATCH', headers: auth, body: JSON.stringify({ records: [{ id: existing.id, fields: patch }] }) });
      } else {
        const fields = existingSupporters
          ? { [SF.name]: fullName || email.split('@')[0], [SF.email]: email, [SF.missionary]: missionary, [SF.active]: true, [SF.pref]: 'Full email', [SF.source]: 'Imported', [SF.token]: token }
          : { [SF.name]: fullName || email.split('@')[0], [SF.email]: email, [SF.missionary]: missionary, [SF.active]: false, [SF.source]: 'Invited', [SF.token]: token };
        const cr = await fetch(api, { method: 'POST', headers: auth, body: JSON.stringify({ fields, typecast: true }) });
        if (!cr.ok) { failed.push({ email, error: 'could not save to your people' }); continue; }
      }
    } catch (e) { failed.push({ email, error: 'could not save to your people' }); continue; }

    // 2) Send the letter with their personal choose-link.
    const chooseUrl = site ? `${site}/prefs.html?t=${token}&welcome=1` : '';
    const bodyHtml = bodyText
      .replace(/\{name\}/gi, first || 'friend')
      .split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#241f1b">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    const cta = chooseUrl
      ? `<p style="margin:6px 0 10px"><a href="${chooseUrl}" style="display:inline-block;background:#FF6600;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:12px 26px;border-radius:10px">Choose how you'd like to follow →</a></p>
         <p style="margin:0 0 18px;font-size:12.5px;color:#7a756f">One click — we already know it's you.${site ? ` Or just <a href="${site}/index.html?m=${encodeURIComponent(missionary)}" style="color:#FF6600">browse the updates</a> first.` : ''}</p>`
      : (site ? `<p style="margin:6px 0 18px"><a href="${site}/index.html?m=${encodeURIComponent(missionary)}" style="display:inline-block;background:#FF6600;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:12px 26px;border-radius:10px">See our updates →</a></p>` : '');
    const html = `<div style="font-family:-apple-system,Arial,sans-serif;max-width:540px">${bodyHtml}${cta}
      <p style="font-size:12px;color:#7a756f;margin-top:18px">You choose how you hear from us — full email, a quick link, a monthly summary, or a text — and can change it or stop anytime.</p></div>`;
    const res = await sendMail({ to: email, subject, html, replyTo, fromName });
    if (res.ok) sent.push(email); else failed.push({ email, error: res.error || 'send failed' });
  }
  return r(200, { ok: true, sent: sent.length, failed });
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
