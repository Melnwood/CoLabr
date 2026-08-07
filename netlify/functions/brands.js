// Co-Labr — National Org branding (logos + colors). Signed-in staff can read;
// save/delete is super-admin only (branding is platform config, not a personal setting).
// Uses AIRTABLE_TOKEN (read for list; read+write for save/delete).
const { sessionFromEvent, isAdmin } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl152sVfqGyrqpJQ';            // National Orgs
// Three-color brand system: ink (text/buttons), accent (the single spark/CTA), bg (page background).
const F = {
  name:    'fldsyU3dpzLdkXI7t',
  code:    'fldYMMDdsP2DgNzmZ',
  country: 'fldsJCCbZgD5wcamY',
  logo:    'fldBJzji3j5ML7DHd',
  accent:  'fldqjEmVMB9lVTOzG',   // the spark (CTAs, accents) — JV default #FF6600
  ink:     'fldhe4BdqqpM37Hod',   // near-black for text + buttons
  bg:      'fldpgLMC8jv9YHtxm',   // page background (white / soft cream)
  textOn:  'fldufCKMaSCYUh3xt',   // text color over the accent (Light/Dark) for button contrast
  website: 'fldW4oLN6GBcCSNCw',
  give:    'fldxLnwhxtFv88MGn',
  tagline: 'fldpRHgjPEpeeUTsL'
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(500, { error: 'Server not configured.' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Bad request.' }); }
  const editKey = process.env.EDIT_KEY;
  const sess = sessionFromEvent(event);
  const keyed = editKey && b.key === editKey;
  if (!sess && !keyed) return resp(401, { error: 'Please sign in.' });
  if ((b.action === 'save' || b.action === 'delete') && !keyed && !(sess && isAdmin(sess.email))) {
    return resp(403, { error: 'Super admins only — branding is platform-wide.' });
  }

  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;

  try {
    if (b.action === 'list') {
      const r = await fetch(`${api}?pageSize=100&returnFieldsByFieldId=true`, { headers: auth });
      const data = await r.json();
      if (!r.ok) return resp(r.status, { error: (data.error && (data.error.message || data.error)) || 'Airtable read failed.' });
      const orgs = (data.records || []).map(rec => {
        const c = rec.fields || {};
        const sel = c[F.textOn]; const textOn = (sel && sel.name) ? sel.name : (sel || 'Light');
        return {
          id: rec.id,
          name: c[F.name] || '',
          code: c[F.code] || '',
          country: c[F.country] || '',
          logo: c[F.logo] || '',
          ink: c[F.ink] || '',
          accent: c[F.accent] || '',
          bg: c[F.bg] || '',
          textOn,
          website: c[F.website] || '',
          give: c[F.give] || '',
          tagline: c[F.tagline] || ''
        };
      }).sort((a, b2) => a.name.localeCompare(b2.name));
      return resp(200, { ok: true, orgs });
    }

    if (b.action === 'save') {
      const o = b.org || {};
      if (!o.name || !o.name.trim()) return resp(400, { error: 'A name is required.' });
      const fields = {
        [F.name]: o.name.trim(),
        [F.code]: o.code || '',
        [F.country]: o.country || '',
        [F.logo]: o.logo || '',
        [F.ink]: o.ink || '',
        [F.accent]: o.accent || '',
        [F.bg]: o.bg || '',
        [F.textOn]: o.textOn === 'Dark' ? 'Dark' : 'Light',
        [F.website]: o.website || '',
        [F.give]: o.give || '',
        [F.tagline]: o.tagline || ''
      };
      let r;
      if (o.id) {
        r = await fetch(api, { method: 'PATCH', headers: auth, body: JSON.stringify({ records: [{ id: o.id, fields }], typecast: true }) });
      } else {
        r = await fetch(api, { method: 'POST', headers: auth, body: JSON.stringify({ fields, typecast: true }) });
      }
      const data = await r.json();
      if (!r.ok) return resp(r.status, { error: (data.error && data.error.message) || 'Could not save.' });
      const id = o.id ? (data.records && data.records[0] && data.records[0].id) : data.id;
      return resp(200, { ok: true, id });
    }

    if (b.action === 'delete') {
      if (!b.id) return resp(400, { error: 'Missing id.' });
      const r = await fetch(`${api}/${b.id}`, { method: 'DELETE', headers: auth });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return resp(r.status, { error: (e.error && e.error.message) || 'Delete failed.' }); }
      return resp(200, { ok: true });
    }

    return resp(400, { error: 'Unknown action.' });
  } catch (e) {
    return resp(502, { error: 'Could not reach Airtable.' });
  }
};

function resp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
