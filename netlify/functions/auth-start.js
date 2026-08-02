// Begins Google sign-in: redirects the staff member to Google's consent screen.
const crypto = require('crypto');
const { CLIENT_ID, ALLOWED_DOMAIN, siteBase } = require('./_auth');

exports.handler = async function (event) {
  const redirectUri = siteBase(event) + '/.netlify/functions/auth-callback';
  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'select_account',
    hd: ALLOWED_DOMAIN,
    state
  });
  return {
    statusCode: 302,
    headers: {
      Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(),
      'Set-Cookie': `cl_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
      'Cache-Control': 'no-store'
    },
    body: ''
  };
};
