// Co·labr — one message a day, only when something actually broke.
//
// Recording faults is useless if nobody looks at the table. This reads yesterday's
// errors, groups them so a fault that happened forty times is one line rather than
// forty, and mails the admins. Silence means a clean day, so an empty inbox is
// information rather than an unanswered question.
const { sendMail, esc } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const EVENTS = 'tbl2Dm5W07cAMrJgs';

exports.handler = async function () {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return { statusCode: 200, body: 'no token' };
  const auth = { Authorization: 'Bearer ' + token };

  try {
    const since = encodeURIComponent(
      "AND(OR({Kind}='Error',{Kind}='CSP'),DATETIME_DIFF(NOW(),CREATED_TIME(),'hours')<24)"
    );
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${EVENTS}?filterByFormula=${since}&pageSize=100`, { headers: auth });
    if (!r.ok) return { statusCode: 200, body: 'query failed' };
    const recs = ((await r.json()).records) || [];
    if (!recs.length) return { statusCode: 200, body: 'quiet day' };   // say nothing

    const groups = {};
    recs.forEach(rec => {
      const f = rec.fields || {};
      const key = (f['Kind'] || '?') + ' · ' + String(f['Update ID'] || '').slice(0, 150);
      groups[key] = (groups[key] || 0) + 1;
    });
    const rows = Object.entries(groups).sort((a, b) => b[1] - a[1]);

    const html = `<div style="font-family:-apple-system,Arial,sans-serif;max-width:620px;color:#0D1B2A">
      <p style="font-size:15px;line-height:1.6">Yesterday Co&middot;labr recorded <b>${recs.length}</b>
      ${recs.length === 1 ? 'thing' : 'things'} worth a look, in ${rows.length} distinct
      ${rows.length === 1 ? 'kind' : 'kinds'}.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13.5px">
        ${rows.map(([k, n]) => `<tr>
          <td style="padding:8px 10px 8px 0;border-bottom:1px solid #eee;text-align:right;width:44px;color:#A3231B;font-weight:700">${n}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;font-family:ui-monospace,Menlo,monospace">${esc(k)}</td>
        </tr>`).join('')}
      </table>
      <p style="font-size:12.5px;color:#7d8794;line-height:1.6;margin-top:18px">
        CSP lines are report-only and mean the policy WOULD have blocked something, not that
        anything broke. Error lines are real failures. No message tomorrow means a clean day.</p>
    </div>`;

    const to = (process.env.ADMIN_EMAILS || 'mellenwood@josiahventure.com')
      .split(',').map(s => s.trim()).filter(Boolean)[0];
    await sendMail({ to, subject: `Co·labr: ${recs.length} thing${recs.length === 1 ? '' : 's'} to look at`, html, fromName: 'Co·labr' });
    return { statusCode: 200, body: 'sent ' + recs.length };
  } catch (e) {
    return { statusCode: 200, body: 'digest failed: ' + String(e && e.message) };
  }
};
