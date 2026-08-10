// Co·labr — MPD radar core. Reads recent published updates across all staff and asks
// the AI two questions an MPD director actually cares about:
//   1) Did this update INVITE people into partnership — a real ask, not just news?
//   2) Is the tone sustained-negative across the whole update (not one hard sentence)?
// Shared by mpd-scan.js (the admin page) and any future digest.
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const MISS = 'tbli1L8AO0JUDL7Wl';
const F = {
  title: 'fldhkHAXyvqtrx3cu', miss: 'fldpNShY6OSQBSbx0', date: 'fldvi8dFkZBFANacG',
  body: 'fld96vgsguk83wclD', excerpt: 'fld9PBqSvmd4vNiyh', cover: 'fldsU5p6r9LzdeTF7',
  blocks: 'fldN9B0v6YU0xptFu'
};
const M_NAME = 'fldPYSQwxoQJGb0Zd', M_PHOTO = 'fldiXSCuELTQiiT08', M_ORG = 'fldCQ8c1Eu6SXmY98';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
const KINDS = ['Direct ask', 'Soft invitation', 'Need shared', 'Thanks to partners'];

const SYSTEM = `You read missionary support updates for the MPD (support-raising) directors of Josiah Venture.
MPD means FINANCIAL partnership only — money. Nothing else counts.

You are given a JSON list of updates: idx, author, date, title, text.

A) FINANCIAL PARTNERSHIP CONTENT — only these count:
   "Direct ask" — asks the reader to give money, become a monthly/financial partner, or increase their giving
   "Soft invitation" — points the reader toward giving money without a clear ask ("if you'd like to help us get there…")
   "Need shared" — names a MONEY/funding need (support percentage, a vehicle to buy, a budget gap) without inviting anyone to give
   "Thanks to partners" — thanks people for their financial giving

   NOT MPD — never flag these:
   - asking for prayer, however heartfelt ("would you pray for these young laborers")
   - asking people to share the update, volunteer, come on a trip, join a camp team, send a note
   - a Give button or link with no words asking (buttons are not an ask)
   - general statements about God providing, with no invitation to the reader
   If an update has no MONEY content, return nothing for it. Most updates will have nothing. That is the correct answer.

B) TONE — only flag "negative" when discouragement or criticism runs THROUGH the update
   (the culture, the people, the ministry, the work) — not one honest hard sentence in an
   otherwise hopeful letter. Grief and lament are NOT negativity. Be conservative.

Return ONLY a JSON array. One object per update that has FINANCIAL content OR a negative tone:
[{"idx":0,"kinds":["Direct ask"],"strength":"strong|clear|faint","note":"one factual sentence, max 25 words","quote":"verbatim phrase about money, max 15 words","negative":false,"toneNote":""}]
- "strength" describes how compelling the financial invitation is, for coaching.
- "quote" MUST be the phrase that asks about money. If you cannot quote money words, it is not MPD — leave it out.
- Set "negative":true only for sustained negativity, with "toneNote" one plain sentence.
No preamble.`;

// Cheap pre-filter: only pay the AI to read updates that actually mention money.
// A prayer-only letter never reaches the model.
const MONEYISH = /\b(giv(e|ing|en)|gift|gifts|donat|support(ers?|ing)?|partner(s|ship|ing)?|fund(s|ing|ed)?|financ|monthly|pledge|raise[sd]? support|budget|provision|underwrit|sponsor)\b/i;

async function mpdScan({ token, key, days }) {
  const auth = { Authorization: 'Bearer ' + token };

  const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?pageSize=100&returnFieldsByFieldId=true`, { headers: auth });
  const mmap = {};
  if (mr.ok) ((await mr.json()).records || []).forEach(m => { const f = m.fields || {}; mmap[m.id] = { name: f[M_NAME] || '', photo: f[M_PHOTO] || '', org: f[M_ORG] || '' }; });

  const uf = encodeURIComponent(`{Status}='Published'`);
  const ur = await fetch(`https://api.airtable.com/v0/${BASE}/${UPDATES}?pageSize=100&returnFieldsByFieldId=true&filterByFormula=${uf}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`, { headers: auth });
  if (!ur.ok) throw new Error('Could not read the updates.');
  const recs = ((await ur.json()).records || []);

  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const picked = [];
  for (const rec of recs) {
    const f = rec.fields || {};
    if ((f[F.date] || '') < cutoff) continue;
    const title = String(f[F.title] || '');
    if (!title || /^__.*__$/.test(title.trim())) continue;      // skip internal marker rows
    const mid = Array.isArray(f[F.miss]) ? f[F.miss][0] : '';
    const who = mmap[mid] || {};
    // Prefer the composed blocks (real words) over the flattened body.
    let text = String(f[F.body] || f[F.excerpt] || '');
    try {
      const bl = JSON.parse(f[F.blocks] || '[]');
      if (Array.isArray(bl) && bl.length) {
        const t = bl.filter(b => b && ['text', 'heading', 'quote', 'prayer', 'praise', 'give', 'button'].includes(b.type))
          .map(b => (b.type === 'give' || b.type === 'button') ? `[${b.type} button: ${b.label || ''}]` : String(b.text || ''))
          .filter(Boolean).join('\n');
        if (t.trim()) text = t;
      }
    } catch (e) {}
    picked.push({
      id: rec.id, author: who.name || 'Unknown', photo: who.photo || '', org: who.org || '',
      date: f[F.date] || '', title, cover: f[F.cover] || '', text: text.slice(0, 2400)
    });
    if (picked.length >= 40) break;
  }
  const published = picked.length;
  const authorsAll = [...new Set(picked.map(p => p.author))];
  // Only money-mentioning updates go to the model — this is most of the savings.
  const cand = picked.filter(p => MONEYISH.test(p.text) || MONEYISH.test(p.title)).slice(0, 25);
  if (!cand.length) return { items: [], scanned: published, read: 0, silent: authorsAll.map(a => { const p = picked.find(x => x.author === a); return { author: a, photo: p.photo, org: p.org, date: p.date, title: p.title }; }) };

  const payload = cand.map((p, i) => ({ idx: i, author: p.author, date: p.date, title: p.title, text: p.text }));
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1800, system: SYSTEM,
      messages: [{ role: 'user', content: 'Here are the updates:\n' + JSON.stringify(payload) }] })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error((data.error && data.error.message) || 'AI request failed.');
  const out = (data.content && data.content[0] && data.content[0].text) || '';
  let flags = [];
  try { flags = JSON.parse(out); } catch { const m = out.match(/\[[\s\S]*\]/); if (m) { try { flags = JSON.parse(m[0]); } catch {} } }

  const items = (Array.isArray(flags) ? flags : [])
    .filter(x => x && Number.isInteger(x.idx) && cand[x.idx])
    .map(x => {
      const p = cand[x.idx];
      return {
        updateId: p.id, author: p.author, photo: p.photo, org: p.org, date: p.date, title: p.title, cover: p.cover,
        text: p.text,
        kinds: (Array.isArray(x.kinds) ? x.kinds : []).filter(k => KINDS.includes(k)),
        strength: ['strong', 'clear', 'faint'].includes(x.strength) ? x.strength : '',
        note: String(x.note || '').slice(0, 300),
        quote: String(x.quote || '').slice(0, 160),
        negative: !!x.negative,
        toneNote: String(x.toneNote || '').slice(0, 300)
      };
    })
    .filter(x => x.kinds.length || x.negative);

  // Who published in the window but never invited anyone into partnership —
  // the quiet gap an MPD director most wants to see.
  const asked = new Set(items.filter(i => i.kinds.length).map(i => i.author));
  const silent = authorsAll.filter(a => !asked.has(a))
    .map(a => { const p = picked.find(x => x.author === a); return { author: a, photo: p.photo, org: p.org, date: p.date, title: p.title }; });

  return { items, scanned: published, read: cand.length, silent };
}

module.exports = { mpdScan, KINDS };
