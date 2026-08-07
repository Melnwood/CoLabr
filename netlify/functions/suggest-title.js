// Co-Labr — AI title suggestions, grounded in the writer's OWN past titles (their register:
// declarations of faith, lived questions, Scripture images) plus what earns opens.
// Requires a signed-in staff session. Uses ANTHROPIC_API_KEY (set in Netlify).
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';

const SYSTEM = `You title a Christian missionary's supporter update. You will be shown the writer's own past titles — that register is the target. Notice what they actually do: often a declaration of faith ("I will tell of all His wonders…"), a question they are living inside ("Am I drifting?", "To water or plant?"), or a single resonant image or word ("Homecomings"). Their titles carry the spiritual center of the update, not a summary of its events.

Write titles that:
- sound unmistakably like THIS writer — same length habits, same cadence, same depth;
- carry the update's spiritual heartbeat: the thing God is doing in it, the tension being lived, the verse or image underneath — not the logistics;
- are personal and purposeful — a real person letting a friend into something true;
- NEVER sound like marketing, a newsletter header, or a report ("Spring Update", "God at work in Poland", "Exciting news from the field" are all failures);
- no emoji, no colons-with-taglines, no hype.

Mix the forms across the five: at least one question, at least one declaration, at least one short image/phrase. Each under ~70 characters.
Return ONLY a JSON array of exactly 5 title strings, no other text.`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });
  const s = sessionFromEvent(event);
  if (!s) return resp(401, { error: 'Please sign in.' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return resp(500, { error: 'Missing ANTHROPIC_API_KEY.' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Bad request.' }); }
  const text = (b.body || '').trim();
  if (text.length < 20) return resp(400, { error: 'Write a bit of your update first, then I can suggest titles.' });

  // The writer's own published titles are the style guide.
  let pastTitles = [];
  try {
    const token = process.env.AIRTABLE_TOKEN;
    if (token) {
      const auth = { Authorization: 'Bearer ' + token };
      let name = 'The Ellenwood Family';
      try { const m = await missByEmail(auth, s.email); if (m && m.name) name = m.name; } catch (_) {}
      const f = encodeURIComponent(`AND({Status}='Published', FIND('${name.replace(/'/g, "")}', ARRAYJOIN({Missionary}))>0)`);
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${UPDATES}?pageSize=40&filterByFormula=${f}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc&fields%5B%5D=Title`, { headers: auth });
      if (r.ok) {
        pastTitles = (((await r.json()).records) || [])
          .map(rec => (rec.fields || {})['Title'] || '')
          .filter(t => t && !/^__.*__$/.test(t) && !/video test|caption test/i.test(t))
          .slice(0, 25);
      }
    }
  } catch (_) {}

  const titlesBlock = pastTitles.length
    ? `The writer's own past titles (match this register):\n${pastTitles.map(t => '- ' + t).join('\n')}\n\n`
    : '';

  const models = [process.env.ANTHROPIC_TRANSLATE_MODEL || 'claude-sonnet-4-5', 'claude-haiku-4-5'];
  for (const model of models) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 400,
          system: SYSTEM,
          messages: [{ role: 'user', content: `${titlesBlock}Here is the update${b.type ? ' (type: ' + b.type + ')' : ''}:\n\n${text.slice(0, 6000)}` }]
        })
      });
      const data = await r.json();
      if (!r.ok || data.error) continue;
      const out = (data.content && data.content[0] && data.content[0].text) || '';
      let titles = [];
      try { titles = JSON.parse(out); }
      catch { const m = out.match(/\[[\s\S]*\]/); if (m) { try { titles = JSON.parse(m[0]); } catch {} } }
      titles = (Array.isArray(titles) ? titles : []).filter(t => typeof t === 'string' && t.trim()).slice(0, 5);
      if (titles.length) return resp(200, { titles });
    } catch (e) {}
  }
  return resp(502, { error: 'Could not read a suggestion. Try again.' });
};

function resp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
