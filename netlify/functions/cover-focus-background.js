// Co·labr — one-off backfill: copy each published update's banner focal point (fx/fy on
// the cover's hero/photo block) into the small "Cover Focus" field, so directory and
// rail cards crop the way the missionary chose. Secret-gated, idempotent.
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return j(405);
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return j(400); }
    if (!b.secret || (b.secret !== process.env.SESSION_SECRET && b.secret !== process.env.IMPORT_SECRET)) return j(401);
    const token = process.env.AIRTABLE_TOKEN; if (!token) return j(500);
    const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;

    let recs = [], offset = '';
    const f = encodeURIComponent(`AND({Status}='Published', LEN({Cover Image URL})>0)`);
    do {
      const r = await fetch(`${api}?pageSize=100&filterByFormula=${f}${offset ? '&offset=' + offset : ''}`, { headers: auth });
      if (!r.ok) break;
      const d = await r.json(); recs = recs.concat(d.records || []); offset = d.offset || '';
    } while (offset);

    let wrote = 0;
    for (const rec of recs) {
      const c = rec.fields || {};
      const cover = c['Cover Image URL'] || '';
      let blocks = []; try { blocks = JSON.parse(c['Blocks'] || '[]'); } catch {}
      const cb = blocks.find(x => x && (x.type === 'hero' || x.type === 'photo') && x.url === cover) || {};
      const focus = `${cb.fx != null ? +cb.fx : 50}% ${cb.fy != null ? +cb.fy : 50}%`;
      if ((c['Cover Focus'] || '') === focus) continue;
      const pr = await fetch(api, { method: 'PATCH', headers: auth,
        body: JSON.stringify({ records: [{ id: rec.id, fields: { 'Cover Focus': focus } }], typecast: true }) });
      if (pr.ok) wrote++;
    }
    console.log('cover-focus backfill', JSON.stringify({ scanned: recs.length, wrote }));
    return j(200);
  } catch (e) { console.log('cover-focus EXCEPTION', String(e && e.message || e)); return j(200); }
};
function j(s) { return { statusCode: s, body: '{}' }; }
