// Co-Labr — the go-live ceremony. A missionary flips their OWN page from test mode to live:
// from now on, publishing an update emails their subscribers. The UI shows the subscriber
// count in the confirm; this endpoint just records the deliberate choice.
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const MISS = 'tbli1L8AO0JUDL7Wl';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const s = sessionFromEvent(event);
  if (!s) return r(401, { error: 'Please sign in first.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const token = process.env.AIRTABLE_TOKEN; if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const me = await missByEmail(auth, s.email);
  if (!me) return r(404, { error: 'No page found for your account.' });

  const live = b.live !== false;   // default action is going live; {live:false} steps back to test mode
  const ur = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}/${me.id}`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ fields: { 'Live': live } })
  });
  if (!ur.ok) return r(502, { error: 'Could not update. Please try again.' });
  return r(200, { ok: true, live });
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
