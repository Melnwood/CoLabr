// Co·labr — super-admin test drive. One click switches the admin into a disposable
// TEST persona (reset automatically first) so first-time flows can be replayed forever:
//   GET ?go=outsider  -> become a brand-new person OUTSIDE JV (gmail address)
//   GET ?go=jvstaff   -> become a brand-new person INSIDE JV (@josiahventure.com)
// Coming back = Sign out, sign in with Google as yourself.
// POST {email} still wipes any plus-alias persona by hand (safety rail: only addresses
// containing '+' can ever be wiped, so real people's records physically can't match).
const { sessionFromEvent, isAdmin, makeSessionCookie } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const MISS = 'tbli1L8AO0JUDL7Wl';
const SUBS = 'tbl21LyWOBxln6bOy';

const PERSONAS = {
  outsider: { email: 'taylor.new+testdrive@gmail.com', name: 'Taylor (test drive)' },
  jvstaff: { email: 'new.staff+testdrive@josiahventure.com', name: 'New Staff (test drive)' },
};

exports.handler = async function (event) {
  const s = sessionFromEvent(event);
  if (!s || !isAdmin(s.email)) return r(403, { error: 'Super admins only.' });
  const token = process.env.AIRTABLE_TOKEN; if (!token) return r(500, { error: 'Server not configured.' });

  if (event.httpMethod === 'GET') {
    const p = PERSONAS[((event.queryStringParameters || {}).go || '')];
    if (!p) return r(400, { error: 'Which persona? go=outsider or go=jvstaff.' });
    await wipe(token, p.email);   // fresh slate every single time
    return {
      statusCode: 302,
      headers: {
        Location: '/home.html',
        'Set-Cookie': makeSessionCookie({ email: p.email, name: p.name, pic: '', exp: Date.now() + 2 * 60 * 60 * 1000 }),
        'Cache-Control': 'no-store',
      },
      body: '',
    };
  }

  if (event.httpMethod === 'POST') {
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
    const email = (b.email || '').toString().trim().toLowerCase();
    if (!/^[^\s@]+\+[^\s@]*@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return r(400, { error: 'Test personas must use a plus-alias (like you+test1@gmail.com) — real addresses can’t be wiped.' });
    }
    const out = await wipe(token, email);
    return r(200, { ok: true, ...out });
  }

  return r(405, { error: 'Method not allowed' });
};

async function wipe(token, email) {
  const auth = { Authorization: 'Bearer ' + token };
  const esc = email.replace(/'/g, "");
  let pages = 0, subs = 0;
  // Their page(s) — Email field may hold a comma list, match by FIND.
  const mf = encodeURIComponent(`FIND('${esc}', LOWER({Email}))>0`);
  const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?filterByFormula=${mf}&pageSize=20`, { headers: auth });
  if (mr.ok) {
    for (const rec of ((await mr.json()).records || [])) {
      const dr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}/${rec.id}`, { method: 'DELETE', headers: auth });
      if (dr.ok) pages++;
    }
  }
  // Their subscriberships on anyone's wall.
  const sf = encodeURIComponent(`LOWER({Email})='${esc}'`);
  const sr = await fetch(`https://api.airtable.com/v0/${BASE}/${SUBS}?filterByFormula=${sf}&pageSize=50`, { headers: auth });
  if (sr.ok) {
    for (const rec of ((await sr.json()).records || [])) {
      const dr = await fetch(`https://api.airtable.com/v0/${BASE}/${SUBS}/${rec.id}`, { method: 'DELETE', headers: auth });
      if (dr.ok) subs++;
    }
  }
  return { pages, subs };
}
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
