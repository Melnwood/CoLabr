// Co-Labr — lightweight event tracking (public). Currently logs Give-button clicks
// (interest, not gifts). Uses AIRTABLE_TOKEN (write).
// Signed-in members are never counted — engagement means people OUTSIDE the team.
const { sessionFromEvent } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl2Dm5W07cAMrJgs';
const F = { kind: 'fldNrmKtonmpty6Ks', updateId: 'fldYFmxTqQ4tgBLKM', updateTitle: 'fldrZdDFBAoJr12oT', missionary: 'fldJQEL5qOEQT1Jsh' };
const KINDS = ['Give'];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  try { if (sessionFromEvent(event)) return r(200, { ok: true, skipped: 'staff' }); } catch (e) {}
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(200, { ok: false }); // never break the Give click over tracking
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(200, { ok: false }); }
  const kind = KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) return r(200, { ok: false });
  const fields = { [F.kind]: kind };
  if (b.updateId) fields[F.updateId] = String(b.updateId).slice(0, 40);
  if (b.updateTitle) fields[F.updateTitle] = String(b.updateTitle).slice(0, 200);
  if (b.missionary) fields[F.missionary] = String(b.missionary).slice(0, 120);
  try {
    await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: true })
    });
    return r(200, { ok: true });
  } catch (e) { return r(200, { ok: false }); }
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
