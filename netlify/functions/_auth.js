// Shared auth helpers for Co-Labr (session signing + cookie parsing).
const crypto = require('crypto');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ||
  '466075134045-dt0ijv3b6sfp4ddfbhij60kd6h6744q8.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'josiahventure.com';
const COOKIE = 'cl_session';
// Super-admins who can add people. Configurable via ADMIN_EMAILS (comma-separated); defaults to Mel.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'mellenwood@josiahventure.com,nellenwood@josiahventure.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function isAdmin(email){ return !!email && ADMIN_EMAILS.includes(String(email).toLowerCase()); }

function b64url(buf){ return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function b64urlJSON(obj){ return b64url(JSON.stringify(obj)); }

function sign(payload, secret){
  const p = b64urlJSON(payload);
  const sig = b64url(crypto.createHmac('sha256', secret).update(p).digest());
  return p + '.' + sig;
}
function verify(token, secret){
  if(!token || token.indexOf('.')<0) return null;
  const [p, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', secret).update(p).digest());
  if(sig.length !== expected.length) return null;
  if(!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try{
    const payload = JSON.parse(Buffer.from(p.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString());
    if(payload.exp && Date.now() > payload.exp) return null;
    return payload;
  }catch{ return null; }
}
function parseCookies(header){
  const out = {};
  (header||'').split(';').forEach(c=>{ const i=c.indexOf('='); if(i>0) out[c.slice(0,i).trim()] = decodeURIComponent(c.slice(i+1).trim()); });
  return out;
}
function sessionFromEvent(event){
  const secret = process.env.SESSION_SECRET;
  if(!secret) return null;
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
  return verify(cookies[COOKIE], secret);
}
function makeSessionCookie(payload){
  const secret = process.env.SESSION_SECRET;
  const token = sign(payload, secret);
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;
}
function clearSessionCookie(){ return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`; }
function siteBase(event){
  const host = event.headers['x-forwarded-host'] || event.headers.host;
  return 'https://' + host;
}

module.exports = { CLIENT_ID, ALLOWED_DOMAIN, isAdmin, sign, verify, parseCookies, sessionFromEvent, makeSessionCookie, clearSessionCookie, siteBase, b64url };
