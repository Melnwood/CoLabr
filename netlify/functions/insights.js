// Co·labr — AI insights on the update history. Signed-in staff only. Uses ANTHROPIC_API_KEY.
const { sessionFromEvent } = require('./_auth');
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

const SYSTEM = `You are a friend who has read every one of this missionary's supporter updates, going back years, and who cares about them and about the people who follow their work.
You are given a JSON list of their updates: title, year (y), opens (o), type, status.

WHAT AN OPEN ACTUALLY IS. Someone stopped and read. It is not a score and never a target. It matters for one reason: when supporters read, they know what they are part of, and they can pray and give with understanding. Say it that way.

Produce 3 to 5 short observations. Rules:
- One sentence each, about 24 words or less.
- Ground each one in the real data: name actual titles, years, and numbers.
- Warm, plain and specific. Talk to them, not about them.
- Between them, cover: which of their stories people stayed with, any long gap in writing, and ONE gentle, concrete idea for their next update.

NEVER use this vocabulary: engagement, drive opens, hooks, testing, optimize, performance, outperform, audience, content, cadence, funnel, metrics, conversion. If a sentence reads like marketing advice, rewrite it as a human observation.

HARD NEWS IS NOT A TACTIC. Their updates include real illness, loss and family crisis. Never point out that those updates were widely read as though it were a lesson to repeat, and never suggest writing about pain in order to be read more. If a hard update mattered to people, say that people showed up for them, and leave it there.

NEVER SCOLD. A quiet year is a season, not a failure. Mention a long gap kindly and without attaching a number to their guilt.

Do not use em dashes or en dashes anywhere. Use commas, full stops, or the word "and".

Return ONLY a JSON array of observation strings, nothing else.`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  if (!sessionFromEvent(event)) return r(401, { error: 'Please sign in.' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return r(500, { error: 'AI is not set up (missing ANTHROPIC_API_KEY).' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 120) : [];
  if (rows.length < 2) return r(400, { error: 'Not enough updates yet for insights.' });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 500, system: SYSTEM,
        messages: [{ role: 'user', content: 'Here are the updates:\n' + JSON.stringify(rows) }]
      })
    });
    const data = await resp.json();
    if (!resp.ok) return r(resp.status, { error: (data.error && data.error.message) || 'AI request failed.' });
    const out = (data.content && data.content[0] && data.content[0].text) || '';
    let insights = [];
    try { insights = JSON.parse(out); } catch { const m = out.match(/\[[\s\S]*\]/); if (m) { try { insights = JSON.parse(m[0]); } catch {} } }
    insights = (Array.isArray(insights) ? insights : []).filter(s => typeof s === 'string' && s.trim()).slice(0, 5);
    if (!insights.length) return r(502, { error: 'Could not read insights. Try again.' });
    return r(200, { insights });
  } catch (e) {
    return r(502, { error: 'Could not reach the AI service.' });
  }
};

function r(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
