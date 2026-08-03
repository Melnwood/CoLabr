// Co-Labr — AI title suggestions, grounded in what actually earns opens for this ministry.
// Requires a signed-in staff session. Uses ANTHROPIC_API_KEY (set in Netlify).
const { sessionFromEvent } = require('./_auth');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

const SYSTEM = `You write email subject lines / titles for a Christian missionary's supporter update.
You have studied this ministry's real open-rate history. The clear pattern:
- Titles that are PERSONAL, HONEST, SPECIFIC, and often first-person get opened far more (2-8x).
- Titles that hint at a real moment, tension, question, or vulnerability draw people in.
- Institutional or generic "ministry report" titles (e.g. "Update from the field", "280 leaders trained", "Ministry news") get skipped.
Write titles that sound like a real person letting a friend into something true — warm, specific, never clickbait, never hype, no emoji.
Draw the specifics from the update text (names, places, numbers, the emotional core).
Return ONLY a JSON array of exactly 5 title strings, no other text. Keep each under ~70 characters.`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });
  if (!sessionFromEvent(event)) return resp(401, { error: 'Please sign in.' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return resp(500, { error: 'Missing ANTHROPIC_API_KEY.' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Bad request.' }); }
  const text = (b.body || '').trim();
  if (text.length < 20) return resp(400, { error: 'Write a bit of your update first, then I can suggest titles.' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Here is the update${b.type ? ' (type: ' + b.type + ')' : ''}:\n\n${text.slice(0, 6000)}` }]
      })
    });
    const data = await r.json();
    if (!r.ok) return resp(r.status, { error: (data.error && data.error.message) || 'AI request failed.' });
    const out = (data.content && data.content[0] && data.content[0].text) || '';
    let titles = [];
    try { titles = JSON.parse(out); }
    catch { const m = out.match(/\[[\s\S]*\]/); if (m) { try { titles = JSON.parse(m[0]); } catch {} } }
    titles = (Array.isArray(titles) ? titles : []).filter(t => typeof t === 'string' && t.trim()).slice(0, 5);
    if (!titles.length) return resp(502, { error: 'Could not read a suggestion. Try again.' });
    return resp(200, { titles });
  } catch (e) {
    return resp(502, { error: 'Could not reach the AI service.' });
  }
};

function resp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
