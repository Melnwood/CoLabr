// Co·labr — build the monthly prayer update on demand (admins, or the import
// secret for testing). The scheduled twin is prayer-monthly.js.
const { sessionFromEvent, isAdmin } = require('./_auth');
const { runMonthly } = require('./_prayermonthly');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { b = {}; }
  const sess = sessionFromEvent(event);
  const secretOk = b.secret && (b.secret === process.env.IMPORT_SECRET || b.secret === process.env.SESSION_SECRET);
  if (!secretOk && !(sess && isAdmin(sess.email))) return r(403, { error: 'Admins only.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  try {
    const out = await runMonthly({ token, only: (b.missionary || '').trim() });
    return r(200, { ok: true, ...out });
  } catch (e) { return r(502, { error: e.message || 'Could not build it.' }); }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
