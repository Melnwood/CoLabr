// Co-Labr — shared email sender. Prefers Google Workspace / Gmail (impersonation via a
// domain-wide-delegated service account); falls back to Resend. Returns {ok, via, error}.
const crypto = require('crypto');

// ---- SANDBOX FENCE ------------------------------------------------------
// While "Pause all email" is on, mail may ONLY reach people inside the testing
// group: super admins and everyone on the Sandbox Testers roster. Real
// supporters are unreachable no matter which button a tester presses — invites,
// direct messages, replies, previews, notifications, all of it.
// Sign-in codes are the one exception (essential:true) so nobody gets locked out.
let _fenceCache = null, _fenceAt = 0;
async function fence() {
  if (_fenceCache && Date.now() - _fenceAt < 60000) return _fenceCache;
  const token = process.env.AIRTABLE_TOKEN;
  const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
  const out = { paused: false, allow: new Set() };
  (process.env.ADMIN_EMAILS || 'mellenwood@josiahventure.com,nellenwood@josiahventure.com')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean).forEach(e => out.allow.add(e));
  if (token) {
    const auth = { Authorization: 'Bearer ' + token };
    try {
      const pr = await fetch(`https://api.airtable.com/v0/${BASE}/tblnAJuAOg7pmlVFR?maxRecords=1`, { headers: auth });
      if (pr.ok) { const rec = (((await pr.json()).records) || [])[0]; out.paused = !!(rec && rec.fields && rec.fields['Pause all email']); }
    } catch (e) {}
    if (out.paused) {
      try {
        const sr = await fetch(`https://api.airtable.com/v0/${BASE}/tblnKDQEyHU8TIILB?pageSize=100`, { headers: auth });
        if (sr.ok) ((await sr.json()).records || []).forEach(r2 => {
          const f = r2.fields || {};
          ['Email', 'Partner email'].forEach(k => { if (f[k]) out.allow.add(String(f[k]).trim().toLowerCase()); });
        });
      } catch (e) {}
    }
  }
  _fenceCache = out; _fenceAt = Date.now();
  return out;
}

async function sendMail({ to, subject, html, replyTo, fromName, essential }) {
  if (!to) return { ok: false, error: 'No recipient.' };
  if (!essential) {
    try {
      const f = await fence();
      if (f.paused) {
        const rcpts = String(to).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
          .map(s => (s.match(/<([^>]+)>/) || [, s])[1]);
        const outside = rcpts.filter(e => !f.allow.has(e));
        if (outside.length) {
          console.log('MAIL BLOCKED (sandbox fence)', JSON.stringify({ to: rcpts, subject: String(subject || '').slice(0, 80) }));
          return { ok: false, blocked: true, error: 'Test mode: email to people outside the sandbox group is blocked.' };
        }
      }
    } catch (e) { /* never let the fence break a legitimate send path */ }
  }
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
