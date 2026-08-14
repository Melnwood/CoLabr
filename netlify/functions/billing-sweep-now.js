// Co·labr — run the trial-clock pass on demand (admins, or the import secret).
// Defaults to a DRY RUN: it tells you exactly what it would do and touches nothing.
// Pass {"dry":false} to let it act. The scheduled twin is billing-sweep.js.
const { sessionFromEvent, isAdmin } = require('./_auth');
const { runSweep } = require('./_billingsweep');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { b = {}; }
  const sess = sessionFromEvent(event);
  const secretOk = b.secret && (b.secret === process.env.IMPORT_SECRET || b.secret === process.env.SESSION_SECRET);
  if (!secretOk && !(sess && isAdmin(sess.email))) return r(403, { error: 'Admins only.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  try {
    // Acting is opt-in, every single time. You have to ask for it.
    const out = await runSweep({ token, only: (b.missionary || '').trim(), dry: b.dry !== false });
    return r(200, out);
  } catch (e) { return r(502, { error: e.message || 'Could not run the sweep.' }); }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
