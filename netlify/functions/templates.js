// Co·labr — update templates. Personal templates belong to their owner; Shared templates are
// published by admins and available to every signed-in staff member.
const { sessionFromEvent, isAdmin } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tblhh1ZIw0jFbllzw';
const F = {
  name: 'fldGYkH3AYLtoxj3o',
  blocks: 'fldJX050XPtNFR2G8',
  mode: 'fldyG83tumxOKG6o7',
  scope: 'fldm81qYnc4TWHv5t',
  ownerEmail: 'fldUUEIuzwQW1gH6R',
  ownerName: 'fld2WMid8zZZthmLu',
  type: 'fldEjF8OoQaqSJpEk',
  aud: 'fldUdR2k7zZQoe41O',
  banner: 'fldDlW4hgqau65x71'
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });
  const session = sessionFromEvent(event);
  if (!session) return resp(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;
  const email = (session.email || '').toLowerCase();
  const admin = isAdmin(session.email);
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Bad request.' }); }

  try {
    if (b.action === 'list') {
      // Page through everything, then keep the caller's own + all shared.
      let recs = [], offset = '';
      do {
        const r = await fetch(`${api}?pageSize=100&returnFieldsByFieldId=true${offset ? '&offset=' + offset : ''}`, { headers: auth });
        const d = await r.json(); if (!r.ok) return resp(r.status, { error: 'Could not load templates.' });
        recs = recs.concat(d.records || []); offset = d.offset || '';
      } while (offset);
      const map = rec => { const f = rec.fields || {};
        return { id: rec.id, name: f[F.name] || 'Untitled', mode: sel(f[F.mode]) || 'Full copy', scope: sel(f[F.scope]) || 'Personal',
          type: f[F.type] || '', aud: (f[F.aud] || '').split(',').map(s => s.trim()).filter(Boolean), banner: f[F.banner] || '',
          ownerName: f[F.ownerName] || '', ownerEmail: f[F.ownerEmail] || '', mine: (f[F.ownerEmail] || '').toLowerCase() === email,
          blocks: parse(f[F.blocks]) };
      };
      const all = recs.map(map);
      const personal = all.filter(t => t.scope !== 'Shared' && t.mine).sort(byName);
      const shared = all.filter(t => t.scope === 'Shared').sort(byName);
      return resp(200, { ok: true, personal, shared, admin });
    }

    if (b.action === 'save') {
      const t = b.template || {};
      const name = (t.name || '').trim();
      if (!name) return resp(400, { error: 'Please name the template.' });
      if (!Array.isArray(t.blocks) || !t.blocks.length) return resp(400, { error: 'There are no blocks to save.' });
      const scope = t.scope === 'Shared' ? 'Shared' : 'Personal';
      if (scope === 'Shared' && !admin) return resp(403, { error: 'Only admins can publish a shared template.' });
      const mode = t.mode === 'Structure only' ? 'Structure only' : 'Full copy';
      const banner = (t.blocks.find(x => x && x.type === 'hero' && x.url) || {}).url || '';
      const fields = {
        [F.name]: name, [F.blocks]: JSON.stringify(t.blocks), [F.mode]: mode, [F.scope]: scope,
        [F.ownerEmail]: email, [F.ownerName]: session.name || '', [F.type]: t.type || '',
        [F.aud]: Array.isArray(t.aud) ? t.aud.join(', ') : (t.aud || ''), [F.banner]: banner
      };
      const cr = await fetch(api, { method: 'POST', headers: auth, body: JSON.stringify({ fields, typecast: true }) });
      const cd = await cr.json();
      if (!cr.ok) return resp(cr.status, { error: (cd.error && cd.error.message) || 'Could not save the template.' });
      return resp(200, { ok: true, id: cd.id });
    }

    if (b.action === 'delete') {
      if (!b.id) return resp(400, { error: 'Missing id.' });
      // Only the owner (or an admin) may delete.
      const gr = await fetch(`${api}/${b.id}?returnFieldsByFieldId=true`, { headers: auth });
      if (!gr.ok) return resp(gr.status, { error: 'Template not found.' });
      const f = (await gr.json()).fields || {};
      const owner = (f[F.ownerEmail] || '').toLowerCase();
      if (owner !== email && !admin) return resp(403, { error: 'You can only delete your own templates.' });
      const dr = await fetch(`${api}/${b.id}`, { method: 'DELETE', headers: auth });
      if (!dr.ok) return resp(dr.status, { error: 'Could not delete.' });
      return resp(200, { ok: true });
    }

    return resp(400, { error: 'Unknown action.' });
  } catch (e) {
    return resp(502, { error: 'Something went wrong.' });
  }
};

function sel(v) { return (v && v.name) ? v.name : (v || ''); }
function parse(s) { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function byName(a, b) { return (a.name || '').localeCompare(b.name || ''); }
function resp(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
