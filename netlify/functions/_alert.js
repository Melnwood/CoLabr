// Co·labr — somebody has to be told when things break.
//
// Until now every failure was written to a console nobody reads, so faults were found
// by Mel noticing something odd. That does not survive a second customer.
//
// Deliberately NOT a monitoring vendor. Errors go to the Events table we already have,
// and a daily digest mails whatever turned up. A new provider would mean another
// sub-processor to disclose in every customer contract, which is a real cost for a
// product whose whole legal position is "we keep the surface small".
//
// Never throws. An alerting system that can break the thing it watches is worse than none.
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const EVENTS = 'tbl2Dm5W07cAMrJgs';

function fingerprint(s) {
  // Cheap stable hash, so the same fault an hour apart is recognisably the same fault.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 8);
}

async function report(where, err, meta) {
  try {
    const token = process.env.AIRTABLE_TOKEN;
    if (!token) return;
    const msg = String((err && err.message) || err || 'unknown').replace(/\s+/g, ' ').slice(0, 160);
    const extra = meta ? ' ' + String(meta).replace(/\s+/g, ' ').slice(0, 80) : '';
    const fp = fingerprint(where + msg);
    const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

    // One row per fault per hour. A function failing on every call would otherwise
    // write thousands of rows and bury the one-off that actually matters.
    const seen = encodeURIComponent(
      `AND({Kind}='Error',FIND('[${fp}]',{Update ID})>0,DATETIME_DIFF(NOW(),CREATED_TIME(),'minutes')<60)`
    );
    const q = await fetch(`https://api.airtable.com/v0/${BASE}/${EVENTS}?filterByFormula=${seen}&pageSize=1`, { headers: auth });
    if (q.ok && (((await q.json()).records) || []).length) return;

    await fetch(`https://api.airtable.com/v0/${BASE}/${EVENTS}`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ fields: { 'Kind': 'Error', 'Update ID': `[${fp}] ${where}: ${msg}${extra}` } })
    });
  } catch (e) { /* the watcher never takes down the watched */ }
}

module.exports = { report };
