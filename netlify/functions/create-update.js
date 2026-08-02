// CoLabr — create an update. Writes a new record into Airtable.
// Security: requires a private passcode (Netlify env var EDIT_KEY) sent by the composer.
// Uses AIRTABLE_TOKEN (must have data.records:write scope on the base).

const { sessionFromEvent } = require('./_auth');
const BASE = 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(500, { error: 'Missing AIRTABLE_TOKEN.' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Bad request.' }); }

  const editKey = process.env.EDIT_KEY;
  const session = sessionFromEvent(event);
  if (!session && !(editKey && b.key === editKey)) return resp(401, { error: 'Please sign in.' });
  if (!b.title || !b.title.trim()) return resp(400, { error: 'A title is required.' });

  const fields = {
    'Title': b.title.trim(),
    'Body': b.body || '',
    'Excerpt': (b.body || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    'Type': b.type || 'Newsletter',
    'Status': b.publish ? 'Published' : 'Draft',
    'Source': 'CoLabr',
    'Missionary': ['The Ellenwood Family'],
    'Date': b.date || new Date().toISOString().slice(0, 10)
  };
  if (b.audiences && b.audiences.length) fields['Audiences'] = b.audiences;
  if (b.cover) fields['Cover Image URL'] = b.cover;
  if (b.video) fields['Video URL'] = b.video;

  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: true })
    });
    const data = await r.json();
    if (!r.ok) return resp(r.status, { error: (data.error && data.error.message) || 'Airtable rejected the write.' });
    return resp(200, { ok: true, id: data.id, status: fields.Status });
  } catch (e) {
    return resp(502, { error: 'Could not reach Airtable.' });
  }
};

function resp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
