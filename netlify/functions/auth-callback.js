// Handles Google's redirect back: verifies the user, then sets a CoLabr session.
const { CLIENT_ID, ALLOWED_DOMAIN, parseCookies, makeSessionCookie, siteBase } = require('./_auth');

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
  const base = siteBase(event);

  if (q.error) return deny(base, 'Google sign-in was cancelled.');
  if (!q.code || !q.state || q.state !== cookies.cl_state) return deny(base, 'Sign-in could not be verified. Please try again.');

  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret || !process.env.SESSION_SECRET) return deny(base, 'The site is missing its Google secret. Check Netlify environment variables.');

  const redirectUri = base + '/.netlify/functions/auth-callback';
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.code, client_id: CLIENT_ID, client_secret: secret,
        redirect_uri: redirectUri, grant_type: 'authorization_code'
      })
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) return deny(base, 'Google did not return a valid sign-in.');

    const claims = decodeJwt(tok.id_token);
    const email = (claims.email || '').toLowerCase();
    if (!claims.email_verified || !email.endsWith('@' + ALLOWED_DOMAIN)) {
      return deny(base, 'Please sign in with your Josiah Venture (@' + ALLOWED_DOMAIN + ') account.');
    }
    const session = { email, name: claims.name || email, pic: claims.picture || '', exp: Date.now() + 7*24*60*60*1000 };
    return {
      statusCode: 302,
      headers: {
        Location: base + '/manage.html',
        'Set-Cookie': makeSessionCookie(session),
        'Cache-Control': 'no-store'
      },
      body: ''
    };
  } catch (e) {
    return deny(base, 'Could not complete sign-in. Please try again.');
  }
};

function decodeJwt(t){
  const p = t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
  return JSON.parse(Buffer.from(p, 'base64').toString());
}
function deny(base, msg){
  return { statusCode: 302, headers: { Location: base + '/login.html?e=' + encodeURIComponent(msg), 'Cache-Control':'no-store' }, body: '' };
}
