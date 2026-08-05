// Returns the signed-in staff member, or 401 if not signed in.
// ?full=1 also looks up their missionary/page record (name, sign-off) for the composer.
const { sessionFromEvent, isAdmin } = require('./_auth');
const { missByEmail } = require('./_shares');
exports.handler = async function (event) {
  const s = sessionFromEvent(event);
  if (!s) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in' }) };
  const out = {
    email: s.email, name: s.name, pic: s.pic || '', admin: isAdmin(s.email),
    upload: { ready: !!(process.env.GCS_BUCKET && process.env.GCP_SA_KEY) }
  };
  const full = event.queryStringParameters && event.queryStringParameters.full === '1';
  if (full && process.env.AIRTABLE_TOKEN) {
    try {
      const m = await missByEmail({ Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN }, s.email);
      if (m) out.miss = { name: m.name, signoff: m.signoff || '' };
    } catch (_) {}
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) };
};
