// Co·labr — the monthly prayer update, on the Netlify scheduler (see netlify.toml).
// Netlify blocks direct HTTP to scheduled functions, so the "build it now" path
// lives in prayer-monthly-now.js. Both share _prayermonthly.js.
//
// On the 1st, the month's prayer requests and anything answered become a ready-made
// DRAFT update — same banner, tagged "Prayer update" so a supporter can filter the
// wall and read a year of prayer in one column. Never published in their name
// behind their back: their wall, their words, one tap.
const { runMonthly } = require('./_prayermonthly');

exports.handler = async function (event) {
  let scheduled = false;
  try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (e) {}
  if (!scheduled) return { statusCode: 401, body: '{}' };
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return { statusCode: 500, body: '{}' };
  try {
    const out = await runMonthly({ token, only: '' });
    console.log('prayer-monthly', JSON.stringify(out));
  } catch (e) { console.log('prayer-monthly EXCEPTION', String(e && e.message || e)); }
  return { statusCode: 200, body: '{}' };
};
