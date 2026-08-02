// CoLabr — live updates feed. Reads published updates from Airtable.
// The Airtable token lives ONLY here (server-side), set as a Netlify environment
// variable named AIRTABLE_TOKEN. It is never sent to the browser.

const BASE = 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';
const F = {
  title:  'fldhkHAXyvqtrx3cu',
  date:   'fldvi8dFkZBFANacG',
  opens:  'fldaZUAn4m3idZliI',
  cover:  'fldsU5p6r9LzdeTF7',
  video:  'fldzK9sIREqMYJU5e',
  excerpt:'fld9PBqSvmd4vNiyh',
  arc:    'fldGKATli4f8Kk8d7',
  aud:    'fld6ZpC94Aq43d5ZY',
  blocks: 'fldN9B0v6YU0xptFu'
};

exports.handler = async function () {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    return json(500, { error: 'Missing AIRTABLE_TOKEN environment variable in Netlify.' });
  }
  const formula = encodeURIComponent("{Status}='Published'");
  const url = `https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100&returnFieldsByFieldId=true&filterByFormula=${formula}`;
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return json(r.status, { error: 'Airtable request failed (' + r.status + ')' });
    const data = await r.json();
    const updates = (data.records || []).map(rec => {
      const c = rec.fields || {};
      return {
        title:   c[F.title] || '',
        rawdate: c[F.date] || '',
        opens:   c[F.opens] || 0,
        cover:   c[F.cover] || '',
        video:   c[F.video] || '',
        excerpt: c[F.excerpt] || '',
        arc:     c[F.arc] || '',
        aud:     (c[F.aud] || []).map(a => (a && a.name) ? a.name : a),
        blocks:  parseBlocks(c[F.blocks])
      };
    }).filter(u => u.title).sort((a, b) => (b.rawdate).localeCompare(a.rawdate));
    return json(200, updates, 'public, max-age=300');
  } catch (e) {
    return json(502, { error: 'Could not reach Airtable.' });
  }
};

function parseBlocks(v) {
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}

function json(statusCode, body, cache) {
  const headers = { 'Content-Type': 'application/json' };
  if (cache) headers['Cache-Control'] = cache;
  return { statusCode, headers, body: JSON.stringify(body) };
}
