// Co·labr — the answered-prayer loop.
//
// A supporter taps "I'm praying" and it disappears into a counter. This closes
// that loop: when a request is answered, everyone who prayed on that update hears
// what happened — "You prayed for Marek in March. He was baptized Sunday."
//
// The rule that keeps it alive (JV's old prayer room died of upkeep):
// NEVER a separate errand. 'open' is called by the composer, so the only time a
// missionary is asked is while they are already writing. Requests older than
// QUIET_DAYS retire themselves — no badge, no overdue list, no guilt.
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const { sendMail, esc } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const RESPONSES = 'tblVNMG5VnOnFFeto';
const PRAYERS = 'tblDueyGcZzSqCwOh';
const QUIET_DAYS = 90;          // after this, a request quietly stops being asked about
const ASK_LIMIT = 2;            // never more than this in one sitting

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const sess = sessionFromEvent(event);
  if (!sess) return r(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }

  let me = null;
  try { me = await missByEmail({ Authorization: 'Bearer ' + token }, sess.email); } catch (e) {}
  if (!me || !me.name) return r(403, { error: 'Your page isn\'t set up yet.' });
  const nameEsc = String(me.name).replace(/'/g, "\\'");

  try {
    // Everything already resolved, so we never ask twice.
    const doneKeys = new Set();
    try {
      const pr = await fetch(`https://api.airtable.com/v0/${BASE}/${PRAYERS}?pageSize=100&filterByFormula=${encodeURIComponent(`{Missionary}='${nameEsc}'`)}`, { headers: auth });
      if (pr.ok) ((await pr.json()).records || []).forEach(rec => { const k = (rec.fields || {})['Key']; if (k) doneKeys.add(k); });
    } catch (e) {}

    if (b.action === 'open') {
      // My published updates, newest first, inside the window.
      const cutoff = new Date(Date.now() - QUIET_DAYS * 86400000).toISOString().slice(0, 10);
      const f = encodeURIComponent(`AND({Status}='Published', FIND('${nameEsc}', ARRAYJOIN({Missionary}))>0)`);
      const ur = await fetch(`https://api.airtable.com/v0/${BASE}/${UPDATES}?pageSize=100&filterByFormula=${f}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`, { headers: auth });
      if (!ur.ok) return r(200, { ok: true, items: [] });
      const recs = ((await ur.json()).records || []);

      const items = [];
      for (const rec of recs) {
        const c = rec.fields || {};
        const date = c['Date'] || '';
        if (date && date < cutoff) break;                       // older than the window — retire quietly
        if (/^__.*__$/.test(String(c['Title'] || '').trim())) continue;
        let blocks = []; try { blocks = JSON.parse(c['Blocks'] || '[]'); } catch (e) {}
        blocks.forEach((bk, i) => {
          if (!bk || bk.type !== 'prayer') return;
          const text = String(bk.text || '').trim();
          if (!text) return;
          const key = rec.id + ':' + i;
          if (doneKeys.has(key)) return;                        // already answered or set aside
          items.push({ key, updateId: rec.id, block: i, title: c['Title'] || '', date, text: text.slice(0, 400) });
        });
        if (items.length >= ASK_LIMIT * 3) break;
      }

      // How many people prayed on those updates — the number that makes it matter.
      const ids = [...new Set(items.map(x => x.updateId))].slice(0, 20);
      const prayed = {};
      if (ids.length) {
        const or = 'OR(' + ids.map(id => `{Update ID}='${id}'`).join(',') + ')';
        const rr = await fetch(`https://api.airtable.com/v0/${BASE}/${RESPONSES}?pageSize=100&filterByFormula=${encodeURIComponent(`AND({Type}='Prayer', ${or})`)}`, { headers: auth });
        if (rr.ok) ((await rr.json()).records || []).forEach(rec => {
          const c = rec.fields || {};
          const id = c['Update ID']; if (!id) return;
          (prayed[id] = prayed[id] || new Set()).add((c['Email'] || c['Name'] || '').toLowerCase());
        });
      }
      items.forEach(x => { x.prayed = (prayed[x.updateId] ? prayed[x.updateId].size : 0); });

      // Ask about the ones people actually prayed for, oldest first (most likely resolved).
      items.sort((a, z) => (z.prayed - a.prayed) || String(a.date).localeCompare(String(z.date)));
      return r(200, { ok: true, items: items.slice(0, ASK_LIMIT) });
    }

    if (b.action === 'resolve') {
      const key = String(b.key || '');
      if (!/^rec[a-zA-Z0-9]{14}:\d+$/.test(key)) return r(400, { error: 'Which request?' });
      const [updateId] = key.split(':');
      const status = ['Answered', 'Still praying', 'Went another way'].includes(b.status) ? b.status : null;
      if (!status) return r(400, { error: 'Unknown outcome.' });
      const outcome = String(b.outcome || '').trim().slice(0, 900);

      // Who prayed on that update — the people this news belongs to.
      let people = [];
      try {
        const rr = await fetch(`https://api.airtable.com/v0/${BASE}/${RESPONSES}?pageSize=100&filterByFormula=${encodeURIComponent(`AND({Type}='Prayer',{Update ID}='${updateId}')`)}`, { headers: auth });
        if (rr.ok) people = ((await rr.json()).records || []).map(rec => {
          const c = rec.fields || {};
          return { name: c['Name'] || 'friend', email: (c['Email'] || '').trim() };
        }).filter(p => p.email);
      } catch (e) {}
      // One note per person, even if they prayed more than once.
      const seen = new Set();
      people = people.filter(p => { const k = p.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });

      // Title + the request text, for the record and the note.
      let title = '', text = String(b.text || '').slice(0, 400);
      try {
        const gr = await fetch(`https://api.airtable.com/v0/${BASE}/${UPDATES}/${updateId}`, { headers: auth });
        if (gr.ok) { const c = ((await gr.json()).fields) || {}; title = c['Title'] || ''; }
      } catch (e) {}

      let told = 0;
      const shouldTell = !!b.notify && status !== 'Still praying' && !!outcome;
      if (shouldTell) {
        const site = process.env.SITE_BASE || '';
        for (const p of people) {
          try {
            const res = await sendMail({
              to: p.email,
              subject: status === 'Answered' ? `Answered: the prayer you prayed` : `An update on the prayer you prayed`,
              html: `<div style="font-family:-apple-system,Arial,sans-serif;max-width:540px;color:#241f1b">
                <p style="font-size:15px">Hi ${esc((p.name || '').split(' ')[0] || 'friend')},</p>
                <p style="font-size:14.5px;line-height:1.6">You prayed${title ? ` after reading <b>${esc(title)}</b>` : ''}. ${esc(me.name)} wanted you to know what happened.</p>
                ${text ? `<blockquote style="border-left:3px solid #d8cdb6;margin:0 0 14px;padding:6px 0 6px 14px;color:#6b6357;font-size:13.5px;line-height:1.55">You prayed: ${esc(text)}</blockquote>` : ''}
                <div style="font-size:15px;line-height:1.65;white-space:pre-wrap;border-left:3px solid #FF6600;padding:8px 0 8px 15px">${esc(outcome)}</div>
                <p style="font-size:12.5px;color:#7a756f;margin-top:18px">Thank you for praying. It mattered.</p>
                ${site ? `<p style="font-size:12px;color:#7a756f">— ${esc(me.name)} via Co·labr</p>` : ''}
              </div>`,
              replyTo: sess.email || '', fromName: `${me.name} via Co·labr`
            });
            if (res && res.ok) told++;
          } catch (e) {}
        }
      }

      // Record it so we never ask about this one again.
      await fetch(`https://api.airtable.com/v0/${BASE}/${PRAYERS}`, { method: 'POST', headers: auth,
        body: JSON.stringify({ fields: {
          'Key': key, 'Missionary': me.name, 'Update ID': updateId, 'Update Title': title,
          'Text': text, 'Status': status, 'Outcome': outcome,
          'Resolved On': new Date().toISOString(), 'Told': told
        }, typecast: true }) });

      return r(200, { ok: true, told, couldTell: people.length, status });
    }

    return r(400, { error: 'Unknown action.' });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
