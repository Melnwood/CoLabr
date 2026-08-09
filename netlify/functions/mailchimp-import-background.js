// Co·labr — step 2 of the self-serve Mailchimp migration (background, up to 15 min).
// For each chosen campaign: fetch its HTML from Mailchimp, parse it into Co·labr
// blocks (the same parser that rebuilt the Ellenwoods' 78-update history), and
// create the update on the member's page. SAFE BY DESIGN:
//  - idempotent — a campaign that already exists is skipped, rerunning is free
//  - every import claims the "already sent" flag, so NO email path can ever
//    re-send someone's old newsletters
//  - the API key lives only inside this one invocation
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const { htmlToBlocks } = require('./_htmlblocks');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';
const SENT_FLAG = 'fldLIEGYuHv5G1iC2';   // "claimed sent" — blocks every send path

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return;
    const sess = sessionFromEvent(event);
    if (!sess) return;
    const token = process.env.AIRTABLE_TOKEN;
    if (!token) return;
    const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

    let b; try { b = JSON.parse(event.body || '{}'); } catch { return; }
    const apiKey = (b.apiKey || '').toString().trim();
    const m = apiKey.match(/-([a-z]{2,4}\d+)$/i);
    if (!m) return;
    const dc = m[1];
    const mcAuth = 'Basic ' + Buffer.from('anystring:' + apiKey).toString('base64');
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter(x => /^[a-z0-9]{6,20}$/i.test(x)).slice(0, 500);

    let me = null;
    try { me = await missByEmail({ Authorization: 'Bearer ' + token }, sess.email); } catch (e) {}
    if (!me || !me.name) { console.log('mc-import: no page for', sess.email); return; }

    let created = 0, skipped = 0, failed = 0;
    for (const id of ids) {
      try {
        // Already in? Skip — rerunning the wizard is always safe.
        const df = encodeURIComponent(`{Mailchimp ID}='${id}'`);
        const dr = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?maxRecords=1&filterByFormula=${df}`, { headers: auth });
        if (dr.ok && ((((await dr.json()).records) || []).length)) { skipped++; continue; }

        const [cr, hr] = await Promise.all([
          fetch(`https://${dc}.api.mailchimp.com/3.0/campaigns/${id}?fields=send_time,settings.subject_line,settings.title,report_summary.unique_opens`, { headers: { Authorization: mcAuth } }),
          fetch(`https://${dc}.api.mailchimp.com/3.0/campaigns/${id}/content?fields=html`, { headers: { Authorization: mcAuth } })
        ]);
        if (!cr.ok || !hr.ok) { failed++; continue; }
        const meta = await cr.json(); const html = ((await hr.json()).html) || '';
        if (!html) { failed++; continue; }

        const { cover, blocks } = htmlToBlocks(html, { cover: '' });
        const firstText = (blocks.find(x => x.type === 'text' && x.text) || {}).text || '';
        const title = (meta.settings && (meta.settings.subject_line || meta.settings.title)) || '(untitled)';
        const fields = {
          'Title': String(title).slice(0, 200),
          'Status': 'Published',
          'Source': 'Mailchimp import',
          'Missionary': [me.name],
          'Date': String(meta.send_time || '').slice(0, 10),
          'Blocks': JSON.stringify(blocks),
          'Excerpt': String(firstText).replace(/\s+/g, ' ').trim().slice(0, 240),
          'Opens': (meta.report_summary && meta.report_summary.unique_opens) || 0,
          'Mailchimp ID': id,
          [SENT_FLAG]: true
        };
        if (cover) { fields['Cover Image URL'] = cover; fields['Cover Focus'] = '50% 35%'; }
        const wr = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'POST', headers: auth,
          body: JSON.stringify({ fields, typecast: true }) });
        if (wr.ok) created++; else { failed++; console.log('mc-import create failed', id, (await wr.text()).slice(0, 200)); }
      } catch (e) { failed++; console.log('mc-import error', id, String(e && e.message || e)); }
    }
    console.log('mc-import done', JSON.stringify({ page: me.name, created, skipped, failed, of: ids.length }));
  } catch (e) { console.log('mc-import EXCEPTION', String(e && e.message || e)); }
};
