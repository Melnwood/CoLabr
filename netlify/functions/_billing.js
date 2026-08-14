// Co·labr — the trial clock, and everything that hangs off it.
//
// The shape Mel asked for:
//   day 0–13   trial      everything works
//   day 14–27  frozen     the wall keeps working for supporters — reading, praying,
//                         giving all continue. The missionary can't publish, send,
//                         invite or import until they pay. Nobody's supporters get
//                         punished for a lapsed card.
//   day 28     hidden     the page goes dark. Their whole archive has already been
//                         emailed to them by then. A restore is one payment away.
//   day 90     deleted    permanently, and only then.
//
// Two things can stop the clock forever: the account is covered by a paying
// organization (JV staff — they are never on a trial and can never be wiped), or
// somebody paid.
//
// NOTHING IN HERE DOES ANYTHING until "Billing enforcement" is ticked in Platform
// Settings. It ships off. A system that hides pages and deletes archives should
// have to be switched on deliberately, once, by a person.

const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const MISS = 'tbli1L8AO0JUDL7Wl';
const SETTINGS = 'tblnAJuAOg7pmlVFR';

const TRIAL_DAYS = 14;    // free
const FREEZE_DAY = 28;    // frozen from 14, hidden at 28
const DELETE_DAY = 90;    // hidden for 62 days, then gone

// Field names on the Missionaries record. Written with typecast so Airtable
// accepts them as plain text/date/checkbox without us pinning field ids.
const F = {
  start: 'Trial Start',
  paidUntil: 'Paid Until',
  covered: 'Org Covered',
  hiddenOn: 'Hidden On',
  archiveSent: 'Archive Sent',
  archiveUrl: 'Archive URL',
  notified: 'Billing Notified'   // which warnings have already gone out, e.g. "7,12,14"
};

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
function daysSince(iso, from) {
  if (!iso) return 0;
  const a = new Date(iso + 'T12:00:00Z'), b = new Date((from || today()) + 'T12:00:00Z');
  return Math.floor((b - a) / 86400000);
}

// The one place that decides what an account is. Everything else asks this.
// Deliberate order: covered beats everything, then paid — so paying always
// restores a hidden page without anyone having to clear a flag by hand.
function stateOf(fields, from) {
  const f = fields || {}, now = from || today();

  if (f[F.covered]) return { state: 'covered', canWrite: true, canRead: true };

  const paidUntil = String(f[F.paidUntil] || '').slice(0, 10);
  if (paidUntil && paidUntil >= now) {
    return { state: 'paid', canWrite: true, canRead: true, paidUntil, daysLeft: daysSince(now, paidUntil) };
  }

  const start = String(f[F.start] || '').slice(0, 10);
  // No clock has ever been started. Treat as a fresh trial rather than as expired —
  // an account must never be punished for a field nobody filled in.
  if (!start) return { state: 'trial', canWrite: true, canRead: true, day: 0, daysLeft: TRIAL_DAYS };

  const day = daysSince(start, now);
  const hiddenOn = String(f[F.hiddenOn] || '').slice(0, 10);

  if (hiddenOn) {
    return day >= DELETE_DAY
      ? { state: 'due-delete', canWrite: false, canRead: false, day, hiddenOn }
      : { state: 'hidden', canWrite: false, canRead: false, day, hiddenOn, deleteOn: addDays(start, DELETE_DAY) };
  }
  if (day < TRIAL_DAYS) {
    return { state: 'trial', canWrite: true, canRead: true, day, daysLeft: TRIAL_DAYS - day, freezeOn: addDays(start, TRIAL_DAYS) };
  }
  if (day < FREEZE_DAY) {
    return { state: 'frozen', canWrite: false, canRead: true, day, daysLeft: FREEZE_DAY - day, hideOn: addDays(start, FREEZE_DAY) };
  }
  return { state: 'due-hide', canWrite: false, canRead: true, day };
}

// Is the whole system armed? Cached briefly — this is read on every write.
let _enfCache = null, _enfAt = 0;
async function enforcing(auth) {
  if (_enfCache !== null && Date.now() - _enfAt < 60000) return _enfCache;
  let on = false;
  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${SETTINGS}?maxRecords=1`, { headers: auth });
    if (r.ok) {
      const rec = (((await r.json()).records) || [])[0];
      on = !!(rec && rec.fields && rec.fields['Billing enforcement']);
    }
  } catch (e) {}
  _enfCache = on; _enfAt = Date.now();
  return on;
}

// What a write endpoint calls. Returns null when the write may proceed, or a
// ready-to-return 402 when it may not. Fails OPEN on any error: a wobble talking
// to Airtable must never lock a paying missionary out of their own page.
async function blockWrite(token, email) {
  try {
    if (!token || !email) return null;
    const auth = { Authorization: 'Bearer ' + token };
    if (!(await enforcing(auth))) return null;

    const rec = await recordFor(auth, email);
    if (!rec) return null;
    const st = stateOf(rec.fields);
    if (st.canWrite) return null;

    const msg = st.state === 'frozen' || st.state === 'due-hide'
      ? 'Your free trial has ended. Your wall is still up and your supporters can still read, pray and give — publishing and sending start again as soon as your subscription is active.'
      : 'This page is paused. Everything is still safe and one payment restores it.';
    return { statusCode: 402, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: msg, billing: st.state, frozen: true }) };
  } catch (e) { return null; }
}

async function recordFor(auth, email) {
  const e = String(email || '').trim().toLowerCase().replace(/'/g, "\\'");
  if (!e) return null;
  const f = encodeURIComponent(`OR(LOWER({Email})='${e}', FIND('${e}', LOWER({Email}))>0)`);
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${MISS}?maxRecords=1&filterByFormula=${f}`, { headers: auth });
  if (!r.ok) return null;
  return (((await r.json()).records) || [])[0] || null;
}

module.exports = { stateOf, blockWrite, enforcing, recordFor, daysSince, addDays, today,
  F, BASE, MISS, SETTINGS, TRIAL_DAYS, FREEZE_DAY, DELETE_DAY };
