// Co-Labr — Care radar morning digest, on the Netlify scheduler (see netlify.toml).
// Netlify blocks direct HTTP calls to scheduled functions, so the admin "send it now"
// button lives in care-digest-now.js; both share _caredigest.js.
const { runDigest } = require('./_caredigest');

exports.handler = async function (event) {
  let scheduled = false, secretOk = false;
  try {
    const b = JSON.parse(event.body || '{}');
    scheduled = !!b.next_run;
    secretOk = !!b.secret && (b.secret === process.env.SESSION_SECRET || b.secret === process.env.IMPORT_SECRET);
  } catch {}
  if (!scheduled && !secretOk) return r(401, { error: 'Not allowed.' });
  try {
    const out = await runDigest();
    return r(200, { ok: out.sent > 0, ...out });
  } catch (e) {
    return r(502, { error: e.message || 'Digest failed.' });
  }
};
function r(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
