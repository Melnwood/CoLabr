// CoLabr — staff admin actions (list / publish-unpublish / delete).
// Passcode-gated with EDIT_KEY. Uses AIRTABLE_TOKEN (read+write scope).

const { sessionFromEvent } = require('./_auth');
const BASE = 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(500, { error: 'Server not configured.' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Bad request.' }); }
  const editKey = process.env.EDIT_KEY;
  const authed = sessionFromEvent(event) || (editKey && b.key === editKey);
  if (!authed) return resp(401, { error: 'Please sign in.' });

  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;

  try {
    if (b.action === 'list') {
      const r = await fetch(`${api}?pageSize=100`, { headers: auth });
      const data = await r.json();
      if (!r.ok) return resp(r.status, { error: 'Airtable read failed.' });
      const rows = (data.records || []).map(rec => {
        const c = rec.fields || {};
        return {
          id: rec.id,
          title: c['Title'] || '(untitled)',
          date: c['Date'] || '',
          type: c['Type'] || '',
          status: c['Status'] || 'Draft',
          opens: c['Opens'] || 0,
          source: c['Source'] || '',
          aud: c['Audiences'] || [],
          hasCover: !!c['Cover Image URL'],
          hasVideo: !!c['Video URL']
        };
      }).sort((a, b2) => (b2.date).localeCompare(a.date));
      return resp(200, { ok: true, rows });
    }

    if (b.action === 'setStatus') {
      if (!b.id || !b.status) return resp(400, { error: 'Missing id/status.' });
      const r = await fetch(api, { method: 'PATCH', headers: auth,
        body: JSON.stringify({ records: [{ id: b.id, fields: { Status: b.status } }], typecast: true }) });
      if (!r.ok) return resp(r.status, { error: 'Update failed.' });
      return resp(200, { ok: true });
    }

    if (b.action === 'delete') {
      if (!b.id) return resp(400, { error: 'Missing id.' });
      const r = await fetch(`${api}/${b.id}`, { method: 'DELETE', headers: auth });
      if (!r.ok) return resp(r.status, { error: 'Delete failed.' });
      return resp(200, { ok: true });
    }

    return resp(400, { error: 'Unknown action.' });
  } catch (e) {
    return resp(502, { error: 'Could not reach Airtable.' });
  }
};

function resp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
