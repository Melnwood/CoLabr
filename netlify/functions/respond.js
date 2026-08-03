// CoLabr — supporter response intake (public, no login).
// A supporter prays, sends a private note, or leaves public encouragement on an update.
// Writes to the Responses table. Uses AIRTABLE_TOKEN (needs write scope).
// Notifies the missionary by email — via Google Workspace/Gmail (preferred) or Resend (fallback).
const crypto = require('crypto');
const BASE = 'appsSmwptTnmK4luA';
const TABLE = 'tblVNMG5VnOnFFeto';
const F = {
  name: 'fld0i05my8OeyflZH', type: 'fldigSBFHPa27Hh3s', message: 'fld5GlgEzO1WbORGu',
  email: 'fld0q8b1lxqx3gKqA', public: 'fld6Aax3AjDcDDJLx', read: 'fldns2iYDQ2tPOrGd',
  update: 'fldTML1g8IhU6gH70', updateTitle: 'fld1g3obOcBG6vFxb', missionary: 'fldGrurNkcRsUDnDk',
  updateId: 'fldkg6say56a4pYQD'
};
const TYPES = ['Prayer', 'Note', 'Encouragement'];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const type = TYPES.includes(b.type) ? b.type : null;
  if (!type) return r(400, { error: 'Unknown response type.' });

  const name = (b.name || '').toString().trim().slice(0, 80) || (type === 'Prayer' ? 'A supporter' : '');
  if (!name) return r(400, { error: 'Please add your name.' });
  const message = (b.message || '').toString().trim().slice(0, 2000);
  if ((type === 'Note' || type === 'Encouragement') && !message) return r(400, { error: 'Please write a message.' });

  // Only encouragement can ever be public; notes & prayers are private to the missionary.
  const isPublic = type === 'Encouragement' && b.public !== false;

  const fields = {
    [F.name]: name,
    [F.type]: type,
    [F.public]: isPublic,
    [F.read]: false
  };
  if (message) fields[F.message] = message;
  if (b.email) fields[F.email] = (b.email || '').toString().trim().slice(0, 120);
  if (b.updateId) { fields[F.update] = [b.updateId]; fields[F.updateId] = b.updateId; }
  if (b.updateTitle) fields[F.updateTitle] = (b.updateTitle || '').toString().slice(0, 200);
  if (b.missionary) fields[F.missionary] = (b.missionary || '').toString().slice(0, 120);

  try {
    const resp = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: true })
    });
    const data = await resp.json();
    if (!resp.ok) return r(resp.status, { error: (data.error && data.error.message) || 'Could not send.' });
    // Best-effort: notify the missionary by email so they can reply quickly. Never blocks the response.
    try { await notify(token, { type, name, message, email: b.email, missionary: b.missionary, updateTitle: b.updateTitle }); } catch (e) {}
    return r(200, { ok: true, id: data.id, public: isPublic });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};

// Look up the missionary's inbox and notify them. Prefers Google Workspace / Gmail; falls back to Resend.
async function notify(token, x) {
  const saKey = process.env.GWS_SA_KEY || process.env.GCP_SA_KEY; // reuse the storage service account
  const hasGmail = !!(saKey && process.env.GMAIL_SENDER);
  const hasResend = !!process.env.RESEND_API_KEY;
  if (!hasGmail && !hasResend) return; // email not set up yet — response still saved to the dashboard inbox

  const MIS_TABLE = 'tbli1L8AO0JUDL7Wl', MIS_EMAIL = 'fld65nJ51ewtIWTxj';
  let to = process.env.NOTIFY_EMAIL || '';
  if (x.missionary) {
    const f = encodeURIComponent(`{Name}='${String(x.missionary).replace(/'/g, "")}'`);
    const mr = await fetch(`https://api.airtable.com/v0/appsSmwptTnmK4luA/${MIS_TABLE}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${f}`, { headers: { Authorization: 'Bearer ' + token } });
    if (mr.ok) { const md = await mr.json(); const rec = (md.records || [])[0]; const em = rec && rec.fields && rec.fields[MIS_EMAIL]; if (em) to = em; }
  }
  if (!to) return;

  const label = x.type === 'Prayer' ? 'is praying for you' : (x.type === 'Note' ? 'sent you a private note' : 'left you encouragement');
  const subject = `${x.name} ${label}` + (x.updateTitle ? ` · ${x.updateTitle}` : '');
  const site = process.env.SITE_BASE || '';
  const html =
    `<div style="font-family:-apple-system,Arial,sans-serif;max-width:520px">
      <p style="font-size:15px;color:#241f1b"><b>${esc(x.name)}</b> ${label}${x.updateTitle ? ` on <b>${esc(x.updateTitle)}</b>` : ''}.</p>
      ${x.message ? `<blockquote style="border-left:3px solid #FF6600;margin:0 0 14px;padding:6px 0 6px 14px;color:#3c3733;font-size:15px;line-height:1.5">${esc(x.message)}</blockquote>` : ''}
      ${x.email ? `<p style="font-size:13px;color:#7a756f">Reply to this email to write ${esc(x.name)} back directly.</p>` : ''}
      ${site ? `<p><a href="${site}/manage.html" style="color:#FF6600;font-weight:700">Open your CoLabr inbox →</a></p>` : ''}
    </div>`;

  // Preferred: send through Google Workspace (Gmail API) as the JV domain.
  if (hasGmail) {
    try {
      const sa = JSON.parse(saKey);
      const sender = process.env.GMAIL_SENDER; // a real Workspace user/shared mailbox to send as
      const fromName = x.missionary ? `${x.missionary} via CoLabr` : 'CoLabr';
      await sendViaGmail(sa, sender, fromName, { to, subject, html, replyTo: x.email });
      return;
    } catch (e) { if (!hasResend) return; /* else fall through to Resend */ }
  }

  // Fallback: Resend.
  const from = process.env.NOTIFY_FROM || 'CoLabr <onboarding@resend.dev>';
  const payload = { from, to: [to], subject, html };
  if (x.email) payload.reply_to = x.email;
  await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
}

// Send an email through Gmail, impersonating a Workspace user via a domain-wide-delegated service account.
async function sendViaGmail(sa, sender, fromName, m) {
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
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: encoded })
  });
  if (!r.ok) { const t = await r.text(); throw new Error('gmail ' + r.status + ' ' + t.slice(0, 160)); }
}

async function gToken(sa, scope, sub) {
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  if (sub) claim.sub = sub; // impersonate this Workspace user (domain-wide delegation)
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
function r(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
