// Co-Labr — Care radar trajectories: read each person's recent updates in sequence and
// judge the direction of their tone — not single events, but drift. Super-admin only.
const { sessionFromEvent, isAdmin } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const MISS = 'tbli1L8AO0JUDL7Wl';
const F = {
  title: 'fldhkHAXyvqtrx3cu', miss: 'fldpNShY6OSQBSbx0', date: 'fldvi8dFkZBFANacG',
  body: 'fld96vgsguk83wclD', excerpt: 'fld9PBqSvmd4vNiyh'
};
const M_NAME = 'fldPYSQwxoQJGb0Zd', M_PHOTO = 'fldiXSCuELTQiiT08';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
const LABELS = ['Full of life', 'Steady', 'Tiring', 'Worth a check-in'];

const SYSTEM = `You are helping the leader of Josiah Venture (a Christian youth-ministry organization) shepherd staff well.
You are given a JSON list of people. For each person you get their recent supporter updates OLDEST FIRST: date, title, text (truncated).
Read each person's updates as a sequence and judge the DIRECTION of their spiritual and emotional tone over time — not one-off events, but drift.
Pick exactly one label per person:
- "Full of life" — energized, faith-filled, engaged, and holding or rising
- "Steady" — consistent, healthy, nothing notable either way
- "Tiring" — signs of fatigue creeping in over time: heavier tone, shrinking updates, more strain than joy
- "Worth a check-in" — a clear downward drift, persistent discouragement, or something that reads like quiet struggle
Rules:
- Weigh the newest updates most. One hard update inside an otherwise lively sequence is NOT a downward drift.
- "why" is ONE specific sentence (max ~25 words) grounded in what actually changed across their updates.
- Supporter updates are curated, so treat visible strain as meaningful.
Return ONLY a JSON array like [{"idx":0,"label":"Steady","why":"..."}] with one entry per person. No preamble.`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const session = sessionFromEvent(event);
  if (!session) return r(401, { error: 'Please sign in.' });
  if (!isAdmin(session.email)) return r(403, { error: 'Admins only.' });
  const token = process.env.AIRTABLE_TOKEN;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!token) return r(500, { error: 'Server not configured.' });
  if (!key) return r(500, { error: 'AI is not set up (missing ANTHROPIC_API_KEY).' });
  const auth = { Authorization: 'Bearer ' + token };

  try {
    const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?pageSize=100&returnFieldsByFieldId=true`, { headers: auth });
    const mmap = {};
    if (mr.ok) ((await mr.json()).records || []).forEach(m => { const f = m.fields || {}; mmap[m.id] = { name: f[M_NAME] || '', photo: f[M_PHOTO] || '' }; });

    const uf = encodeURIComponent(`{Status}='Published'`);
    const ur = await fetch(`https://api.airtable.com/v0/${BASE}/${UPDATES}?pageSize=100&returnFieldsByFieldId=true&filterByFormula=${uf}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`, { headers: auth });
    if (!ur.ok) return r(502, { error: 'Could not read the updates.' });
    const recs = ((await ur.json()).records || []);

    // Up to 6 most-recent updates per person, then flip to oldest-first for the model.
    const byPerson = {};
    for (const rec of recs) {
      const f = rec.fields || {};
      const mid = Array.isArray(f[F.miss]) ? f[F.miss][0] : '';
      if (!mid || !mmap[mid]) continue;
      (byPerson[mid] = byPerson[mid] || []).push({
        date: f[F.date] || '', title: f[F.title] || '',
        text: String(f[F.body] || f[F.excerpt] || '').slice(0, 700)
      });
    }
    const people = Object.entries(byPerson)
      .map(([mid, ups]) => ({ author: mmap[mid].name, photo: mmap[mid].photo, updates: ups.slice(0, 6).reverse() }))
      .filter(p => p.updates.length >= 2);
    if (!people.length) return r(200, { people: [] });

    const payload = people.map((p, i) => ({ idx: i, author: p.author, updates: p.updates }));
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1200, system: SYSTEM,
        messages: [{ role: 'user', content: 'Here are the people:\n' + JSON.stringify(payload) }]
      })
    });
    const data = await resp.json();
    if (!resp.ok) return r(resp.status, { error: (data.error && data.error.message) || 'AI request failed.' });
    const out = (data.content && data.content[0] && data.content[0].text) || '';
    let judged = [];
    try { judged = JSON.parse(out); } catch { const m = out.match(/\[[\s\S]*\]/); if (m) { try { judged = JSON.parse(m[0]); } catch {} } }
    const result = (Array.isArray(judged) ? judged : [])
      .filter(x => x && Number.isInteger(x.idx) && people[x.idx] && LABELS.includes(x.label))
      .map(x => ({
        author: people[x.idx].author, photo: people[x.idx].photo,
        updates: people[x.idx].updates.length,
        label: x.label, why: String(x.why || '').slice(0, 300)
      }))
      .sort((a, b) => LABELS.indexOf(b.label) - LABELS.indexOf(a.label));   // heaviest first
    return r(200, { people: result });
  } catch (e) {
    return r(502, { error: 'Could not read trajectories.' });
  }
};
function r(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
