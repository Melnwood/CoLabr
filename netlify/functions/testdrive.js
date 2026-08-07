// Co·labr — super-admin test-drive reset. Wipes every trace of a TEST persona
// (Missionaries page + Subscribers rows) so first-time flows can be replayed forever.
// Safety rail: only plus-alias addresses (you+anything@…) can be wiped — real people's
// records physically cannot match, so a slip can't delete a genuine supporter or page.
const { sessionFromEvent, isAdmin } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const MISS = 'tbli1L8AO0JUDL7Wl';
const SUBS = 'tbl21LyWOBxln6bOy';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const s = sessionFromEvent(event);
  if (!s || !isAdmin(s.email)) return r(403, { error: 'Super admins only.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const email = (b.email || '').toString().trim().toLowerCase();
  if (!/^[^\s@]+\+[^\s@]*@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return r(400, { error: 'Test personas must use a plus-alias (like you+test1@gmail.com) — real addresses can’t be wiped.' });
  }
  const token = process.env.AIRTABLE_TOKEN; if (!token) return r(500, { error: 'Server not configured.' });
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
  return r(200, { ok: true, pages, subs });
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
