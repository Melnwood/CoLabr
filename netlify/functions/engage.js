// Co·labr — public engagement for the supporter page.
// Returns the prayer count for one update (or all updates). Messages are never
// returned here — nothing a supporter writes is shown to other supporters.
// Private notes are NEVER returned here. Uses AIRTABLE_TOKEN (read).
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tblVNMG5VnOnFFeto';
const F = {
  name: 'fld0i05my8OeyflZH', type: 'fldigSBFHPa27Hh3s', message: 'fld5GlgEzO1WbORGu',
  public: 'fld6Aax3AjDcDDJLx', updateId: 'fldkg6say56a4pYQD'
};

exports.handler = async function (event) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return j(500, { error: 'Server not configured.' });
  const q = event.queryStringParameters || {};
  const updateId = q.updateId || '';

  let formula = "{Type}='Prayer'";
  if (updateId) formula = `AND({Update ID}='${updateId.replace(/'/g, '')}',${formula})`;
  const url = `https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100&returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent(formula)}`;

  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return j(r.status, { error: 'Could not load engagement.' });
    const data = await r.json();
    const byUpdate = {};
    (data.records || []).forEach(rec => {
      const c = rec.fields || {};
      const uid = c[F.updateId] || '_';
      byUpdate[uid] = byUpdate[uid] || { prayers: 0, encouragements: [] };
      if (c[F.type] === 'Prayer') byUpdate[uid].prayers++;
      // The empty `encouragements` array stays for callers that still read the shape;
      // it is never filled, because no supporter message is shown to other supporters.
    });
    if (updateId) return j(200, byUpdate[updateId] || { prayers: 0, encouragements: [] }, 'no-store');
    return j(200, byUpdate, 'no-store');
  } catch (e) {
    return j(502, { error: 'Could not reach the server.' });
  }
};
function j(statusCode, body, cache) {
  const headers = { 'Content-Type': 'application/json' };
  if (cache) headers['Cache-Control'] = cache;
  return { statusCode, headers, body: JSON.stringify(body) };
}
