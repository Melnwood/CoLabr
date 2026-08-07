// Co·labr — rename ripple. Updates link to Missionaries by record (renames follow free),
// but Subscribers carry the missionary NAME as text — token checks, sends, invites, and
// people lists all match on it. After a page rename this rewrites every subscriber row
// from the old name to the new one, so access and email never miss a beat.
// Fired automatically by admin.js renamePage; secret-gated; idempotent.
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const SUBS = 'tbl21LyWOBxln6bOy';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return j(405);
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return j(400); }
    if (!b.secret || (b.secret !== process.env.SESSION_SECRET && b.secret !== process.env.IMPORT_SECRET)) return j(401);
    const oldName = (b.oldName || '').toString().trim();
    const newName = (b.newName || '').toString().trim();
    if (!oldName || !newName || oldName === newName) return j(400);
    const token = process.env.AIRTABLE_TOKEN; if (!token) return j(500);
    const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const api = `https://api.airtable.com/v0/${BASE}/${SUBS}`;

    // Everyone still pointing at the old name.
    let ids = [], offset = '';
    const f = encodeURIComponent(`{Missionary}='${oldName.replace(/'/g, "")}'`);
    do {
      const r = await fetch(`${api}?pageSize=100&filterByFormula=${f}${offset ? '&offset=' + offset : ''}&fields%5B%5D=Email`, { headers: auth });
      if (!r.ok) break;
      const d = await r.json();
      ids = ids.concat((d.records || []).map(x => x.id)); offset = d.offset || '';
    } while (offset);

    let moved = 0;
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10).map(id => ({ id, fields: { 'Missionary': newName } }));
      const pr = await fetch(api, { method: 'PATCH', headers: auth, body: JSON.stringify({ records: batch, typecast: true }) });
      if (pr.ok) moved += batch.length;
    }
    console.log('rename-sync', JSON.stringify({ oldName, newName, found: ids.length, moved }));
    return j(200);
  } catch (e) { console.log('rename-sync EXCEPTION', String(e && e.message || e)); return j(200); }
};
function j(s) { return { statusCode: s, body: '{}' }; }
