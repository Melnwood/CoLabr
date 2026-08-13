// Co·labr — the author of an update approves or declines a request to feature it on a teammate's
// wall. Only the update's author may decide. Approve → the story appears on the requester's rail.
const { sessionFromEvent } = require('./_auth');
const { BASE, missByEmail } = require('./_shares');
const SHARES = 'tblKLXrYICtkiSp40';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });
  const session = sessionFromEvent(event);
  if (!session) return resp(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(500, { error: 'Server not configured.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Bad request.' }); }
  if (!b.id || !['approve', 'decline', 'unfeature'].includes(b.decision)) return resp(400, { error: 'Bad request.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  try {
    const gr = await fetch(`https://api.airtable.com/v0/${BASE}/${SHARES}/${b.id}`, { headers: auth });
    if (!gr.ok) return resp(404, { error: 'Request not found.' });
    const f = (await gr.json()).fields || {};
    const me = await missByEmail(auth, session.email);
    const myName = me ? me.name : (session.name || '');
    // 'unfeature': the wall owner takes a pick off their own rail — the share row is deleted.
    if (b.decision === 'unfeature') {
      if ((f['Requester Page'] || '') !== myName) return resp(403, { error: 'This is not on your wall.' });
      const dr = await fetch(`https://api.airtable.com/v0/${BASE}/${SHARES}/${b.id}`, { method: 'DELETE', headers: auth });
      if (!dr.ok) return resp(502, { error: 'Could not remove.' });
      return resp(200, { ok: true, status: 'Removed' });
    }
    // Only the author of the update may approve/decline sharing it.
    if ((f['Author'] || '') !== myName) return resp(403, { error: "This isn't yours to decide." });
    const status = b.decision === 'approve' ? 'Approved' : 'Revoked';
    const pr = await fetch(`https://api.airtable.com/v0/${BASE}/${SHARES}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ records: [{ id: b.id, fields: { Status: status } }], typecast: true }) });
    if (!pr.ok) return resp(502, { error: 'Could not save.' });
    return resp(200, { ok: true, status });
  } catch (e) {
    return resp(502, { error: 'Something went wrong.' });
  }
};
function resp(s, b) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
