// Co·labr — the supporter's own landing: every missionary they follow, every
// conversation, every prayer — one home. No account needed: any of their wall
// keys (?t=) or a conversation link (?c=<responseId>&k=<thread key>) proves who
// they are; everything else is looked up by their email.
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const RTABLE = 'tblVNMG5VnOnFFeto';   // Responses
const STABLE = 'tbl21LyWOBxln6bOy';   // Subscribers
const MISS = 'tbli1L8AO0JUDL7Wl';
const M_NAME = 'fldPYSQwxoQJGb0Zd', M_PHOTO = 'fldiXSCuELTQiiT08', M_LOC = 'fld0mx3Sp4JnNnIfc';

exports.handler = async function (event) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token };
  const q = event.queryStringParameters || {};

  try {
    // Who is this? A wall key, or a conversation link.
    let email = '', name = '';
    const vt = (q.t || '').trim();
    if (vt && /^[a-f0-9]{16,64}$/i.test(vt)) {
      const tf = encodeURIComponent(`AND({Token}='${vt}',{Active}=1)`);
      const tr = await fetch(`https://api.airtable.com/v0/${BASE}/${STABLE}?maxRecords=1&filterByFormula=${tf}`, { headers: auth });
      if (tr.ok) { const rec = (((await tr.json()).records) || [])[0]; if (rec) { email = (rec.fields['Email'] || '').toLowerCase(); name = rec.fields['Name'] || ''; } }
    }
    if (!email && /^rec[a-zA-Z0-9]{14}$/.test(q.c || '') && (q.k || '').trim()) {
      const gr = await fetch(`https://api.airtable.com/v0/${BASE}/${RTABLE}/${q.c}`, { headers: auth });
      if (gr.ok) {
        const c = ((await gr.json()).fields) || {};
        if (c['Thread Key'] && c['Thread Key'] === q.k.trim()) { email = (c['Email'] || '').toLowerCase(); name = c['Name'] || ''; }
      }
    }
    if (!email) return r(403, { error: 'This link is not valid.' });
    const ee = email.replace(/'/g, "\\'");

    // Every page they follow — each with ITS OWN key, so wall links keep working.
    const subs = [];
    let surl = `https://api.airtable.com/v0/${BASE}/${STABLE}?pageSize=100&filterByFormula=${encodeURIComponent(`AND(LOWER({Email})='${ee}',{Active}=1)`)}`;
    while (surl) {
      const sr = await fetch(surl, { headers: auth }); if (!sr.ok) break;
      const sd = await sr.json();
      (sd.records || []).forEach(rec => {
        const c = rec.fields || {};
        if (c['Missionary']) subs.push({ missionary: c['Missionary'], token: c['Token'] || '', since: rec.createdTime || '' });
        if (!name && c['Name']) name = c['Name'];
      });
      surl = sd.offset ? surl.split('&offset=')[0] + '&offset=' + sd.offset : '';
    }

    // Everything they've ever written — prayers, notes, and the reply threads.
    const convos = [];
    let curl = `https://api.airtable.com/v0/${BASE}/${RTABLE}?pageSize=100&filterByFormula=${encodeURIComponent(`LOWER({Email})='${ee}'`)}`;
    while (curl) {
      const cr = await fetch(curl, { headers: auth }); if (!cr.ok) break;
      const cd = await cr.json();
      (cd.records || []).forEach(rec => {
        const c = rec.fields || {};
        let thread = []; try { thread = JSON.parse(c['Thread'] || '[]'); } catch (e) {}
        if (!Array.isArray(thread)) thread = [];
        if (!thread.length && c['Reply']) thread = [{ f: 'm', t: c['Reply'], at: '' }];
        convos.push({
          id: rec.id, k: c['Thread Key'] || '', type: c['Type'] || 'Note',
          missionary: c['Missionary'] || '', message: c['Message'] || '',
          updateTitle: c['Update Title'] || '', thread, created: rec.createdTime || ''
        });
      });
      curl = cd.offset ? curl.split('&offset=')[0] + '&offset=' + cd.offset : '';
    }

    // Faces + places for the pages they follow.
    const pages = {};
    try {
      const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?pageSize=100&returnFieldsByFieldId=true`, { headers: auth });
      if (mr.ok) ((await mr.json()).records || []).forEach(m => { const f = m.fields || {}; if (f[M_NAME]) pages[f[M_NAME]] = { photo: f[M_PHOTO] || '', location: f[M_LOC] || '' }; });
    } catch (e) {}

    return r(200, { ok: true, name, email, subs, convos, pages });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
