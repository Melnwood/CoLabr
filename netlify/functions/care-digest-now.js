// Co·labr — "Email me this now": lets a signed-in super-admin trigger the Care-radar
// morning digest immediately (for testing). The daily send is care-digest.js.
const { runDigest } = require('./_caredigest');
const { sessionFromEvent, isAdmin } = require('./_auth');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const session = sessionFromEvent(event);
  if (!session) return r(401, { error: 'Please sign in.' });
  if (!isAdmin(session.email)) return r(403, { error: 'Admins only.' });
  try {
    const out = await runDigest();
    return r(200, { ok: out.sent > 0, ...out });
  } catch (e) {
    return r(502, { error: e.message || 'Digest failed.' });
  }
};
function r(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
