// Co·labr — import history from a Mailchimp ACCOUNT EXPORT, not an API key.
//
// Why this exists: an API key means finding Account → Extras → API keys, which is
// the step people give up on. "Download my data" is a button anyone can find. It
// also works when the API key route cannot — when someone has already left the
// Mailchimp account, or never had admin on it.
//
// The browser does the unzipping. A full export is well over a gigabyte, almost
// all of it media, but the part that matters is about 7 MB of campaign HTML — so
// migrate.html reads only those entries out of the archive and posts them here.
// The gigabyte never leaves their machine.
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const { htmlToBlocks } = require('./_htmlblocks');
const { blockWrite } = require('./_billing');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';
const SENT_FLAG = 'fldLIEGYuHv5G1iC2';   // "claimed sent" — blocks every send path

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const sess = sessionFromEvent(event);
  if (!sess) return r(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const blocked = await blockWrite(token, sess.email);
  if (blocked) return blocked;
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const items = Array.isArray(b.campaigns) ? b.campaigns.slice(0, 25) : [];
  if (!items.length) return r(400, { error: 'Nothing to import.' });

  let me = null;
  try { me = await missByEmail({ Authorization: 'Bearer ' + token }, sess.email); } catch (e) {}
  if (!me || !me.name) return r(403, { error: 'Your page isn\'t set up yet.' });
  const nameEsc = me.name.replace(/'/g, "\\'");

  const out = { created: 0, skipped: 0, failed: 0, titles: [] };
  for (const it of items) {
    try {
      const title = String(it.title || '').trim().slice(0, 200) || '(untitled)';
      const date = String(it.date || '').slice(0, 10);
      const html = String(it.html || '');
      if (!html) { out.failed++; continue; }

      // Two import routes key duplicates differently — the API knows a campaign by
      // its API id, the export names files by web id — so an id check alone would
      // let somebody who tried both end up with two of everything. Title AND date
      // on this page is the check that actually holds across both.
      const esc = title.replace(/'/g, "");
      const dupe = `AND({Title}='${esc}', {Date}='${date}', FIND('${nameEsc}', ARRAYJOIN({Missionary}))>0)`;
      const dr = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?maxRecords=1&filterByFormula=${encodeURIComponent(dupe)}`, { headers: auth });
      if (dr.ok && ((((await dr.json()).records) || []).length)) { out.skipped++; continue; }

      const { cover, blocks } = htmlToBlocks(html, { cover: '' });
      if (!blocks || !blocks.length) { out.failed++; continue; }
      const firstText = (blocks.find(x => x.type === 'text' && x.text) || {}).text || '';

      const fields = {
        'Title': title,
        'Status': 'Published',
        'Source': 'Mailchimp import',
        'Missionary': [me.name],
        'Date': date,
        'Blocks': JSON.stringify(blocks),
        'Excerpt': String(firstText).replace(/\s+/g, ' ').trim().slice(0, 240),
        'Opens': parseInt(it.opens, 10) || 0,
        [SENT_FLAG]: true          // imported history must never email anybody
      };
      if (it.key) fields['Mailchimp ID'] = String(it.key).slice(0, 60);
      if (cover) { fields['Cover Image URL'] = cover; fields['Cover Focus'] = '50% 35%'; }

      const wr = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'POST', headers: auth,
        body: JSON.stringify({ fields, typecast: true }) });
      if (wr.ok) { out.created++; out.titles.push(title); }
      else { out.failed++; console.log('import-zip create failed', title, (await wr.text()).slice(0, 160)); }
    } catch (e) { out.failed++; console.log('import-zip error', String(e && e.message || e)); }
  }
  return r(200, { ok: true, ...out });
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
