// Co-Labr — Care radar: scan everyone's latest updates for significant life events
// (hard news, exciting news, big changes, babies, deaths). Super-admin only.
// The scan itself lives in _care.js (shared with the daily care-digest email).
const { sessionFromEvent, isAdmin } = require('./_auth');
const { careScan } = require('./_care');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const session = sessionFromEvent(event);
  if (!session) return r(401, { error: 'Please sign in.' });
  if (!isAdmin(session.email)) return r(403, { error: 'Admins only.' });
  const token = process.env.AIRTABLE_TOKEN;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!token) return r(500, { error: 'Server not configured.' });
  if (!key) return r(500, { error: 'AI is not set up (missing ANTHROPIC_API_KEY).' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { b = {}; }
  const days = Math.min(365, Math.max(7, +b.days || 60));
  try {
    const { items, scanned } = await careScan({ token, key, days, windowOnly: false });
    return r(200, { items, scanned, days });
  } catch (e) {
    return r(502, { error: e.message || 'Could not finish the scan.' });
  }
};
function r(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
