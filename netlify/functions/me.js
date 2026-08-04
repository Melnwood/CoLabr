// Returns the signed-in staff member, or 401 if not signed in.
const { sessionFromEvent, isAdmin } = require('./_auth');
exports.handler = async function (event) {
  const s = sessionFromEvent(event);
  if (!s) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in' }) };
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    email: s.email, name: s.name, pic: s.pic || '', admin: isAdmin(s.email),
    upload: { ready: !!(process.env.GCS_BUCKET && process.env.GCP_SA_KEY) }
  }) };
};
