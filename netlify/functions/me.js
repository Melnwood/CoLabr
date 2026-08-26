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
      if (m) out.miss = { name: m.name, signoff: m.signoff || '', live: !!m.live, org: m.org || '', country: m.country || '', give: m.give || '', photo: m.photo || '', native: !!m.native };
      // The header mark belongs to whoever this person actually serves with, so the
      // dashboard of a KAM worker wears KAM and opens KAM. Failing softly here is
      // deliberate: a missing org record leaves the page on its Josiah Venture
      // default rather than taking the page down with it.
      if (out.miss && out.miss.org) {
        try {
          const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
          const auth = { Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN };
          const oe = String(out.miss.org).replace(/'/g, "\\'");
          const url = `https://api.airtable.com/v0/${BASE}/tbl152sVfqGyrqpJQ?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent(`OR({Code}='${oe}',{Name}='${oe}')`)}`;
          const orr = await fetch(url, { headers: auth });
          if (orr.ok) {
            const orec = (((await orr.json()).records) || [])[0];
            if (orec) {
              const f = orec.fields || {};
              out.miss.orgLogo = f['fldBJzji3j5ML7DHd'] || '';
              out.miss.orgSite = f['fldW4oLN6GBcCSNCw'] || '';
              out.miss.orgName = f['fldsyU3dpzLdkXI7t'] || out.miss.org;
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) };
};
