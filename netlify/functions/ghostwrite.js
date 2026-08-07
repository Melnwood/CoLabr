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

  // Direction chips from the Test Lab — the writer steering the pen.
  const STEER = {
    warmer: 'Warmer — lean into affection for the reader; write like a letter to dear friends.',
    concise: 'More concise — tighter and shorter; keep only what carries weight (this overrides the 3–5× length goal).',
    longer: 'Longer — give each story more room to breathe; slow down and let moments land.',
    spiritual: 'More spiritual — draw out more of the God-thread: what He is teaching them, where they see His hand.',
    scripture: 'More Scripture — reach for a passage or two the author would naturally connect to these events (well-known verses that truly fit; never invent references).',
    joyful: 'Happier — let the joy and celebration rise to the top; gratitude out loud.',
    story: 'More storytelling — open scenes with a moment ("It was almost 3am…") the way the author does at their best; stay within the facts given.',
  };
  const steering = (Array.isArray(b.styles) ? b.styles : []).map(k => STEER[k]).filter(Boolean);
  const steerText = steering.length ? `\nTHEIR DIRECTION FOR THIS DRAFT (obey these over defaults):\n- ${steering.join('\n- ')}\n` : '';
  const sampleText = samples.map((x, i) => `--- Sample ${i + 1}: "${x.title}" ---\n${x.body}`).join('\n\n');
  const prompt = `You are ghostwriting a missionary supporter update for the author of the writing samples below. Study HOW they write — their rhythm, warmth, humor, how they open and close, how they weave Scripture, gratitude, and reflection, their sentence length, their favorite turns of phrase, how they invite prayer.

Their rough notes are a SEED, not a ceiling. Your job is the part they find costly: turning bullet points into the full update they would have written. Never restate a note verbatim — tell it the way THEY would tell it, with the framing, feeling, and meaning they always wrap around bare facts.

Two different materials — treat them differently:
1. FACTS are theirs alone. Every event, name, number, place, and quotation must come from the notes — never invent or embellish these. A note that says "4 students followed Jesus" cannot become five, and cannot gain details they didn't give.
2. TEXTURE is your job, learned from the samples. Compose the things they always add around their facts: a warm opening that draws the reader in, the spiritual reflection they'd draw from these events (in the way THEY reflect — study what they return to: gratitude, God's faithfulness, Scripture they'd naturally reach for), the thread connecting the stories, thanks to their supporters, an invitation to pray about the things the notes name, and a closing with forward motion. This is elaboration in their voice, not fabrication of events.

The finished update should read 3–5× longer than the notes and feel unmistakably like the samples. If they'd barely need to edit it, you succeeded; if it reads like their notes with connective words, you failed.

Also:
- 5–10 paragraphs, each 1–4 sentences, ready for a supporter update wall.
- Do NOT include a sign-off line (the composer adds "${signoff || 'their sign-off'}" automatically).
- Write a title in their style: warm, specific, openable.
- If the notes include instructions about tone or length ("keep it short", "more reflective"), obey them.
${steerText}
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
