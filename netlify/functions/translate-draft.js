// Co·labr — translate a DRAFT update on demand, so the writer can read (and reword)
// their own English before anybody else does. Synchronous and session-gated: this is
// the composer asking, not a background job. Nothing is stored here — the composer
// keeps whatever the writer approves inside the update's own blocks.
//
// Deliberately NOT the same thing as translate-update-background: that one publishes
// every language to GCS after an update goes out. This one is a preview the writer owns.
const crypto = require('crypto');
const { sessionFromEvent } = require('./_auth');

const LNAME = { en:'English', cs:'Czech', pl:'Polish', uk:'Ukrainian', sk:'Slovak', ro:'Romanian',
                bg:'Bulgarian', sl:'Slovenian', lv:'Latvian', et:'Estonian', hu:'Hungarian',
                sr:'Serbian (Latin script)', de:'German', es:'Spanish' };
const MAX_STRINGS = 120;
const MAX_CHARS = 24000;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const secretOk = b.secret && (b.secret === process.env.IMPORT_SECRET || b.secret === process.env.SESSION_SECRET);
  if (!sessionFromEvent(event) && !secretOk) return r(401, { error: 'Please sign in.' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return r(500, { error: 'Translation is not set up yet.' });

  const lang = String(b.lang || 'en').slice(0, 5);
  if (!LNAME[lang]) return r(400, { error: 'Unknown language.' });

  let strings = Array.isArray(b.strings) ? b.strings.map(s => String(s == null ? '' : s)) : null;
  if (!strings || !strings.length) return r(400, { error: 'Nothing to translate.' });
  if (strings.length > MAX_STRINGS) return r(400, { error: 'That update is too long to translate in one go.' });
  if (strings.join('').length > MAX_CHARS) return r(400, { error: 'That update is too long to translate in one go.' });
  if (!strings.join('').trim()) return r(400, { error: 'Nothing to translate.' });

  // Blank lines must survive the round trip in position, or every index after one
  // shifts and the writer's English lands on the wrong block.
  const idx = [], send = [];
  strings.forEach((s, i) => { if (s.trim()) { idx.push(i); send.push(s); } });

  let out;
  try { out = await translateAll(key, send, lang); }
  catch (e) { return r(502, { error: 'Could not translate right now. Try again in a moment.' }); }
  if (!out || out.length !== send.length) return r(502, { error: 'Could not translate right now. Try again in a moment.' });

  const full = strings.map(() => '');
  idx.forEach((at, k) => { full[at] = out[k]; });

  // The hash travels with each line so the composer can tell, later, whether the
  // source moved underneath an English line the writer had already made their own.
  return r(200, { ok: true, lang, out: full, hashes: strings.map(hashOf) });
};

function hashOf(s) {
  return crypto.createHash('sha1').update(String(s == null ? '' : s)).digest('hex').slice(0, 12);
}

// Same numbered-line contract as translate-update-background, on purpose: one update
// must not read differently depending on which door translated it.
async function translateAll(key, strings, lang) {
  const numbered = strings.map((t, i) => `${i}⟶ ${t.replace(/\n/g, ' ⏎ ')}`).join('\n');
  const prompt = `Translate each numbered line into ${LNAME[lang] || lang}. These are pieces of a missionary's support update — keep names, places, and Scripture references accurate, and keep the warm, personal tone. Preserve the ⏎ markers exactly (they are line breaks). Return ONLY a JSON array of strings, one per numbered line, in the same order, with the same count (${strings.length}). Do not include the numbers.\n\n${numbered}`;
  const txt = await claude(key, prompt, 8000);
  const m = txt.match(/\[[\s\S]*\]/); if (!m) return null;
  let arr; try { arr = JSON.parse(m[0]); } catch { return null; }
  return Array.isArray(arr) ? arr.map(s => String(s).replace(/ ⏎ /g, '\n').replace(/⏎/g, '\n')) : null;
}

// Someone is waiting on this one, so the backoff is short and shallow — better to
// say "try again in a moment" than to hold a spinner past a function timeout.
async function claude(key, prompt, maxTokens) {
  const models = [process.env.ANTHROPIC_TRANSLATE_MODEL || 'claude-sonnet-4-5', 'claude-haiku-4-5'];
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
      });
      const jd = await res.json().catch(() => ({}));
      if (res.status === 429 || (jd.error && /rate|overloaded/i.test(jd.error.type || jd.error.message || ''))) {
        await new Promise(z => setTimeout(z, 1200 * (attempt + 1)));
        continue;
      }
      const txt = (((jd.content || [])[0]) || {}).text || '';
      if (txt) return txt;
      break;
    }
  }
  return '';
}

function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
