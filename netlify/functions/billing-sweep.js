// Co·labr — the daily trial-clock pass, on the Netlify scheduler (see netlify.toml).
// Netlify blocks direct HTTP to scheduled functions, so the run-it-now path lives
// in billing-sweep-now.js. Both share _billingsweep.js.
//
// This does nothing at all until "Billing enforcement" is ticked in Platform
// Settings. Until then it wakes up, sees the switch is off, and goes back to sleep.
const { runSweep } = require('./_billingsweep');

exports.handler = async function (event) {
  let scheduled = false;
  try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (e) {}
  if (!scheduled) return { statusCode: 401, body: '{}' };
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return { statusCode: 500, body: '{}' };
  try {
    const out = await runSweep({ token, only: '', dry: false });
    console.log('billing-sweep', JSON.stringify(out));
  } catch (e) { console.log('billing-sweep EXCEPTION', String(e && e.message || e)); }
  return { statusCode: 200, body: '{}' };
};
