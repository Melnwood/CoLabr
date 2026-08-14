// Co·labr — the daily pass over the trial clock. Warns, freezes, hides, and (only
// at the very end, and only for accounts that have been dark for two months with
// their archive already in their hands) deletes.
//
// Everything here is deliberately timid:
//   · it does nothing at all unless "Billing enforcement" is on in Platform Settings
//   · an account covered by a paying organization is skipped before anything else
//   · a page is never hidden until its archive has actually been delivered
//   · deletions are capped per run, so a bug cannot empty the platform overnight
//   · every action is written to the console and returned in the summary
const crypto = require('crypto');
const { sendMail, esc } = require('./_mail');
const B = require('./_billing');

const UPDATES = 'tbl7aVErl35Qw36QZ';
const SUBS = 'tbl21LyWOBxln6bOy';
const M_NAME = 'fldPYSQwxoQJGb0Zd', M_EMAIL = 'fld65nJ51ewtIWTxj';
const BUCKET = process.env.GCS_BUCKET || 'colabr-photos-jv';

const MAX_DELETES_PER_RUN = 5;   // a blast radius, on purpose

async function runSweep({ token, only, dry }) {
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const site = process.env.SITE_BASE || '';

  if (!(await B.enforcing(auth))) {
    return { ok: true, enforcing: false, note: 'Billing enforcement is off in Platform Settings — nothing was touched.' };
  }

  let people = [], url = `https://api.airtable.com/v0/${B.BASE}/${B.MISS}?pageSize=100`;
  while (url) {
    const r = await fetch(url, { headers: auth }); if (!r.ok) break;
    const d = await r.json();
    people = people.concat(d.records || []);
    url = d.offset ? `https://api.airtable.com/v0/${B.BASE}/${B.MISS}?pageSize=100&offset=${d.offset}` : '';
  }

  const acted = [];
  let deletes = 0;

  for (const rec of people) {
    const f = rec.fields || {};
    const name = f[M_NAME] || '', email = String(f[M_EMAIL] || '').split(',')[0].trim();
    if (!name) continue;
    if (only && name !== only) continue;

    // A paying organization's staff never enter this machine at all.
    if (f[B.F.covered]) continue;

    const st = B.stateOf(f);
    if (st.state === 'covered' || st.state === 'paid') continue;

    const done = String(f[B.F.notified] || '').split(',').map(s => s.trim()).filter(Boolean);
    const mark = async (tag, extra) => {
      if (dry) return;
      const fields = Object.assign({ [B.F.notified]: done.concat([tag]).join(',') }, extra || {});
      await fetch(`https://api.airtable.com/v0/${B.BASE}/${B.MISS}/${rec.id}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({ fields, typecast: true }) }).catch(() => {});
    };
    const say = (what) => { acted.push({ name, state: st.state, day: st.day, did: what }); console.log('billing', name, st.state, what); };

    // ---- Trial, with the end in sight ----
    if (st.state === 'trial') {
      for (const at of [7, 12]) {
        if (st.day === at && !done.includes('t' + at)) {
          if (!dry && email) await mailTrial(email, name, st.daysLeft, site);
          await mark('t' + at); say('warned, ' + st.daysLeft + ' days left');
        }
      }
      continue;
    }

    // ---- Frozen: wall up, writing off ----
    if (st.state === 'frozen') {
      if (!done.includes('froze')) {
        if (!dry && email) await mailFrozen(email, name, st.hideOn, site);
        await mark('froze'); say('froze — wall still up for supporters');
      }
      // A week before the page goes dark, put their whole archive in their hands.
      if (st.daysLeft <= 7 && !f[B.F.archiveSent]) {
        const archive = dry ? { url: '(dry run)' } : await buildArchive(auth, token, rec.id, name);
        if (archive && archive.url) {
          if (!dry && email) await mailArchive(email, name, archive.url, st.hideOn, site);
          await mark('archive', { [B.F.archiveSent]: B.today(), [B.F.archiveUrl]: archive.url });
          say('archive delivered (' + (archive.count || 0) + ' updates)');
        } else say('ARCHIVE FAILED — not hiding this page');
      }
      continue;
    }

    // ---- Due to go dark ----
    if (st.state === 'due-hide') {
      // Never hide someone who does not yet hold their own archive.
      if (!f[B.F.archiveSent]) {
        const archive = dry ? { url: '(dry run)' } : await buildArchive(auth, token, rec.id, name);
        if (!archive || !archive.url) { say('WAITING — archive not delivered yet, page left up'); continue; }
        if (!dry && email) await mailArchive(email, name, archive.url, B.today(), site);
        await mark('archive', { [B.F.archiveSent]: B.today(), [B.F.archiveUrl]: archive.url });
      }
      if (!dry) await mark('hid', { [B.F.hiddenOn]: B.today() });
      if (!dry && email) await mailHidden(email, name, site);
      say('hid the page — 62 days to restore');
      continue;
    }

    // ---- Hidden, counting down to deletion ----
    if (st.state === 'hidden') {
      const left = B.DELETE_DAY - st.day;
      if (left <= 7 && !done.includes('last')) {
        if (!dry && email) await mailLastCall(email, name, left, f[B.F.archiveUrl] || '', site);
        await mark('last'); say('final warning — ' + left + ' days to deletion');
      }
      continue;
    }

    // ---- The end. Every guard has to agree. ----
    if (st.state === 'due-delete') {
      if (deletes >= MAX_DELETES_PER_RUN) { say('deferred to tomorrow (per-run cap)'); continue; }
      if (!f[B.F.archiveSent]) { say('REFUSED to delete — no archive was ever delivered'); continue; }
      if (B.daysSince(String(f[B.F.hiddenOn]).slice(0, 10)) < 60) { say('REFUSED to delete — not dark long enough'); continue; }
      if (dry) { say('would delete now'); deletes++; continue; }
      const n = await deleteEverything(auth, rec.id, name);
      deletes++;
      say('DELETED — ' + n.updates + ' updates, ' + n.subs + ' supporters');
    }
  }

  return { ok: true, enforcing: true, considered: people.length, acted, deletes, dry: !!dry };
}

// ---- The archive: their whole story, as one file they own ----
async function buildArchive(auth, token, missId, name) {
  try {
    const nameEsc = name.replace(/'/g, "\\'");
    const f = encodeURIComponent(`FIND('${nameEsc}', ARRAYJOIN({Missionary}))>0`);
    let recs = [], url = `https://api.airtable.com/v0/${B.BASE}/${UPDATES}?pageSize=100&filterByFormula=${f}`;
    while (url) {
      const r = await fetch(url, { headers: auth }); if (!r.ok) break;
      const d = await r.json(); recs = recs.concat(d.records || []);
      url = d.offset ? `https://api.airtable.com/v0/${B.BASE}/${UPDATES}?pageSize=100&filterByFormula=${f}&offset=${d.offset}` : '';
    }
    const updates = recs.map(r => {
      const c = r.fields || {};
      let blocks = []; try { blocks = JSON.parse(c['Blocks'] || '[]'); } catch (e) {}
      return { title: c['Title'] || '', date: c['Date'] || '', status: c['Status'] || '',
        cover: c['Cover Image URL'] || '', body: c['Body'] || '', blocks };
    }).filter(u => u.title && !/^__.*__$/.test(u.title.trim()))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const gcs = await gToken(JSON.parse(process.env.GCP_SA_KEY || '{}'), 'https://www.googleapis.com/auth/devstorage.read_write');
    const stamp = B.today();
    const base = `archives/${missId}-${stamp}`;
    await put(gcs, base + '.json', 'application/json', JSON.stringify({ name, exported: stamp, updates }, null, 2));
    await put(gcs, base + '.html', 'text/html; charset=utf-8', archiveHtml(name, stamp, updates));
    return { url: `https://storage.googleapis.com/${BUCKET}/${base}.html`, count: updates.length };
  } catch (e) { console.log('archive failed', name, String(e && e.message || e)); return null; }
}

function archiveHtml(name, stamp, updates) {
  const blk = b => {
    if (!b) return '';
    if (b.type === 'photo' && b.url) return `<img src="${esc(b.url)}" alt="">${b.caption ? `<p class="cap">${esc(b.caption)}</p>` : ''}`;
    if (b.type === 'hero' && b.url) return `<img src="${esc(b.url)}" alt="">`;
    if (b.type === 'heading') return `<h3>${esc(b.text || '')}</h3>`;
    if (b.type === 'prayer') return `<blockquote><b>Prayer</b><br>${esc(b.text || '').replace(/\n/g, '<br>')}</blockquote>`;
    if (b.type === 'praise') return `<blockquote><b>Praise</b><br>${esc(b.text || '').replace(/\n/g, '<br>')}</blockquote>`;
    if (b.type === 'quote') return `<blockquote>${esc(b.text || '')}${b.by ? `<br>— ${esc(b.by)}` : ''}</blockquote>`;
    if (['text', 'signoff'].includes(b.type)) return `<p>${esc(b.text || '').replace(/\n/g, '<br>')}</p>`;
    return '';
  };
  return `<!doctype html><meta charset="utf-8"><title>${esc(name)} — every update</title>
<style>body{max-width:720px;margin:0 auto;padding:40px 22px;font:16px/1.7 Georgia,serif;color:#241f1b}
h1{font-size:30px}h2{font-size:23px;margin:0 0 4px}h3{font-size:18px}img{max-width:100%;border-radius:10px;margin:10px 0}
.u{border-top:1px solid #e7e0d6;padding-top:26px;margin-top:34px}.d{color:#7a6c58;font-size:14px;margin:0 0 14px}
blockquote{border-left:3px solid #FF6600;margin:12px 0;padding:2px 0 2px 14px;color:#463a28}
.cap{color:#7a6c58;font-size:14px;margin-top:-4px}.lede{color:#7a6c58}</style>
<h1>${esc(name)}</h1>
<p class="lede">Every update you ever wrote on Co·labr — ${updates.length} in all, exported ${esc(stamp)}.
This file is yours. It works offline, forever, with no account and no Co·labr.</p>
${updates.map(u => `<div class="u"><h2>${esc(u.title)}</h2><p class="d">${esc(u.date)}${u.status !== 'Published' ? ' · ' + esc(u.status) : ''}</p>
${u.cover ? `<img src="${esc(u.cover)}" alt="">` : ''}
${(u.blocks && u.blocks.length) ? u.blocks.map(blk).join('') : `<p>${esc(u.body || '').replace(/\n/g, '<br>')}</p>`}</div>`).join('')}`;
}

// ---- Deletion. Reached only after every guard above has agreed. ----
async function deleteEverything(auth, missId, name) {
  const out = { updates: 0, subs: 0 };
  const nameEsc = name.replace(/'/g, "\\'");
  for (const [table, formula] of [
    [UPDATES, `FIND('${nameEsc}', ARRAYJOIN({Missionary}))>0`],
    [SUBS, `{Missionary}='${nameEsc}'`]
  ]) {
    let ids = [], url = `https://api.airtable.com/v0/${B.BASE}/${table}?pageSize=100&filterByFormula=${encodeURIComponent(formula)}`;
    while (url) {
      const r = await fetch(url, { headers: auth }); if (!r.ok) break;
      const d = await r.json(); (d.records || []).forEach(x => ids.push(x.id));
      url = d.offset ? `https://api.airtable.com/v0/${B.BASE}/${table}?pageSize=100&filterByFormula=${encodeURIComponent(formula)}&offset=${d.offset}` : '';
    }
    for (let i = 0; i < ids.length; i += 10) {
      const q = ids.slice(i, i + 10).map(id => `records[]=${id}`).join('&');
      await fetch(`https://api.airtable.com/v0/${B.BASE}/${table}?${q}`, { method: 'DELETE', headers: auth }).catch(() => {});
    }
    if (table === UPDATES) out.updates = ids.length; else out.subs = ids.length;
  }
  await fetch(`https://api.airtable.com/v0/${B.BASE}/${B.MISS}/${missId}`, { method: 'DELETE', headers: auth }).catch(() => {});
  return out;
}

// ---- The letters ----
const wrap = (body) => `<div style="font-family:-apple-system,Arial,sans-serif;max-width:540px;color:#241f1b;font-size:15px;line-height:1.65">${body}</div>`;
const btn = (href, label) => `<p style="margin:20px 0"><a href="${href}" style="background:#FF6600;color:#fff;font-weight:700;text-decoration:none;border-radius:10px;padding:12px 22px;display:inline-block">${label}</a></p>`;
const first = (n) => esc(String(n || '').split(/[\s&]/)[0] || 'there');

async function mailTrial(to, name, left, site) {
  await sendMail({ to, subject: `${left} days left on your Co·labr trial`, fromName: 'Co·labr', html: wrap(
    `<p>Hi ${first(name)},</p><p>Your free trial has <b>${left} day${left === 1 ? '' : 's'}</b> to run.</p>
     <p>When it ends your wall stays up — your supporters can still read everything, pray and give. Writing and sending pause until a subscription is active.</p>
     ${site ? btn(site + '/pricing.html', 'Keep everything running') : ''}`) }).catch(() => {});
}
async function mailFrozen(to, name, hideOn, site) {
  await sendMail({ to, subject: 'Your Co·labr trial has ended', fromName: 'Co·labr', html: wrap(
    `<p>Hi ${first(name)},</p><p>Your trial has ended, so publishing and sending are paused.</p>
     <p><b>Your wall is still up.</b> Everyone you have already reached can read every update, tap “I’m praying”, and give — none of that stops.</p>
     <p>If nothing changes by <b>${esc(hideOn || '')}</b> the page goes dark, and we will send you your complete archive before that happens.</p>
     ${site ? btn(site + '/pricing.html', 'Start writing again') : ''}`) }).catch(() => {});
}
async function mailArchive(to, name, url, hideOn, site) {
  await sendMail({ to, subject: 'Your Co·labr archive — every update you wrote', fromName: 'Co·labr', html: wrap(
    `<p>Hi ${first(name)},</p><p>Here is <b>everything you ever wrote on Co·labr</b>, in one file. Save it somewhere safe. It opens in any browser, works offline, and needs no account — it is yours whatever you decide.</p>
     ${btn(url, 'Download my archive')}
     <p style="font-size:13.5px;color:#7a6c58">Your page goes dark on ${esc(hideOn || '')}. Nothing is deleted then — it can be restored the moment a subscription is active.</p>
     ${site ? `<p style="font-size:13.5px"><a href="${site}/pricing.html" style="color:#FF6600">Keep my page instead</a></p>` : ''}`) }).catch(() => {});
}
async function mailHidden(to, name, site) {
  await sendMail({ to, subject: 'Your Co·labr page is now paused', fromName: 'Co·labr', html: wrap(
    `<p>Hi ${first(name)},</p><p>Your page is now hidden. Supporters visiting your link see a short note that it is paused — nothing more.</p>
     <p><b>Nothing has been deleted.</b> Every update, photo and supporter is exactly where you left it, and one payment brings the whole thing back instantly.</p>
     ${site ? btn(site + '/pricing.html', 'Restore my page') : ''}`) }).catch(() => {});
}
async function mailLastCall(to, name, left, archiveUrl, site) {
  await sendMail({ to, subject: `Your Co·labr page will be deleted in ${left} day${left === 1 ? '' : 's'}`, fromName: 'Co·labr', html: wrap(
    `<p>Hi ${first(name)},</p><p>Your page has been paused for two months. In <b>${left} day${left === 1 ? '' : 's'}</b> it and everything in it will be permanently deleted.</p>
     <p>This is the last message we will send about it.</p>
     ${archiveUrl ? `<p><a href="${esc(archiveUrl)}" style="color:#FF6600">Your archive is still here</a> — please save it now if you have not.</p>` : ''}
     ${site ? btn(site + '/pricing.html', 'Restore my page') : ''}`) }).catch(() => {});
}

// ---- GCS ----
async function put(token, name, type, body) {
  const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(name)}`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': type }, body });
  return r.ok;
}
async function gToken(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64u(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(h + '.' + c).sign(sa.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: h + '.' + c + '.' + sig }) });
  const jj = await res.json(); if (!jj.access_token) throw new Error('no gcs token'); return jj.access_token;
}
function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

module.exports = { runSweep, buildArchive };
