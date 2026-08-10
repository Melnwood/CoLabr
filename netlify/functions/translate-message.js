// Co·labr — translate one supporter message on demand. Supporters write in their
// heart language (Czech, Polish, Serbian…); the missionary taps Translate and
// reads it in English. Session-gated: members only, never public.
const { sessionFromEvent } = require('./_auth');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  // Members only — the internal secret is accepted so ops can test the pipe directly.
  const secretOk = b.secret && (b.secret === process.env.IMPORT_SECRET || b.secret === process.env.SESSION_SECRET);
  if (!sessionFromEvent(event) && !secretOk) return r(401, { error: 'Please sign in.' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return r(500, { error: 'Translation is not set up.' });

  const text = (b.text || '').toString().trim().slice(0, 3000);
  if (!text) return r(400, { error: 'Nothing to translate.' });

  const models = [process.env.ANTHROPIC_TRANSLATE_MODEL || 'claude-sonnet-4-5', 'claude-haiku-4-5'];
  let lastErr = '';
  for (const model of models) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: 1200,
          system: 'Translate the user\'s message into warm, natural English. Keep the tone and affection of the original — this is a personal note between a supporter and a missionary. If it is already English, return it unchanged. Return ONLY the translation, no commentary.',
          messages: [{ role: 'user', content: text }]
        })
      });
      if (!res.ok) { lastErr = model + ':' + res.status + ':' + (await res.text()).slice(0, 200); console.log('translate-message fail', lastErr); continue; }
      const d = await res.json();
      const out = (d.content && d.content[0] && d.content[0].text || '').trim();
      if (out) return r(200, { ok: true, text: out });
      lastErr = model + ':empty';
    } catch (e) { lastErr = model + ':' + String(e && e.message || e).slice(0, 120); console.log('translate-message error', lastErr); }
  }
  return r(502, { error: 'Could not translate right now.', detail: lastErr });
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
