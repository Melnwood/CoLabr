// Co·labr — what a member sees about their own trial, and what an admin can do
// about anyone's. The state itself is derived in _billing.js; nothing here invents
// its own rules.
const { sessionFromEvent, isAdmin } = require('./_auth');
const B = require('./_billing');
const M_NAME = 'fldPYSQwxoQJGb0Zd', M_EMAIL = 'fld65nJ51ewtIWTxj';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const sess = sessionFromEvent(event);
  if (!sess) return r(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }

  try {
    // ---- Mine ----
    if (!b.action || b.action === 'mine') {
      const on = await B.enforcing(auth);
      const rec = await B.recordFor(auth, sess.email);
      if (!rec) return r(200, { ok: true, enforcing: on, state: 'none' });
      const st = B.stateOf(rec.fields);
      // With enforcement off nobody is ever blocked — say so plainly rather than
      // showing a countdown that means nothing yet.
      return r(200, { ok: true, enforcing: on, armed: on, ...st,
        canWrite: on ? st.canWrite : true, canRead: on ? st.canRead : true,
        trialDays: B.TRIAL_DAYS, archive: rec.fields[B.F.archiveUrl] || '' });
    }

    if (!isAdmin(sess.email)) return r(403, { error: 'Admins only.' });

    // ---- Everyone, for the admin console ----
    if (b.action === 'list') {
      let people = [], url = `https://api.airtable.com/v0/${B.BASE}/${B.MISS}?pageSize=100`;
      while (url) {
        const rr = await fetch(url, { headers: auth }); if (!rr.ok) break;
        const d = await rr.json(); people = people.concat(d.records || []);
        url = d.offset ? `https://api.airtable.com/v0/${B.BASE}/${B.MISS}?pageSize=100&offset=${d.offset}` : '';
      }
      const rows = people.map(rec => {
        const f = rec.fields || {};
        const st = B.stateOf(f);
        return { id: rec.id, name: f[M_NAME] || '', email: f[M_EMAIL] || '',
          state: st.state, day: st.day || 0, daysLeft: st.daysLeft || 0,
          start: f[B.F.start] || '', paidUntil: f[B.F.paidUntil] || '',
          covered: !!f[B.F.covered], hiddenOn: f[B.F.hiddenOn] || '',
          archiveSent: f[B.F.archiveSent] || '', archive: f[B.F.archiveUrl] || '' };
      }).filter(x => x.name);
      const ORDER = { 'due-delete': 0, hidden: 1, 'due-hide': 2, frozen: 3, trial: 4, paid: 5, covered: 6 };
      rows.sort((a, z) => (ORDER[a.state] - ORDER[z.state]) || (a.name || '').localeCompare(z.name || ''));
      return r(200, { ok: true, enforcing: await B.enforcing(auth), rows });
    }

    // ---- Change someone's standing ----
    if (b.action === 'set') {
      if (!b.id) return r(400, { error: 'Which page?' });
      const fields = {};
      if (b.covered !== undefined) fields[B.F.covered] = !!b.covered;
      if (b.paidUntil !== undefined) fields[B.F.paidUntil] = String(b.paidUntil || '').slice(0, 10) || null;
      if (b.start !== undefined) fields[B.F.start] = String(b.start || '').slice(0, 10) || null;
      // Restoring a page clears the dark flag and the warning history, so the
      // countdown starts clean rather than resuming where it left off.
      if (b.restore) { fields[B.F.hiddenOn] = null; fields[B.F.notified] = ''; }
      if (!Object.keys(fields).length) return r(400, { error: 'Nothing to change.' });
      const ur = await fetch(`https://api.airtable.com/v0/${B.BASE}/${B.MISS}/${b.id}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({ fields, typecast: true }) });
      if (!ur.ok) return r(502, { error: 'Could not save.' });
      return r(200, { ok: true, state: B.stateOf(((await ur.json()).fields) || {}).state });
    }

    // ---- Arm or disarm the whole system ----
    if (b.action === 'enforce') {
      const sr = await fetch(`https://api.airtable.com/v0/${B.BASE}/${B.SETTINGS}?maxRecords=1`, { headers: auth });
      const rec = sr.ok ? (((await sr.json()).records) || [])[0] : null;
      if (!rec) return r(502, { error: 'No Platform Settings row.' });
      const ur = await fetch(`https://api.airtable.com/v0/${B.BASE}/${B.SETTINGS}/${rec.id}`, {
        method: 'PATCH', headers: auth,
        body: JSON.stringify({ fields: { 'Billing enforcement': !!b.on }, typecast: true }) });
      if (!ur.ok) return r(502, { error: 'Could not change it.' });
      return r(200, { ok: true, enforcing: !!b.on });
    }

    return r(400, { error: 'Unknown action.' });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
