// Co·labr — draft the standing prayer requests from what the missionary has
// ALREADY written. They've said these things in their updates; nobody should have
// to start at four empty boxes. The result is a draft they edit and own.
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
const CATS = ['Mission & vision', 'Our work', 'Family', 'Personal & spiritual'];
const LOOKBACK_DAYS = 240;

const SYSTEM = `You help a missionary answer the question a church asks: "how can we pray for you?"

You are given excerpts from that missionary's own recent support updates.
Draft standing prayer requests IN THEIR VOICE, using their own words and specifics
wherever possible (real names, places, ministries, ages of children — never invent any).

Four categories:
- "Mission & vision" — the big why: the movement, the calling, what they long to see God do
- "Our work" — the actual ministry: camps, students, teams, training, the year's projects
- "Family" — marriage, children, home, transitions
- "Personal & spiritual" — their own walk with God, health, rest, discouragement, growth

Rules:
- 1–2 requests per category. Fewer is better than padded.
- Each is ONE sentence a stranger could pray without any other context — name the
  who and the what ("Pray for Marek and the Ostrava team as they…"), never a bare
  "pray for this group".
- Present tense, warm, plain. No preamble, no headings inside the text.
- If the updates say nothing about a category, return nothing for it. Do not invent.

Return ONLY JSON: [{"cat":"Family","text":"..."}] — no other words.`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const sess = sessionFromEvent(event);
  if (!sess) return r(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN, key = process.env.ANTHROPIC_API_KEY;
  if (!token) return r(500, { error: 'Server not configured.' });
  if (!key) return r(500, { error: 'AI is not set up yet.' });
  const auth = { Authorization: 'Bearer ' + token };

  let me = null;
  try { me = await missByEmail(auth, sess.email); } catch (e) {}
  if (!me || !me.name) return r(403, { error: 'Your page isn\'t set up yet.' });
  const nameEsc = String(me.name).replace(/'/g, "\\'");

  try {
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
    const f = encodeURIComponent(`AND({Status}='Published', FIND('${nameEsc}', ARRAYJOIN({Missionary}))>0)`);
    const ur = await fetch(`https://api.airtable.com/v0/${BASE}/${UPDATES}?pageSize=50&filterByFormula=${f}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`, { headers: auth });
    if (!ur.ok) return r(502, { error: 'Could not read your updates.' });

    const bits = [];
    for (const rec of ((await ur.json()).records || [])) {
      const c = rec.fields || {};
      const title = String(c['Title'] || '');
      if (/^__.*__$/.test(title.trim()) || /^Praying together —/.test(title)) continue;
      const date = c['Date'] || '';
      if (date && date < cutoff) break;
      // Prayer blocks first — they're literally prayer requests — then the prose.
      let prayers = [], prose = '';
      try {
        const blocks = JSON.parse(c['Blocks'] || '[]');
        (Array.isArray(blocks) ? blocks : []).forEach(b => {
          if (!b) return;
          if (b.type === 'prayer' && b.text) prayers.push(String(b.text).trim());
          else if (['text', 'heading', 'praise'].includes(b.type) && b.text) prose += String(b.text) + '\n';
        });
      } catch (e) {}
      if (!prose) prose = String(c['Body'] || c['Excerpt'] || '');
      bits.push({ date, title, prayers, text: prose.replace(/\s+/g, ' ').trim().slice(0, 1200) });
      if (bits.length >= 10) break;
    }
    if (!bits.length) return r(200, { ok: true, items: [], note: 'No recent updates to read yet.' });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: SYSTEM,
        messages: [{ role: 'user', content: `Updates from ${me.name}:\n` + JSON.stringify(bits) }] })
    });
    const d = await res.json();
    if (!res.ok) return r(502, { error: (d.error && d.error.message) || 'The AI could not answer.' });
    const out = (d.content && d.content[0] && d.content[0].text) || '';
    let items = [];
    try { items = JSON.parse(out); } catch { const m = out.match(/\[[\s\S]*\]/); if (m) { try { items = JSON.parse(m[0]); } catch {} } }
    items = (Array.isArray(items) ? items : [])
      .filter(x => x && CATS.includes(x.cat) && String(x.text || '').trim())
      .map(x => ({ cat: x.cat, text: String(x.text).trim().slice(0, 600) }))
      .slice(0, 8);

    return r(200, { ok: true, items, read: bits.length });
  } catch (e) {
    return r(502, { error: 'Could not draft them right now.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
