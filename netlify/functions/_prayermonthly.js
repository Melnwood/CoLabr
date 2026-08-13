// Co·labr — shared core for the monthly prayer update. Used by the scheduled
// function (prayer-monthly.js) and the admin "build it now" (prayer-monthly-now.js).
const { sendMail, esc } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const MISS = 'tbli1L8AO0JUDL7Wl';
const PRAYERS = 'tblDueyGcZzSqCwOh';
const PROFILE = 'tblLzzvsLeLeFOWGl';
const M_NAME = 'fldPYSQwxoQJGb0Zd', M_EMAIL = 'fld65nJ51ewtIWTxj', M_PHOTO = 'fldiXSCuELTQiiT08';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// back = 1 (default): the month just finished — what the 1st-of-month run wants.
// back = 0: this month so far — useful when someone asks for it mid-month.
async function runMonthly({ token, only, back }) {
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const now = new Date();
  const b = (back === 0 || back === '0') ? 0 : 1;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - b, 1));
  const end = b === 0
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = start.toISOString().slice(0, 10), to = end.toISOString().slice(0, 10);
  const label = `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;

  const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?pageSize=100&returnFieldsByFieldId=true`, { headers: auth });
  if (!mr.ok) return { month: label, considered: 0, drafted: 0 };
  const people = ((await mr.json()).records || []).map(rec => {
    const f = rec.fields || {};
    return { name: f[M_NAME] || '', email: f[M_EMAIL] || '', photo: f[M_PHOTO] || '' };
  }).filter(p => p.name && (!only || p.name === only));

  let drafted = 0, ids = [];
  for (const p of people) {
    try { const id = await buildFor(auth, p, from, to, label); if (id) { drafted++; ids.push(id); } } catch (e) {}
  }
  return { month: label, considered: people.length, drafted, ids };
}

async function buildFor(auth, person, from, to, label) {
  const nameEsc = person.name.replace(/'/g, "\\'");

  // The month's updates — their prayer requests, and a banner to reuse.
  const f = encodeURIComponent(`FIND('${nameEsc}', ARRAYJOIN({Missionary}))>0`);
  const ur = await fetch(`https://api.airtable.com/v0/${BASE}/${UPDATES}?pageSize=100&filterByFormula=${f}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`, { headers: auth });
  if (!ur.ok) return false;
  const recs = ((await ur.json()).records || []);

  const asks = [];
  // The prayer update should look the same every month. So the banner is inherited
  // from last month's prayer update — set it once in the composer and it sticks.
  // Only if there has never been one do we borrow the newest cover to start.
  let banner = '', bannerFocus = '', fallback = '', fallbackFocus = '';
  for (const rec of recs) {
    const c = rec.fields || {};
    const title = String(c['Title'] || '');
    if (/^__.*__$/.test(title.trim())) continue;
    if (/^Praying together —/.test(title)) {
      // This month already has one. Never make a second — the writer's edits and
      // their chosen banner live on that record, and a duplicate strands them.
      if (title.trim() === `Praying together — ${label}`) return false;
      if (!banner && c['Cover Image URL']) { banner = c['Cover Image URL']; bannerFocus = c['Cover Focus'] || '50% 35%'; }
      continue;   // never rebuild the content from a previous prayer update
    }
    if (String(c['Status'] || '') !== 'Published') continue;   // only published work is material
    if (!fallback && c['Cover Image URL']) { fallback = c['Cover Image URL']; fallbackFocus = c['Cover Focus'] || '50% 35%'; }
    const date = c['Date'] || '';
    if (date < from || date >= to) continue;
    let blocks = []; try { blocks = JSON.parse(c['Blocks'] || '[]'); } catch (e) {}
    blocks.forEach(bk => {
      if (bk && bk.type === 'prayer' && String(bk.text || '').trim()) asks.push(String(bk.text).trim());
    });
  }

  // Anything answered in the month — the whole point of gathering it.
  const answered = [];
  try {
    const pr = await fetch(`https://api.airtable.com/v0/${BASE}/${PRAYERS}?pageSize=100&filterByFormula=${encodeURIComponent(`{Missionary}='${nameEsc}'`)}`, { headers: auth });
    if (pr.ok) ((await pr.json()).records || []).forEach(rec => {
      const c = rec.fields || {};
      const on = String(c['Resolved On'] || '').slice(0, 10);
      const st = (c['Status'] && c['Status'].name) ? c['Status'].name : c['Status'];
      if (on >= from && on < to && (st === 'Answered' || st === 'Went another way') && c['Outcome']) {
        answered.push({ was: String(c['Text'] || '').trim(), now: String(c['Outcome']).trim(), st });
      }
    });
  } catch (e) {}

  // Standing requests round it out when the month was quiet.
  const standing = [], vision = [];
  try {
    const sr = await fetch(`https://api.airtable.com/v0/${BASE}/${PROFILE}?pageSize=100&filterByFormula=${encodeURIComponent(`AND({Missionary}='${nameEsc}',{Active}=1)`)}`, { headers: auth });
    if (sr.ok) ((await sr.json()).records || []).forEach(rec => {
      const c = rec.fields || {};
      if (!c['Text']) return;
      const cat = (c['Category'] && c['Category'].name) ? c['Category'].name : c['Category'];
      if (/mission|vision/i.test(String(cat || ''))) vision.push(String(c['Text']).trim());
      else standing.push(String(c['Text']).trim());
    });
  } catch (e) {}

  const tpl = await prayerTemplateBanner(auth, person.email);
  if (tpl.url) { banner = tpl.url; bannerFocus = tpl.focus || bannerFocus; }
  if (!banner) { banner = fallback; bannerFocus = fallbackFocus; }

  if (!asks.length && !answered.length) return false;      // a quiet month makes nothing

  const blocks = [];
  blocks.push({ type: 'hero', url: banner, fx: parseFloat(String(bannerFocus).split(' ')[0]) || 50,
    fy: parseFloat(String(bannerFocus).split(' ')[1]) || 35,
    heading: '', sub: 'Everything you helped us carry this month' });
  // The why, first, and freshly worded — the same longing said a new way each month.
  const vis = await visionPrayer(vision, label, person.name);
  if (vis) {
    blocks.push({ type: 'heading', text: 'Why we are here' });
    blocks.push({ type: 'prayer', text: vis });
  }
  if (answered.length) {
    blocks.push({ type: 'heading', text: 'What God did' });
    answered.forEach(a => {
      blocks.push({ type: 'praise', text: (a.was ? `You prayed: ${a.was}\n\n` : '') + a.now });
    });
  }
  if (asks.length) {
    blocks.push({ type: 'heading', text: 'Please keep praying' });
    asks.slice(0, 10).forEach(t => blocks.push({ type: 'prayer', text: t }));
  }
  if (!asks.length && standing.length) {
    blocks.push({ type: 'heading', text: 'Please keep praying' });
    standing.slice(0, 5).forEach(t => blocks.push({ type: 'prayer', text: t }));
  }
  blocks.push({ type: 'text', text: 'Thank you for praying with us. It is the truest partnership there is.' });

  const body = blocks.filter(b => b.text).map(b => b.text).join('\n\n');
  const fields = {
    'Title': `Praying together — ${label}`,
    'Body': body,
    'Excerpt': body.replace(/\s+/g, ' ').trim().slice(0, 240),
    'Type': 'Prayer update',
    'Tags': ['Prayer update'],
    'Status': 'Draft',
    'Source': 'Co-Labr',
    'Missionary': [person.name],
    'Date': (to > new Date().toISOString().slice(0, 10)) ? new Date().toISOString().slice(0, 10) : to,
    'Blocks': JSON.stringify(blocks)
  };
  if (banner) { fields['Cover Image URL'] = banner; fields['Cover Focus'] = bannerFocus || '50% 35%'; }

  const cr = await fetch(`https://api.airtable.com/v0/${BASE}/${UPDATES}`, { method: 'POST', headers: auth,
    body: JSON.stringify({ fields, typecast: true }) });
  if (!cr.ok) return false;
  const id = (await cr.json()).id;

  // Tell them it's waiting — one tap from published.
  if (person.email) {
    const site = process.env.SITE_BASE || '';
    try {
      await sendMail({
        to: person.email.split(',')[0].trim(),
        subject: `Your ${label} prayer update is ready to review`,
        html: `<div style="font-family:-apple-system,Arial,sans-serif;max-width:540px;color:#241f1b">
          <p style="font-size:15px">We gathered your ${esc(label)} prayer requests into a draft update — ${answered.length ? `${answered.length} answered prayer${answered.length === 1 ? '' : 's'} and ` : ''}${asks.length} request${asks.length === 1 ? '' : 's'}.</p>
          <p style="font-size:14px;line-height:1.6">Nothing has been published. Read it, change anything you like, and press publish — or leave it as a draft.</p>
          ${site ? `<p style="margin:18px 0"><a href="${site}/compose.html?id=${id}" style="background:#FF6600;color:#fff;font-weight:700;text-decoration:none;border-radius:10px;padding:11px 20px;display:inline-block">Review your prayer update →</a></p>` : ''}
        </div>`,
        replyTo: '', fromName: 'Co·labr'
      });
    } catch (e) {}
  }
  return id;
}

// A personal template named "Prayer update" is the explicit way to fix the banner:
// build it once in the composer, save it, and every month wears the same face.
const TEMPLATES = 'tblhh1ZIw0jFbllzw';
const T_NAME = 'fldGYkH3AYLtoxj3o', T_OWNER = 'fldUUEIuzwQW1gH6R', T_BANNER = 'fldDlW4hgqau65x71', T_BLOCKS = 'fldJX050XPtNFR2G8';
async function prayerTemplateBanner(auth, email) {
  const mine = String(email || '').split(',')[0].trim().toLowerCase();
  if (!mine) return {};
  try {
    const f = encodeURIComponent(`AND(LOWER({Owner Email})='${mine.replace(/'/g, "\\'")}', FIND('prayer', LOWER({Name}))>0)`);
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TEMPLATES}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${f}`, { headers: auth });
    if (!r.ok) return {};
    const rec = (((await r.json()).records) || [])[0];
    if (!rec) return {};
    const c = rec.fields || {};
    let hero = null;
    try { hero = (JSON.parse(c[T_BLOCKS] || '[]') || []).find(b => b && b.type === 'hero' && b.url) || null; } catch (e) {}
    const url = (hero && hero.url) || c[T_BANNER] || '';
    if (!url) return {};
    const focus = hero ? `${hero.fx != null ? +hero.fx : 50}% ${hero.fy != null ? +hero.fy : 35}%` : '';
    return { url, focus };
  } catch (e) { return {}; }
}

// One fresh way of asking people to pray for the mission, every month.
// The AI rewording costs a fraction of a cent per person per month; when there is
// no key or the API is down, we rotate their own standing wording instead, so the
// section never vanishes and never repeats two months running.
async function visionPrayer(vision, label, who) {
  const base = vision.filter(Boolean);
  if (!base.length) return '';
  const monthIdx = MONTHS.indexOf(String(label).split(' ')[0]);
  const rotated = base[((monthIdx < 0 ? 0 : monthIdx) % base.length)];
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return rotated;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5', max_tokens: 200,
        system: `You are helping a missionary ask their supporters to pray for the mission they gave their life to.

You are given how they themselves describe it. Say the same longing a FRESH way for this month — same substance, different words, so that someone reading twelve of these in a row never feels read the same sentence twice.

Rules:
- One or two sentences. Warm, plain, specific to what they wrote. Never churchy filler.
- It must stand alone on a prayer wall: name the who and the what.
- Do not invent places, names, numbers or events that are not in their own words.
- Do not mention the month.
Return ONLY the prayer request text — no preamble, no quotation marks.`,
        messages: [{ role: 'user', content: `How ${who} describes the mission they are praying toward:\n` + base.map(t => '- ' + t).join('\n') }]
      })
    });
    if (!res.ok) return rotated;
    const d = await res.json();
    const out = ((d.content && d.content[0] && d.content[0].text) || '').trim().replace(/^["']|["']$/g, '');
    return out.length > 20 ? out.slice(0, 600) : rotated;
  } catch (e) { return rotated; }
}

module.exports = { runMonthly };
