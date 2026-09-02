// Co·labr — run the backup right now, for a signed-in super admin.
//
// The scheduled job runs every three hours and Netlify will not let you call a
// scheduled function over HTTP. That matters here: moving backups to a private bucket
// means proving a snapshot actually lands there BEFORE deleting the copies that are
// currently public. Waiting three hours to find out is how people delete first.
//
// Same pattern as care-digest-now and billing-sweep-now.
const { sessionFromEvent, isAdmin } = require('./_auth');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const session = sessionFromEvent(event);
  if (!session) return r(401, { error: 'Please sign in.' });
  if (!isAdmin(session.email)) return r(403, { error: 'Admins only.' });
  try {
    const backup = require('./backup');
    // backup.js only answers to the Netlify scheduler or a caller carrying the secret.
    // The admin check above is what authorises this; the secret is simply how that
    // authority is handed on, and it never leaves the server.
    const out = await backup.handler({
      httpMethod: 'POST', headers: {},
      body: JSON.stringify({ secret: process.env.SESSION_SECRET })
    });
    let body = {};
    try { body = JSON.parse(out.body || '{}'); } catch (e) { body = { raw: String(out.body || '').slice(0, 200) }; }
    return r(out.statusCode === 200 ? 200 : 502, {
      ok: out.statusCode === 200,
      bucket: process.env.GCS_BACKUP_BUCKET || '(not set)',
      ...body
    });
  } catch (e) {
    return r(502, { error: e.message || 'Backup failed.' });
  }
};
function r(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
