// Co·labr — step 1 of the self-serve Mailchimp migration. The member pastes their
// own Mailchimp API key; we list every SENT campaign so they can choose what to
// bring over. The key is used for this call only — never stored anywhere.
// Also: action 'progress' reports how many of a set of campaigns exist as updates
// yet, so the wizard can show live progress while the import runs.
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const sess = sessionFromEvent(event);
  if (!sess) return r(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token };

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }

  try {
    if (b.action === 'progress') {
      const ids = (Array.isArray(b.ids) ? b.ids : []).filter(x => /^[a-z0-9]{6,20}$/i.test(x)).slice(0, 500);
      if (!ids.length) return r(200, { ok: true, done: 0 });
      let done = 0;
      for (let i = 0; i < ids.length; i += 30) {
        const or = 'OR(' + ids.slice(i, i + 30).map(id => `{Mailchimp ID}='${id}'`).join(',') + ')';
        const fr = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100&filterByFormula=${encodeURIComponent(or)}&fields%5B%5D=Title`, { headers: auth });
        if (fr.ok) done += (((await fr.json()).records) || []).length;
      }
      return r(200, { ok: true, done });
    }

    // Default: scan their Mailchimp for sent campaigns.
    const apiKey = (b.apiKey || '').toString().trim();
    const m = apiKey.match(/-([a-z]{2,4}\d+)$/i);
    if (!m) return r(400, { error: 'That doesn\'t look like a Mailchimp API key — it ends with something like “-us21”.' });
    const dc = m[1];
    const mcAuth = 'Basic ' + Buffer.from('anystring:' + apiKey).toString('base64');
    const mr = await fetch(`https://${dc}.api.mailchimp.com/3.0/campaigns?status=sent&count=1000&sort_field=send_time&sort_dir=DESC&fields=campaigns.id,campaigns.send_time,campaigns.settings.subject_line,campaigns.settings.title,campaigns.report_summary.unique_opens,total_items`, { headers: { Authorization: mcAuth } });
    if (mr.status === 401) return r(401, { error: 'Mailchimp said that key isn\'t valid — copy it again and check nothing is missing.' });
    if (!mr.ok) return r(502, { error: 'Mailchimp did not answer (' + mr.status + '). Try again in a minute.' });
    const md = await mr.json();
    const campaigns = (md.campaigns || []).map(c => ({
      id: c.id,
      title: (c.settings && (c.settings.subject_line || c.settings.title)) || '(untitled)',
      sent: c.send_time || '',
      opens: (c.report_summary && c.report_summary.unique_opens) || 0
    })).filter(c => c.sent);

    // Which are already in Co·labr? (any missionary — a campaign imports once)
    const doneIds = new Set();
    for (let i = 0; i < campaigns.length; i += 30) {
      const or = 'OR(' + campaigns.slice(i, i + 30).map(c => `{Mailchimp ID}='${c.id}'`).join(',') + ')';
      const fr = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100&filterByFormula=${encodeURIComponent(or)}&fields%5B%5D=Mailchimp%20ID`, { headers: auth });
      if (fr.ok) (((await fr.json()).records) || []).forEach(rec => doneIds.add((rec.fields || {})['Mailchimp ID']));
    }
    campaigns.forEach(c => { c.done = doneIds.has(c.id); });

    let page = '';
    try { const me = await missByEmail(auth, sess.email); page = (me && me.name) || ''; } catch (e) {}
    return r(200, { ok: true, campaigns, total: md.total_items || campaigns.length, page });
  } catch (e) {
    return r(502, { error: 'Could not reach Mailchimp.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
