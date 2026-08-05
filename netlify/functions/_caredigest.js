// Co-Labr — shared Care-digest core: run the last-day scan, build the morning email,
// send it to the care list. Used by care-digest.js (scheduler) and care-digest-now.js
// (the admin "Email me this now" button — scheduled functions can't be called over HTTP).
const { careScan } = require('./_care');
const { sendMail } = require('./_mail');

const SITE = process.env.SITE_BASE || 'https://colabr.netlify.app';
const CAT_COLORS = {
  'Death':        ['#241f1b', '#ffffff'],
  'Baby':         ['#fde8ef', '#c2185b'],
  'Hard news':    ['#fdeaea', '#b02a25'],
  'Exciting news':['#e7f6ee', '#2f9e63'],
  'Big change':   ['#e8f0fb', '#2f6df0']
};
const RANK = { 'Death': 0, 'Baby': 1, 'Hard news': 2, 'Big change': 3, 'Exciting news': 4 };

async function runDigest() {
  const token = process.env.AIRTABLE_TOKEN;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!token || !key) throw new Error('Server not configured.');
  const recipients = (process.env.CARE_DIGEST_EMAILS || 'mellenwood@josiahventure.com')
    .split(',').map(s => s.trim()).filter(Boolean);

  // Only updates dated within the last day — yesterday's news, not a rolling repeat.
  const { items, scanned } = await careScan({ token, key, days: 1, windowOnly: true });
  items.sort((a, b) => Math.min(...a.categories.map(c => RANK[c])) - Math.min(...b.categories.map(c => RANK[c])));

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const subject = items.length
    ? `Care radar — ${items.length} thing${items.length === 1 ? '' : 's'} to see this morning`
    : 'Care radar — all clear this morning';
  const html = renderEmail(today, items, scanned);

  const results = [];
  for (const to of recipients) {
    const res = await sendMail({ to, subject, html, fromName: 'Co-Labr Care Radar' });
    results.push({ to, ok: res.ok, via: res.via || '', error: res.error || '' });
  }
  return { sent: results.filter(x => x.ok).length, flagged: items.length, scanned, results };
}

function chip(c) {
  const [bg, fg] = CAT_COLORS[c] || ['#eee', '#333'];
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:3px 9px;border-radius:12px;margin-right:5px">${esc(c)}</span>`;
}
function renderEmail(today, items, scanned) {
  const body = items.length
    ? items.map(i => `
      <div style="background:#ffffff;border:1px solid #e7e0d6;border-radius:12px;padding:15px 17px;margin:0 0 12px">
        <div style="margin-bottom:7px">${i.categories.sort((a, b) => RANK[a] - RANK[b]).map(chip).join('')}</div>
        <div style="font-size:15px;font-weight:700;color:#241f1b;margin-bottom:2px">${esc(i.author)}</div>
        <div style="font-size:12px;color:#7a6c58;margin-bottom:8px">&ldquo;${esc(i.title)}&rdquo; &middot; ${esc(i.date)}</div>
        <div style="font-size:14px;line-height:1.55;color:#3c3733;margin-bottom:7px">${esc(i.note)}</div>
        ${i.quote ? `<div style="font-size:13px;font-style:italic;color:#7a6c58;border-left:3px solid #e7e0d6;padding:2px 0 2px 12px;margin-bottom:9px">&ldquo;${esc(i.quote)}&rdquo;</div>` : ''}
        <a href="${SITE}/index.html?m=${encodeURIComponent(i.author)}" style="font-size:12.5px;font-weight:700;color:#FF6600;text-decoration:none">Open ${esc(i.author)}&rsquo;s page &rarr;</a>
      </div>`).join('')
    : `<div style="background:#e7f6ee;border:1px solid #bfe6d0;border-radius:12px;padding:16px 18px;font-size:14px;color:#215c3c">
        Nothing needing your attention in the last day &mdash; no hard news, big changes, babies, or losses in anyone&rsquo;s new updates.</div>`;
  return `
  <div style="background:#f4f1ec;padding:28px 14px;font-family:'Open Sans',system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto">
      <div style="font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#FF6600;margin-bottom:4px">Care radar</div>
      <div style="font-size:20px;font-weight:800;color:#241f1b;margin-bottom:2px">${esc(today)}</div>
      <div style="font-size:12.5px;color:#7a6c58;margin-bottom:16px">${scanned} new update${scanned === 1 ? '' : 's'} scanned from the last day</div>
      ${body}
      <div style="font-size:11.5px;color:#8a7550;margin-top:16px;line-height:1.6">
        The full picture is on your <a href="${SITE}/care.html" style="color:#8a7550">Care radar</a> page.
        This email goes to the care list &mdash; you for now.</div>
    </div>
  </div>`;
}
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

module.exports = { runDigest };
