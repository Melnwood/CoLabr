// Co·labr — serve one update's translation to someone allowed to read it.
//
// Translations hold the full text of an update, which means they hold prayer requests
// naming real people and their illnesses. The browser used to fetch them straight from
// a public bucket, so anyone with a URL could read them without signing in or holding
// a supporter key. This puts the same gate on them that the wall itself has.
//
// The wall is private, so its words should be too.
const { sessionFromEvent } = require('./_auth');
const { readObject } = require('./_gcs');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const SUBS = 'tbl21LyWOBxln6bOy';
const LANGS = ['en','cs','pl','uk','sk','ro','bg','sl','lv','et','hu','sr','de','es'];

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const id = String(q.u || '').trim();
  const lang = String(q.lang || '').trim().toLowerCase();
  const miss = String(q.m || '').trim();
  const tok = String(q.t || '').trim();

  if (!/^rec[a-zA-Z0-9]{14}$/.test(id)) return j(400, { error: 'Which update?' });
  if (!LANGS.includes(lang)) return j(400, { error: 'Unknown language.' });

  // Staff first, exactly as the wall does it, then a supporter's own key.
  let allowed = false;
  try { if (sessionFromEvent(event)) allowed = true; } catch (e) {}

  if (!allowed && tok && /^[a-f0-9]{16,64}$/i.test(tok) && miss) {
    try {
      const token = process.env.AIRTABLE_TOKEN;
      const f = encodeURIComponent(`AND({Token}='${tok}',{Missionary}='${miss.replace(/'/g, '')}',{Active}=1)`);
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${SUBS}?maxRecords=1&filterByFormula=${f}`,
        { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) allowed = !!(((await r.json()).records) || [])[0];
    } catch (e) {}
  }
  // Deliberately the same answer whether the key is wrong or the translation is
  // missing, so this cannot be used to find out which updates exist.
  if (!allowed) return j(404, { error: 'Not found.' });

  const got = await readObject(`translations/${id}/${lang}.json`);
  if (!got.ok) return j(404, { error: 'Not found.' });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      // Private to this reader, never to a shared cache. The whole point is that a
      // stranger cannot pick this up, and an edge cache is a stranger.
      'Cache-Control': 'private, max-age=300'
    },
    body: Buffer.from(got.body).toString('utf8')
  };
};
function j(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
