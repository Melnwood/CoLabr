// Co·labr — email sign-in, step 1: send a magic link + 6-digit code.
// Works for ANY email address (Google not required). Stateless: the link and the
// code-check token are HMAC-signed with SESSION_SECRET, valid 15 minutes, multi-use
// within that window (corporate link-scanners can't burn them). Light rate limit via
// the Events table: max 3 sends per address per 15 minutes.
const crypto = require('crypto');
const { sign, siteBase } = require('./_auth');
const { sendMail, esc } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const EVENTS = 'tbl2Dm5W07cAMrJgs';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const secret = process.env.SESSION_SECRET;
  if (!secret) return r(500, { error: 'Server not configured.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const email = (b.email || '').toString().trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return r(400, { error: 'That doesn’t look like an email address.' });

  // Rate limit: 3 links per address per 15 minutes.
  const token = process.env.AIRTABLE_TOKEN;
  if (token) {
    const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    try {
      const f = encodeURIComponent(`AND({Kind}='Auth link',{Update ID}='${email.replace(/'/g, "")}',DATETIME_DIFF(NOW(),CREATED_TIME(),'minutes')<15)`);
      const q = await fetch(`https://api.airtable.com/v0/${BASE}/${EVENTS}?filterByFormula=${f}&pageSize=5`, { headers: auth });
      if (q.ok && (((await q.json()).records) || []).length >= 3) {
        return r(429, { error: 'A sign-in link was already sent — check your inbox (and spam), or try again in a few minutes.' });
      }
      await fetch(`https://api.airtable.com/v0/${BASE}/${EVENTS}`, { method: 'POST', headers: auth, body: JSON.stringify({ fields: { 'Kind': 'Auth link', 'Update ID': email } }) });
    } catch (_) {}
  }

  const exp = Date.now() + 15 * 60 * 1000;
  const code = String(crypto.randomInt(100000, 1000000));
  const ch = crypto.createHmac('sha256', secret).update('acode:' + code).digest('hex').slice(0, 24);
  const linkToken = sign({ p: 'alink', email, exp }, secret);
  const codeToken = sign({ p: 'acode', email, ch, exp }, secret);
  const site = siteBase(event);
  const url = `${site}/.netlify/functions/auth-email-verify?t=${encodeURIComponent(linkToken)}`;

  const html = `<div style="font-family:-apple-system,Arial,sans-serif;max-width:440px;margin:0 auto;color:#0D1B2A">
    <p style="font-family:Georgia,'Times New Roman',serif;font-size:22px;margin:0 0 4px">Co<span style="color:#FF6B5B">&middot;</span>labr</p>
    <p style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#00C2B3;font-weight:700;margin:0 0 20px">In it together</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 18px">Here's your sign-in link — it works for the next 15 minutes:</p>
    <p style="margin:0 0 20px"><a href="${url}" style="display:inline-block;background:#FF6B5B;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:13px 26px;border-radius:10px">Sign in to Co&middot;labr</a></p>
    <p style="font-size:13.5px;line-height:1.6;color:#3d4a5c;margin:0 0 8px">If the button doesn't work, enter this code on the sign-in page instead:</p>
    <p style="font-size:26px;font-weight:800;letter-spacing:.18em;margin:0 0 22px">${code}</p>
    <p style="font-size:12px;color:#7d8794;line-height:1.6">You asked to sign in as ${esc(email)}. If this wasn't you, you can safely ignore this email — nothing happens without the link or code.</p>
  </div>`;
  const res = await sendMail({ to: email, subject: 'Your Co·labr sign-in link', html, fromName: 'Co·labr' });
  if (!res.ok) return r(502, { error: 'We couldn’t send the email — please try again.' });
  return r(200, { ok: true, ct: codeToken });
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
