// Co·labr — "in my voice" ghostwriter (super-admin Test Lab). The writer says roughly
// what they want to tell their supporters; this reads their own published updates as
// voice samples and drafts a new update that sounds like THEM. Nothing is published —
// the draft lands in the composer for their edit. An experiment in lowering the cost
// of writing so updates happen more often.
const { sessionFromEvent, isAdmin } = require('./_auth');
const { missByEmail } = require('./_shares');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  const s = sessionFromEvent(event);
  if (!s) return r(401, { error: 'Please sign in.' });
  if (!isAdmin(s.email)) return r(403, { error: 'Super admins only — this is a Test Lab experiment.' });
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const notes = (b.notes || '').toString().trim();
  if (notes.length < 10) return r(400, { error: 'Tell me a bit more — even rough bullets are enough.' });
  const token = process.env.AIRTABLE_TOKEN, key = process.env.ANTHROPIC_API_KEY;
  if (!token || !key) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token };

  // The writer's own published updates are the voice samples.
  let name = 'The Ellenwood Family', signoff = '';
  try { const m = await missByEmail(auth, s.email); if (m) { name = m.name || name; signoff = m.signoff || ''; } } catch (_) {}
  const f = encodeURIComponent(`AND({Status}='Published', FIND('${name.replace(/'/g, "")}', ARRAYJOIN({Missionary}))>0)`);
  const ur = await fetch(`https://api.airtable.com/v0/${BASE}/${UPDATES}?pageSize=30&filterByFormula=${f}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc&fields%5B%5D=Title&fields%5B%5D=Body&fields%5B%5D=Date`, { headers: auth });
  if (!ur.ok) return r(502, { error: 'Could not read your past updates.' });
  const samples = [];
  for (const rec of ((await ur.json()).records || [])) {
    const body = (rec.fields || {})['Body'] || '';
    if (body.length < 400) continue;
    samples.push({ title: (rec.fields || {})['Title'] || '', body: body.slice(0, 2800) });
    if (samples.length >= 6) break;
  }
  if (!samples.length) return r(400, { error: 'No published updates to learn your voice from yet.' });

  const sampleText = samples.map((x, i) => `--- Sample ${i + 1}: "${x.title}" ---\n${x.body}`).join('\n\n');
  const prompt = `You are ghostwriting a missionary supporter update for the author of the writing samples below. Study HOW they write — their rhythm, warmth, humor, how they open and close, how they weave Scripture and gratitude, their sentence length, their favorite turns of phrase. Then take their rough notes and write the update THEY would have written, in their voice, first person.

Rules:
- Use ONLY the facts in the notes — never invent events, names, numbers, or Scripture they didn't point to. If the notes are thin, write shorter rather than padding.
- Match their voice so well they'd barely edit it. Do not imitate any single sample's content — only the voice.
- 4–9 paragraphs, each 1–4 sentences, ready for a supporter update wall.
- Do NOT include a sign-off line (the composer adds "${signoff || 'their sign-off'}" automatically) and do not include a greeting like "Dear friends" unless the samples always do.
- Also write a title in their style: warm, specific, openable.

WRITING SAMPLES:
${sampleText}

THEIR ROUGH NOTES FOR THIS UPDATE:
"""
${notes.slice(0, 4000)}
"""

Return ONLY a JSON object: {"title": "...", "paragraphs": ["...", "..."]} — no commentary.`;

  const models = [process.env.ANTHROPIC_TRANSLATE_MODEL || 'claude-sonnet-4-5', 'claude-haiku-4-5'];
  for (const model of models) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 2500, messages: [{ role: 'user', content: prompt }] })
      });
      const jd = await res.json();
      if (jd.error) continue;
      const txt = (((jd.content || [])[0]) || {}).text || '';
      const m = txt.match(/\{[\s\S]*\}/); if (!m) continue;
      const out = JSON.parse(m[0]);
      if (out && out.title && Array.isArray(out.paragraphs) && out.paragraphs.length) {
        return r(200, { title: String(out.title), paragraphs: out.paragraphs.map(String), samples: samples.length });
      }
    } catch (e) {}
  }
  return r(502, { error: 'The ghostwriter stumbled — try once more.' });
};
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
