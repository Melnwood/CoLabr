// Co·labr — platform-wide statistics for the super-admin console.
// Counts missionaries (live vs test), supporters (following / asked to follow),
// and published updates, rolled up by organization. Read-only, admins only.
const { sessionFromEvent, isAdmin } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const MISS = 'tbli1L8AO0JUDL7Wl';
const SUBS = 'tbl21LyWOBxln6bOy';
const UPDATES = 'tbl7aVErl35Qw36QZ';

async function fetchAll(table, auth, fields) {
  const rows = [];
  const fq = fields.map(f => 'fields%5B%5D=' + encodeURIComponent(f)).join('&');
  let url = `https://api.airtable.com/v0/${BASE}/${table}?pageSize=100&${fq}`;
  while (url) {
    const res = await fetch(url, { headers: auth }); if (!res.ok) break;
    const d = await res.json();
    rows.push(...(d.records || []));
    url = d.offset ? `https://api.airtable.com/v0/${BASE}/${table}?pageSize=100&${fq}&offset=${d.offset}` : '';
  }
  return rows;
}

exports.handler = async function (event) {
  const s = sessionFromEvent(event);
  if (!s) return r(401, { error: 'Please sign in.' });
  if (!isAdmin(s.email)) return r(403, { error: 'Admins only.' });
  const token = process.env.AIRTABLE_TOKEN; if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token };

  const [miss, subs, ups] = await Promise.all([
    fetchAll(MISS, auth, ['Name', 'Email', 'Organization', 'National Org', 'Live']),
    fetchAll(SUBS, auth, ['Missionary', 'Active', 'Source']),
    fetchAll(UPDATES, auth, ['Missionary', 'Status']),
  ]);

  // Missionary record id -> organization label. Stated org wins; JV staff who
  // never filled it in still roll up under Josiah Venture via their email domain.
  const orgOf = {};
  const orgs = {};
  function bucket(label) {
    if (!orgs[label]) orgs[label] = { label, missionaries: 0, live: 0, supporters: 0, pending: 0, updates: 0 };
    return orgs[label];
  }
  const orgByName = {};
  for (const rec of miss) {
    const f = rec.fields || {};
    let label = (f['National Org'] || f['Organization'] || '').trim();
    if (!label || /^(jv|josiah\s*venture)$/i.test(label)) {
      label = /josiahventure\.com/i.test(f['Email'] || '') || /^(jv|josiah\s*venture)$/i.test(label) || /^josiah\s*venture$/i.test(String(f['Name'] || '').trim()) ? 'Josiah Venture' : (label || 'Independent');
    }
    orgOf[rec.id] = label;
    if (f['Name']) orgByName[String(f['Name']).trim()] = label;
    const b = bucket(label);
    b.missionaries++;
    if (f['Live']) b.live++;
  }
  for (const rec of subs) {
    const f = rec.fields || {};
    const label = orgByName[String(f['Missionary'] || '').trim()] || 'Independent';
    const b = bucket(label);
    if (f['Active']) b.supporters++;
    else if (f['Source'] === 'Requested') b.pending++;
  }
  for (const rec of ups) {
    const f = rec.fields || {};
    if (f['Status'] !== 'Published') continue;
    bucket(orgOf[(f['Missionary'] || [])[0]] || 'Independent').updates++;
  }

  const list = Object.values(orgs).sort((a, b) => b.missionaries - a.missionaries || b.supporters - a.supporters);
  const totals = list.reduce((t, o) => ({
    missionaries: t.missionaries + o.missionaries, live: t.live + o.live,
    supporters: t.supporters + o.supporters, pending: t.pending + o.pending, updates: t.updates + o.updates,
  }), { missionaries: 0, live: 0, supporters: 0, pending: 0, updates: 0 });
  return r(200, { totals, orgs: list });
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
