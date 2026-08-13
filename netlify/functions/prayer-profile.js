// Co·labr — the prayer profile. The answer to "do you have any prayer requests?"
// Standing requests the missionary keeps ready, in four categories, plus the
// recent ones already written into their updates (zero upkeep — they're pulled).
// GET (public, by page name): what a church sees at the shared link.
// POST (member): read/save my own.
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const PROFILE = 'tblLzzvsLeLeFOWGl';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const MISS = 'tbli1L8AO0JUDL7Wl';
const CATS = ['Mission & vision', 'Our work', 'Family', 'Personal & spiritual'];
const RECENT_DAYS = 120;

exports.handler = async function (event) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  try {
    // ---- Public: the shared link a church opens ----
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      const name = (q.m || '').trim();
      if (!name) return r(400, { error: 'Whose prayer requests?' });
      const nameEsc = name.replace(/'/g, "\\'");

      // Identity + photo, so the page looks like them.
      let page = { name, location: '', photo: '', org: '' };
      try {
        const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?maxRecords=1&filterByFormula=${encodeURIComponent(`{Name}='${nameEsc}'`)}`, { headers: auth });
        if (mr.ok) { const rec = (((await mr.json()).records) || [])[0];
          if (rec) { const f = rec.fields || {};
            page = { name: f['Name'] || name, location: f['Field Location'] || '', photo: f['Photo'] || '', org: f['National Org'] || '' }; } }
      } catch (e) {}

      const standing = await readProfile(auth, nameEsc);
      const recent = await readRecent(auth, nameEsc);
      return r(200, { ok: true, page, standing, recent, cats: CATS }, 300);
    }

    // ---- Member: read or save my own ----
    if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
    const sess = sessionFromEvent(event);
    if (!sess) return r(401, { error: 'Please sign in.' });
    let me = null;
    try { me = await missByEmail({ Authorization: 'Bearer ' + token }, sess.email); } catch (e) {}
    if (!me || !me.name) return r(403, { error: 'Your page isn\'t set up yet.' });
    const nameEsc = String(me.name).replace(/'/g, "\\'");
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }

    if (b.action === 'mine') {
      return r(200, { ok: true, me: me.name, standing: await readProfile(auth, nameEsc), recent: await readRecent(auth, nameEsc), cats: CATS });
    }

    if (b.action === 'save') {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 12)
        .map(x => ({ cat: CATS.includes(x.cat) ? x.cat : CATS[0], text: String(x.text || '').trim().slice(0, 600) }))
        .filter(x => x.text);
      // Replace wholesale — a short list is easier to keep true than a merge.
      const old = [];
      let url = `https://api.airtable.com/v0/${BASE}/${PROFILE}?pageSize=100&filterByFormula=${encodeURIComponent(`{Missionary}='${nameEsc}'`)}`;
      while (url) {
        const rr = await fetch(url, { headers: auth }); if (!rr.ok) break;
        const d = await rr.json(); (d.records || []).forEach(x => old.push(x.id));
        url = d.offset ? url.split('&offset=')[0] + '&offset=' + d.offset : '';
      }
      for (let i = 0; i < old.length; i += 10) {
        const batch = old.slice(i, i + 10).map(id => `records[]=${id}`).join('&');
        await fetch(`https://api.airtable.com/v0/${BASE}/${PROFILE}?${batch}`, { method: 'DELETE', headers: auth });
      }
      const now = new Date().toISOString();
      for (let i = 0; i < items.length; i += 10) {
        const recs = items.slice(i, i + 10).map((x, j) => ({ fields: {
          'Missionary': me.name, 'Category': x.cat, 'Text': x.text,
          'Order': i + j, 'Active': true, 'Updated': now
        }}));
        await fetch(`https://api.airtable.com/v0/${BASE}/${PROFILE}`, { method: 'POST', headers: auth,
          body: JSON.stringify({ records: recs, typecast: true }) });
      }
      return r(200, { ok: true, saved: items.length });
    }

    return r(400, { error: 'Unknown action.' });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};

async function readProfile(auth, nameEsc) {
  const out = [];
  let url = `https://api.airtable.com/v0/${BASE}/${PROFILE}?pageSize=100&filterByFormula=${encodeURIComponent(`AND({Missionary}='${nameEsc}',{Active}=1)`)}`;
  while (url) {
    const rr = await fetch(url, { headers: auth }); if (!rr.ok) break;
    const d = await rr.json();
    (d.records || []).forEach(rec => { const c = rec.fields || {};
      out.push({ cat: (c['Category'] && c['Category'].name) ? c['Category'].name : (c['Category'] || CATS[0]),
        text: c['Text'] || '', order: c['Order'] || 0 }); });
    url = d.offset ? url.split('&offset=')[0] + '&offset=' + d.offset : '';
  }
  out.sort((a, b) => (CATS.indexOf(a.cat) - CATS.indexOf(b.cat)) || (a.order - b.order));
  return out.filter(x => x.text);
}

// Recent requests come from the updates they already wrote — nothing to maintain.
async function readRecent(auth, nameEsc) {
  const cutoff = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString().slice(0, 10);
  const f = encodeURIComponent(`AND({Status}='Published', FIND('${nameEsc}', ARRAYJOIN({Missionary}))>0)`);
  const ur = await fetch(`https://api.airtable.com/v0/${BASE}/${UPDATES}?pageSize=50&filterByFormula=${f}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`, { headers: auth });
  if (!ur.ok) return [];
  const out = [];
  for (const rec of ((await ur.json()).records || [])) {
    const c = rec.fields || {};
    const date = c['Date'] || '';
    if (date && date < cutoff) break;
    if (/^__.*__$/.test(String(c['Title'] || '').trim())) continue;
    let blocks = []; try { blocks = JSON.parse(c['Blocks'] || '[]'); } catch (e) {}
    blocks.forEach(bk => {
      if (bk && bk.type === 'prayer' && String(bk.text || '').trim()) {
        out.push({ text: String(bk.text).trim().slice(0, 400), title: c['Title'] || '', date });
      }
    });
    if (out.length >= 6) break;
  }
  return out.slice(0, 6);
}
function r(statusCode, b, cacheSecs) {
  const headers = { 'Content-Type': 'application/json' };
  headers['Cache-Control'] = cacheSecs ? `public, max-age=${cacheSecs}` : 'no-store';
  return { statusCode, headers, body: JSON.stringify(b) };
}
