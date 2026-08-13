// Co·labr — platform switches. GET: current state (any signed-in user, so UIs can show it).
// POST {pause:true|false}: admin only — freeze or resume ALL outbound subscriber email.
const { sessionFromEvent, isAdmin } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const SETTINGS = 'tblnAJuAOg7pmlVFR';

exports.handler = async function (event) {
  const s = sessionFromEvent(event);
  if (!s) return r(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN; if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = `https://api.airtable.com/v0/${BASE}/${SETTINGS}`;

  const gr = await fetch(`${api}?maxRecords=1&filterByFormula=${encodeURIComponent(`{Name}='Platform'`)}`, { headers: auth });
  if (!gr.ok) return r(502, { error: 'Could not read settings.' });
  const rec = (((await gr.json()).records) || [])[0];
  if (!rec) return r(500, { error: 'Platform settings record missing.' });

  if (event.httpMethod === 'GET') return r(200, { paused: !!rec.fields['Pause all email'], hideFieldnotes: !!rec.fields['Hide Field Notes'] });

  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  if (!isAdmin(s.email)) return r(403, { error: 'Admins only.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const fields = {};
  if ('pause' in b) fields['Pause all email'] = !!b.pause;
  if ('hideFieldnotes' in b) fields['Hide Field Notes'] = !!b.hideFieldnotes;
  if (!Object.keys(fields).length) return r(400, { error: 'Nothing to change.' });
  const ur = await fetch(api, { method: 'PATCH', headers: auth, body: JSON.stringify({ records: [{ id: rec.id, fields }] }) });
  if (!ur.ok) return r(502, { error: 'Could not update settings.' });
  return r(200, { ok: true, paused: 'pause' in b ? !!b.pause : !!rec.fields['Pause all email'], hideFieldnotes: 'hideFieldnotes' in b ? !!b.hideFieldnotes : !!rec.fields['Hide Field Notes'] });
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
