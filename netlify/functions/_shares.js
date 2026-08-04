// Co-Labr — shared helpers for the peer share-and-approve feature.
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const MISS = 'tbli1L8AO0JUDL7Wl';
const UPDATES = 'tbl7aVErl35Qw36QZ';

function esc(s) { return String(s || '').replace(/'/g, "\\'"); }

// Map a signed-in member (by email) to their missionary/page record.
async function missByEmail(auth, email) {
  if (!email) return null;
  try {
    const url = `https://api.airtable.com/v0/${BASE}/${MISS}?maxRecords=1&filterByFormula=${encodeURIComponent(`LOWER({Email})='${esc((email || '').toLowerCase())}'`)}`;
    const r = await fetch(url, { headers: auth }); if (!r.ok) return null;
    const rec = ((await r.json()).records || [])[0]; if (!rec) return null;
    const f = rec.fields || {};
    return { id: rec.id, name: f['Name'] || '', country: f['Field Location'] || f['National Org'] || '' };
  } catch { return null; }
}
async function missById(auth, recId) {
  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}/${recId}`, { headers: auth }); if (!r.ok) return null;
    const f = (await r.json()).fields || {};
    return { name: f['Name'] || '', country: f['Field Location'] || f['National Org'] || '' };
  } catch { return null; }
}

module.exports = { BASE, MISS, UPDATES, esc, missByEmail, missById };
