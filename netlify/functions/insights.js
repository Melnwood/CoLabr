// Co·labr — AI insights on the update history. Signed-in staff only. Uses ANTHROPIC_API_KEY.
const { sessionFromEvent } = require('./_auth');
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

const SYSTEM = `You are a sharp, encouraging analyst helping a Christian missionary understand their supporter-update history so they can make better decisions and connect with supporters.
You are given a JSON list of their updates: title, year (y), opens (o), type, status.
Produce 3 to 5 SHORT, specific, actionable insights. Rules:
- Each insight is ONE sentence, max ~24 words.
- Ground every insight in the actual data — cite real numbers, years, or titles.
- Cover a mix of: which topics/titles/themes earn the most opens (and why), posting cadence or any recent gap, timing patterns, and ONE concrete suggestion for their next update.
- Warm and practical. Never generic filler. No preamble.
Return ONLY a JSON array of insight strings, nothing else.`;

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
