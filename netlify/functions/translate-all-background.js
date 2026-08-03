// Co-Labr — batch driver: translate every published update into all field languages.
// Lists published updates and fires the per-update translator, paced so we don't hammer the
// translation API or spin up too many functions at once. Secret-gated. Idempotent (overwrites).
const BASE = 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return j(405);
    let raw = event.body || ''; if (event.isBase64Encoded) { try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch {} }
    const ct = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
    let b = {}; if (/application\/json/i.test(ct)) { try { b = JSON.parse(raw || '{}'); } catch { return j(400); } }
    else { const p = new URLSearchParams(raw); b = { secret: p.get('secret') }; }
    const secret = process.env.SESSION_SECRET, site = process.env.SITE_BASE, token = process.env.AIRTABLE_TOKEN;
    if (!b.secret || (b.secret !== secret && b.secret !== process.env.IMPORT_SECRET)) return j(401);
    if (!site || !token) return j(500);
    const auth = { Authorization: 'Bearer ' + token };

    // Gather all published record IDs.
    const ids = [];
    let url = `https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100&returnFieldsByFieldId=true&fields%5B%5D=fldhkHAXyvqtrx3cu&filterByFormula=${encodeURIComponent("{Status}='Published'")}`;
    while (url) {
      const r = await fetch(url, { headers: auth }); if (!r.ok) break;
      const d = await r.json();
      (d.records || []).forEach(rec => ids.push(rec.id));
      url = d.offset ? `https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100&returnFieldsByFieldId=true&fields%5B%5D=fldhkHAXyvqtrx3cu&filterByFormula=${encodeURIComponent("{Status}='Published'")}&offset=${d.offset}` : '';
    }

    let fired = 0;
    for (const id of ids) {
      try {
        await fetch(`${site}/.netlify/functions/translate-update-background`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, recordId: id })
        });
        fired++;
      } catch (e) {}
      await sleep(4500); // pace the fan-out
    }
    await log(auth, JSON.stringify({ ok: true, fired, total: ids.length }));
    return j(200);
  } catch (e) { return j(200); }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function log(auth, body) {
  await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields: { Title: '__TRANSLATE_ALL__', Body: body, Status: 'Draft', Source: 'translate' } }], typecast: true }) }).catch(() => {});
}
function j(s) { return { statusCode: s || 200, headers: { 'Content-Type': 'application/json' }, body: '{}' }; }
