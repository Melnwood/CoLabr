// Co·labr — MPD radar endpoint. Super-admin only. The scan lives in _mpd.js.
const { sessionFromEvent, isAdmin } = require('./_auth');
const { mpdScan } = require('./_mpd');

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
  const days = Math.min(365, Math.max(7, +b.days || 90));
  try {
    const { items, scanned, read, silent } = await mpdScan({ token, key, days });
    return r(200, { items, scanned, read: read || 0, silent: silent || [], days });
  } catch (e) {
    return r(502, { error: e.message || 'Could not finish the scan.' });
  }
};
function r(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
