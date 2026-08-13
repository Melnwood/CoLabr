// Co·labr — Care radar follow-up log. A row in Care Follow-ups means someone on the
// care team reached out about that flagged update. Super-admin only.
const { sessionFromEvent, isAdmin } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tblZVyXzLwJU0V5k5';
const F = {
  updateId: 'fldkVmmZYENP6tLfY', author: 'fldUunCg4xwnYyA6l', cats: 'fldnNU5F1b0A8zcIT',
  note: 'flduUDhe2K18YOE4f', by: 'fldazKBlriOsPU3CJ', date: 'fldw7ScLpYXkLNC0K'
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const session = sessionFromEvent(event);
  if (!session) return r(401, { error: 'Please sign in.' });
  if (!isAdmin(session.email)) return r(403, { error: 'Admins only.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }

  try {
    if (b.action === 'list') {
      // Small table — return the whole follow-up map keyed by update id.
      let recs = [], offset = '';
      do {
        const rr = await fetch(`${api}?pageSize=100&returnFieldsByFieldId=true${offset ? '&offset=' + offset : ''}`, { headers: auth });
        if (!rr.ok) return r(502, { error: 'Could not read follow-ups.' });
        const d = await rr.json(); recs = recs.concat(d.records || []); offset = d.offset || '';
      } while (offset);
      const map = {};
      recs.forEach(rec => { const f = rec.fields || {}; if (f[F.updateId]) map[f[F.updateId]] = { recId: rec.id, by: f[F.by] || '', date: f[F.date] || '' }; });
      return r(200, { map });
    }

    if (b.action === 'mark') {
      if (!b.updateId) return r(400, { error: 'Missing update.' });
      const fields = {
        [F.updateId]: String(b.updateId), [F.author]: String(b.author || '').slice(0, 120),
        [F.cats]: Array.isArray(b.categories) ? b.categories.join(', ') : String(b.categories || ''),
        [F.note]: String(b.note || '').slice(0, 500),
        [F.by]: (session.name || session.email || '').slice(0, 120),
        [F.date]: new Date().toISOString().slice(0, 10)
      };
      const cr = await fetch(api, { method: 'POST', headers: auth, body: JSON.stringify({ fields, typecast: true }) });
      const cd = await cr.json();
      if (!cr.ok) return r(cr.status, { error: (cd.error && cd.error.message) || 'Could not save.' });
      return r(200, { ok: true, recId: cd.id, by: fields[F.by], date: fields[F.date] });
    }

    if (b.action === 'unmark') {
      if (!b.recId) return r(400, { error: 'Missing record.' });
      const dr = await fetch(`${api}/${b.recId}`, { method: 'DELETE', headers: auth });
      if (!dr.ok) return r(dr.status, { error: 'Could not undo.' });
      return r(200, { ok: true });
    }

    return r(400, { error: 'Unknown action.' });
  } catch (e) {
    return r(502, { error: 'Something went wrong.' });
  }
};
function r(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
