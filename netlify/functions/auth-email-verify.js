// Co·labr — email sign-in, step 2: turn a magic link (GET ?t=) or a 6-digit code
// (POST {ct, code}) into a real session, then route like Google sign-in does:
// existing page → dashboard, no page yet → join.
const crypto = require('crypto');
const { sign, verify, makeSessionCookie, siteBase } = require('./_auth');
const { missByEmail } = require('./_shares');

exports.handler = async function (event) {
  const secret = process.env.SESSION_SECRET;
  const base = siteBase(event);
  if (!secret) return deny(base, 'The site is not fully configured.');

  if (event.httpMethod === 'GET') {
    const t = (event.queryStringParameters || {}).t || '';
    const p = verify(t, secret);
    if (!p || p.p !== 'alink' || !p.email) return deny(base, 'That sign-in link has expired or already changed — request a fresh one.');
    const dest = await destFor(p.email);
    // The explicit query stops Netlify's CDN from appending the original ?t= token
    // to the redirect — the sign-in token must not linger in the address bar.
    return {
      statusCode: 302,
      headers: { Location: base + dest + '?in=1', 'Set-Cookie': sessionFor(p.email), 'Cache-Control': 'no-store' },
      body: ''
    };
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'Bad request.' }); }
    const p = verify((b.ct || '').toString(), secret);
    if (!p || p.p !== 'acode' || !p.email) return j(400, { error: 'That code has expired — request a fresh one.' });
    const code = (b.code || '').toString().replace(/\D/g, '');
    const ch = crypto.createHmac('sha256', secret).update('acode:' + code).digest('hex').slice(0, 24);
    if (!code || ch !== p.ch) return j(401, { error: 'That code isn’t right — check the email and try again.' });
    const dest = await destFor(p.email);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionFor(p.email) }, body: JSON.stringify({ ok: true, dest }) };
  }

  return j(405, { error: 'Method not allowed' });

  function sessionFor(email) {
    return makeSessionCookie({ email, name: email, pic: '', exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  }
  async function destFor(email) {
    try {
      if (process.env.AIRTABLE_TOKEN) {
        const m = await missByEmail({ Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN }, email);
        if (m) return '/manage.html';
      }
    } catch (_) {}
    return '/join.html';
  }
};
function j(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
function deny(base, msg) { return { statusCode: 302, headers: { Location: base + '/login.html?e=' + encodeURIComponent(msg), 'Cache-Control': 'no-store' }, body: '' }; }
