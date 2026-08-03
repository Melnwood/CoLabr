// Co-Labr — send the personalized invite letter to supporters. Signed-in staff only.
// Sends in small batches (the browser loops) so we never hit the function timeout.
// Uses the shared mailer (Gmail preferred). Reply-To = the sender's JV inbox.
const { sessionFromEvent } = require('./_auth');
const { sendMail, esc } = require('./_mail');
const MAX = 25;

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
  if (!recipients.length) return r(400, { error: 'No recipients in this batch.' });
  const site = process.env.SITE_BASE || '';
  const replyTo = session.email || '';

  const sent = []; const failed = [];
  for (const rc of recipients) {
    const email = (rc && rc.email || '').toString().trim();
    if (!/.+@.+\..+/.test(email)) { failed.push({ email, error: 'bad email' }); continue; }
    const first = (((rc.name || '').toString().trim().split(/\s+/)[0]) || '').trim();
    const bodyHtml = bodyText
      .replace(/\{name\}/gi, first || 'friend')
      .split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#241f1b">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    const cta = site ? `<p style="margin:6px 0 18px"><a href="${site}" style="display:inline-block;background:#FF6600;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:12px 26px;border-radius:10px">See our updates &amp; choose how you follow →</a></p>` : '';
    const html = `<div style="font-family:-apple-system,Arial,sans-serif;max-width:540px">${first ? '' : ''}${bodyHtml}${cta}
      <p style="font-size:12px;color:#7a756f;margin-top:18px">You choose how you hear from us — full email, a quick link, a monthly summary, or a text — and can change it anytime.</p></div>`;
    const res = await sendMail({ to: email, subject, html, replyTo, fromName });
    if (res.ok) sent.push(email); else failed.push({ email, error: res.error || 'send failed' });
  }
  return r(200, { ok: true, sent: sent.length, failed });
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
