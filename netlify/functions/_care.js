// Co-Labr — shared Care-radar scan core. Reads recent published updates across all
// staff and asks the AI to flag significant life events. Used by care-scan.js (the
// admin page) and care-digest.js (the scheduled morning email).
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const MISS = 'tbli1L8AO0JUDL7Wl';
const F = {
  title: 'fldhkHAXyvqtrx3cu', miss: 'fldpNShY6OSQBSbx0', date: 'fldvi8dFkZBFANacG',
  body: 'fld96vgsguk83wclD', excerpt: 'fld9PBqSvmd4vNiyh', cover: 'fldsU5p6r9LzdeTF7'
};
const M_NAME = 'fldPYSQwxoQJGb0Zd', M_PHOTO = 'fldiXSCuELTQiiT08';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
const CATS = ['Hard news', 'Exciting news', 'Big change', 'Baby', 'Death'];

const SYSTEM = `You are helping the leader of Josiah Venture (a Christian youth-ministry organization) care for staff by reading their latest supporter updates.
You are given a JSON list of updates: idx, author, date, title, text.
For each update, decide whether it clearly contains any of these categories:
- "Hard news" — illness, crisis, loss of support, discouragement, family difficulty, burnout
- "Exciting news" — breakthroughs, answered prayer, milestones worth celebrating with them
- "Big change" — role change, moving country/city, leaving or joining a team, new ministry direction
- "Baby" — pregnancy or a baby born
- "Death" — a death of a family member, teammate, student, or close friend
Rules:
- Flag ONLY what the text clearly supports. Most updates have nothing — that is fine.
- An update can have several categories.
- "note" is ONE warm, factual sentence (max ~25 words) telling the leader what happened, so they can follow up personally.
- "quote" is a short verbatim phrase from the text (max 15 words) that grounds the flag.
Return ONLY a JSON array like [{"idx":0,"categories":["Baby"],"note":"...","quote":"..."}] — include only updates with at least one category. No preamble.`;

// windowOnly: true = only updates dated inside the window (the daily digest);
// false = the window plus at least each person's single latest update (the admin page).
// withQuiet: also return who has gone quiet — no published update in 60+ days (or ever).
async function careScan({ token, key, days, windowOnly, withQuiet }) {
  const auth = { Authorization: 'Bearer ' + token };

  const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?pageSize=100&returnFieldsByFieldId=true`, { headers: auth });
  const mmap = {};
  if (mr.ok) ((await mr.json()).records || []).forEach(m => { const f = m.fields || {}; mmap[m.id] = { name: f[M_NAME] || '', photo: f[M_PHOTO] || '' }; });

  const uf = encodeURIComponent(`{Status}='Published'`);
  const ur = await fetch(`https://api.airtable.com/v0/${BASE}/${UPDATES}?pageSize=100&returnFieldsByFieldId=true&filterByFormula=${uf}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`, { headers: auth });
  if (!ur.ok) throw new Error('Could not read the updates.');
  const recs = ((await ur.json()).records || []);

  // Silence is a signal: who hasn't published in 60+ days, or never has.
  // People can curate what they write — they can't curate a gap.
  let quiet;
  if (withQuiet) {
    const QUIET_DAYS = 60;
    const last = {}; const counts = {};
    for (const rec of recs) {
      const f = rec.fields || {};
      const mid = Array.isArray(f[F.miss]) ? f[F.miss][0] : '';
      if (!mid) continue;
      counts[mid] = (counts[mid] || 0) + 1;
      if (!last[mid] || (f[F.date] || '') > last[mid]) last[mid] = f[F.date] || '';
    }
    quiet = Object.entries(mmap).map(([mid, m]) => {
      const lastDate = last[mid] || '';
      const daysSince = lastDate ? Math.floor((Date.now() - new Date(lastDate + 'T12:00:00')) / 86400000) : null;
      return { author: m.name, photo: m.photo, lastDate, daysSince, count: counts[mid] || 0 };
    }).filter(q => q.author && (q.daysSince === null || q.daysSince >= QUIET_DAYS))
      .sort((a, b) => (b.daysSince === null ? 1e9 : b.daysSince) - (a.daysSince === null ? 1e9 : a.daysSince));
  }

  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const seen = new Set(); const picked = [];
  for (const rec of recs) {
    const f = rec.fields || {};
    const mid = Array.isArray(f[F.miss]) ? f[F.miss][0] : '';
    const author = (mmap[mid] || {}).name || 'Unknown';
    const inWindow = (f[F.date] || '') >= cutoff;
    const firstForPerson = !seen.has(author);
    if (!inWindow && (windowOnly || !firstForPerson)) continue;
    seen.add(author);
    picked.push({
      id: rec.id, author, photo: (mmap[mid] || {}).photo || '',
      date: f[F.date] || '', title: f[F.title] || '', cover: f[F.cover] || '',
      text: String(f[F.body] || f[F.excerpt] || '').slice(0, 2400)
    });
    if (picked.length >= 25) break;
  }
  if (!picked.length) return { items: [], scanned: 0, quiet };

  const payload = picked.map((p, i) => ({ idx: i, author: p.author, date: p.date, title: p.title, text: p.text }));
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1500, system: SYSTEM,
      messages: [{ role: 'user', content: 'Here are the updates:\n' + JSON.stringify(payload) }]
    })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error((data.error && data.error.message) || 'AI request failed.');
  const out = (data.content && data.content[0] && data.content[0].text) || '';
  let flags = [];
  try { flags = JSON.parse(out); } catch { const m = out.match(/\[[\s\S]*\]/); if (m) { try { flags = JSON.parse(m[0]); } catch {} } }
  const items = (Array.isArray(flags) ? flags : [])
    .filter(x => x && Number.isInteger(x.idx) && picked[x.idx] && Array.isArray(x.categories))
    .map(x => {
      const p = picked[x.idx];
      return {
        updateId: p.id, author: p.author, photo: p.photo, date: p.date, title: p.title, cover: p.cover,
        categories: x.categories.filter(c => CATS.includes(c)),
        note: String(x.note || '').slice(0, 300),
        quote: String(x.quote || '').slice(0, 160)
      };
    })
    .filter(x => x.categories.length);
  return { items, scanned: picked.length, quiet };
}

module.exports = { careScan, CATS };
