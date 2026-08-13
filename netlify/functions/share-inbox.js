// Co·labr — the signed-in member's share requests: incoming (teammates who want to feature
// MY updates, awaiting my yes) and outgoing (my requests awaiting a teammate's yes).
const { sessionFromEvent } = require('./_auth');
const { BASE, esc, missByEmail } = require('./_shares');
const SHARES = 'tblKLXrYICtkiSp40';

exports.handler = async function (event) {
  const session = sessionFromEvent(event);
  if (!session) return resp(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(200, { incoming: [], outgoing: [] });
  const auth = { Authorization: 'Bearer ' + token };
  try {
    const me = await missByEmail(auth, session.email);
    const myName = me ? me.name : (session.name || '');
    const incoming = await query(auth, `AND({Status}='Pending',{Author}='${esc(myName)}')`);
    const outgoing = await query(auth, `AND({Status}='Pending',LOWER({Requester Email})='${esc((session.email || '').toLowerCase())}')`);
    return resp(200, { incoming, outgoing });
  } catch (e) {
    return resp(200, { incoming: [], outgoing: [] });
  }
};

async function query(auth, formula) {
  const url = `https://api.airtable.com/v0/${BASE}/${SHARES}?pageSize=50&filterByFormula=${encodeURIComponent(formula)}`;
  const r = await fetch(url, { headers: auth }); if (!r.ok) return [];
  const d = await r.json();
  return (d.records || []).map(rec => {
    const f = rec.fields || {};
    return { id: rec.id, title: f['Update Title'] || '', requesterName: f['Requester Name'] || '', requesterPage: f['Requester Page'] || '', author: f['Author'] || '', country: f['Country'] || '', cover: f['Cover URL'] || '' };
  });
}
function resp(s, b) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
