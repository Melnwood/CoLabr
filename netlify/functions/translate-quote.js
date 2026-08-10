// Co·labr — "Translate my history" offer. GET: how many of MY past updates still
// need translating, priced from the platform setting. POST: the member accepts —
// logged to the Support queue (shows in Super Admin → Help-chat questions) and
// emailed to the team, who run the translation and bill the ministry account.
// No card is charged here; acceptance is explicit consent to be billed.
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const { sendMail, esc } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';
const SETTINGS = 'tblnAJuAOg7pmlVFR';
const CHAT = 'tbl2fdiuKTDNyjVpR';
const LANGS = ['cs', 'pl', 'uk', 'sk', 'ro', 'bg', 'sl', 'lv', 'et', 'hu', 'sr', 'de', 'es'];

exports.handler = async function (event) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const sess = sessionFromEvent(event);
  if (!sess) return r(401, { error: 'Please sign in.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  let me = null;
  try { me = await missByEmail({ Authorization: 'Bearer ' + token }, sess.email); } catch (e) {}
  if (!me || !me.name) return r(403, { error: 'Your page isn\'t set up yet.' });
  const nameEsc = String(me.name).replace(/'/g, "\\'");

  try {
    // Count this member's published updates whose inline index is missing languages.
    let count = 0, total = 0;
    let url = `https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100&filterByFormula=${encodeURIComponent(`AND({Status}='Published', FIND('${nameEsc}', ARRAYJOIN({Missionary}))>0)`)}&fields%5B%5D=Title&fields%5B%5D=TR`;
    while (url) {
      const rr = await fetch(url, { headers: auth }); if (!rr.ok) break;
      const d = await rr.json();
      (d.records || []).forEach(rec => {
        const c = rec.fields || {};
        if (/^__.*__$/.test(String(c['Title'] || '').trim())) return;
        total++;
        let tr = {}; try { tr = (JSON.parse(c['TR'] || '{}').tr) || {}; } catch (e) {}
        if (LANGS.some(l => !tr[l])) count++;
      });
      url = d.offset ? url.split('&offset=')[0] + '&offset=' + d.offset : '';
    }

    // The price Mel set (blank = offer without a number).
    let per = null;
    try {
      const sr = await fetch(`https://api.airtable.com/v0/${BASE}/${SETTINGS}?maxRecords=1`, { headers: auth });
      if (sr.ok) { const rec = (((await sr.json()).records) || [])[0]; const v = rec && rec.fields && rec.fields['History translate price per update']; if (typeof v === 'number') per = v; }
    } catch (e) {}

    if (event.httpMethod === 'GET') {
      return r(200, { ok: true, count, total, per, price: per != null ? Math.round(per * count * 100) / 100 : null });
    }

    if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
    if (!count) return r(400, { error: 'Everything is already translated — nothing to order.' });
    const price = per != null ? `$${(per * count).toFixed(2)}` : 'pricing to be confirmed';
    const msgText = `HISTORY TRANSLATION ORDER: ${count} past updates → all 13 languages. Quoted: ${price}. Member accepted billing to their ministry account.`;
    await fetch(`https://api.airtable.com/v0/${BASE}/${CHAT}`, { method: 'POST', headers: auth,
      body: JSON.stringify({ fields: { 'Name': me.name, 'Email': sess.email || '', 'Message': msgText, 'Page': me.name, 'Status': 'New' }, typecast: true }) });
    try {
      const admins = (process.env.ADMIN_EMAILS || 'mellenwood@josiahventure.com').split(',').map(s => s.trim()).filter(Boolean);
      await sendMail({
        to: admins[0], subject: `Translation order: ${me.name} — ${count} updates (${price})`,
        html: `<div style="font-family:-apple-system,Arial,sans-serif;max-width:520px;color:#241f1b">
          <p style="font-size:15px"><b>${esc(me.name)}</b> ordered their history translated: <b>${count}</b> past updates into all 13 languages — <b>${esc(price)}</b>, billed to their ministry account (they accepted in-app).</p>
          <p style="font-size:13px;color:#7a756f">Run it, then mark the order handled in Super Admin → Help-chat questions.</p>
        </div>`,
        replyTo: sess.email || '', fromName: 'Co-Labr Orders'
      });
    } catch (e) {}
    return r(200, { ok: true, count, price });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
