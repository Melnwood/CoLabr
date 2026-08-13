// Co·labr — "Organizations forming" (admin only). Clusters missionaries by the organization
// they named at signup, falling back to their email domain (freemail domains don't cluster).
// 3+ from one organization = time for a human conversation about an org account.
const { sessionFromEvent, isAdmin } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const MISS = 'tbli1L8AO0JUDL7Wl';
const FREEMAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'seznam.cz', 'centrum.cz', 'wp.pl', 'o2.pl', 'gmx.de', 'gmx.net', 'web.de', 'comcast.net', 'sbcglobal.net', 'att.net', 'charter.net', 'live.com', 'msn.com', 'protonmail.com', 'proton.me']);

exports.handler = async function (event) {
  const s = sessionFromEvent(event);
  if (!s) return r(401, { error: 'Please sign in.' });
  if (!isAdmin(s.email)) return r(403, { error: 'Admins only.' });
  const token = process.env.AIRTABLE_TOKEN; if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token };

  const rows = [];
  let url = `https://api.airtable.com/v0/${BASE}/${MISS}?pageSize=100`;
  while (url) {
    const res = await fetch(url, { headers: auth }); if (!res.ok) break;
    const d = await res.json();
    (d.records || []).forEach(rec => {
      const f = rec.fields || {};
      rows.push({
        name: f['Name'] || '', email: (f['Email'] || '').toLowerCase(),
        org: (f['Organization'] || '').trim(), live: !!f['Live'], created: rec.createdTime || ''
      });
    });
    url = d.offset ? `https://api.airtable.com/v0/${BASE}/${MISS}?pageSize=100&offset=${d.offset}` : '';
  }

  // Cluster key: stated organization first (normalized), else a meaningful email domain.
  const clusters = {};
  for (const m of rows) {
    let key = '', label = '', how = '';
    if (m.org) { key = m.org.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); label = m.org; how = 'named at signup'; }
    else {
      const domain = (m.email.split(',')[0].split('@')[1] || '').trim();
      if (domain && !FREEMAIL.has(domain)) { key = domain; label = domain; how = 'email domain'; }
    }
    if (!key) continue;
    if (key === 'josiah venture' || key === 'josiahventure.com' || key === 'jv') { key = 'josiahventure'; label = 'Josiah Venture'; }
    if (!clusters[key]) clusters[key] = { label, how, members: [] };
    clusters[key].members.push({ name: m.name, email: m.email, live: m.live, created: m.created });
  }

  const out = Object.values(clusters)
    .map(c => ({ ...c, count: c.members.length, flag: c.label !== 'Josiah Venture' && c.members.length >= 3 }))
    .sort((a, b) => b.count - a.count);
  return r(200, { orgs: out, total: rows.length });
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
