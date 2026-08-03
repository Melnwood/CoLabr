// Co-Labr — shared email sender. Prefers Google Workspace / Gmail (impersonation via a
// domain-wide-delegated service account); falls back to Resend. Returns {ok, via, error}.
const crypto = require('crypto');

async function sendMail({ to, subject, html, replyTo, fromName }) {
  if (!to) return { ok: false, error: 'No recipient.' };
  const saKey = process.env.GWS_SA_KEY || process.env.GCP_SA_KEY; // reuse the storage service account
  const sender = process.env.GMAIL_SENDER;
  if (saKey && sender) {
    try { await gmailSend(JSON.parse(saKey), sender, fromName || 'Co-Labr', { to, subject, html, replyTo }); return { ok: true, via: 'gmail' }; }
    catch (e) { if (!process.env.RESEND_API_KEY) return { ok: false, error: e.message }; }
  }
  if (process.env.RESEND_API_KEY) {
    const from = process.env.NOTIFY_FROM || 'Co-Labr <onboarding@resend.dev>';
    const payload = { from, to: [to], subject, html }; if (replyTo) payload.reply_to = replyTo;
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) { const t = await r.text(); return { ok: false, error: 'resend ' + r.status + ' ' + t.slice(0, 140) }; }
    return { ok: true, via: 'resend' };
  }
  return { ok: false, error: 'Email is not set up yet.' };
}

async function gmailSend(sa, sender, fromName, m) {
  const access = await gToken(sa, 'https://www.googleapis.com/auth/gmail.send', sender);
  const headerLines = [
    `From: ${mimeWord(fromName)} <${sender}>`,
    `To: ${m.to}`,
    m.replyTo ? `Reply-To: ${m.replyTo}` : '',
    `Subject: ${mimeWord(m.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8'
  ].filter(Boolean).join('\r\n');
  const raw = headerLines + '\r\n\r\n' + m.html;
  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: encoded })
  });
  if (!r.ok) { const t = await r.text(); throw new Error('gmail ' + r.status + ' ' + t.slice(0, 160)); }
}

async function gToken(sa, scope, sub) {
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  if (sub) claim.sub = sub;
  const input = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify(claim));
  const sig = crypto.createSign('RSA-SHA256').update(input).sign(sa.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: input + '.' + sig })
  });
  const j = await res.json(); if (!j.access_token) throw new Error('no gmail token: ' + (j.error_description || j.error || '')); return j.access_token;
}
function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function mimeWord(s) { return /[^\x00-\x7F]/.test(s || '') ? '=?UTF-8?B?' + Buffer.from(s).toString('base64') + '?=' : s; }
function esc(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

module.exports = { sendMail, esc };
