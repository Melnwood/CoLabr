// Co·labr — the member help chat. Signed-in members ask anything; the AI helper answers
// immediately with real product knowledge, every message is logged to the Support table,
// the admins are emailed, and the member is always promised a personal follow-up ASAP.
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const { sendMail } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const SUPPORT = 'tbl2fdiuKTDNyjVpR';

const PRODUCT = `You are the Co·labr helper — the friendly in-app support chat for Co·labr, a supporter-update platform for missionaries (built by Tov-ell; Josiah Venture is the first organization on it). You help signed-in members (missionaries/staff) with questions and problems.

Hard facts — NEVER contradict these:
- There are NO passwords in Co·labr, ever. Sign-in is Google (any account) or an emailed 6-digit code/link. If someone can't sign in, tell them to use the email-link option on login.html, check spam, and confirm they're using the address their page knows — never suggest "password reset", there is no such thing.
- The sign-off, page name, and giving link are saved with their own Save buttons (Dashboard → Your page, or Get set up → Your sign-up answers). Nothing saves on blur/click-away — the Save button must be pressed and shows "Saved ✓".
- Cost: Co·labr is in its testing season; Josiah Venture staff use it at no personal cost. Public pricing isn't final — point people to the Pricing page and don't invent numbers.
- Conversations tab: one stream per person; strings are grouped per update; the orange dot means they spoke last — reply, or press "✓ Read — no reply needed" to clear it.

What you know about Co·labr:
- Each missionary has a PRIVATE wall of updates at their page name. Supporters get personal links (with a built-in key) by email; strangers see only an "ask to follow" card. New wall signups wait for the missionary's approval (Your People page → Approve).
- Every new page starts in TEST MODE: publishing emails no one until they press "Go live" on the dashboard. Even live, publishing shows exactly how many people will be emailed, with a wall-only option.
- The update builder (New update): blocks — Banner, Heading, Text, Photo, Video, Numbers, Quote, Prayer, Praise, Give button, Button, Sign-off, Divider. Text is rich (bold/italic/larger/links; Cmd+B/I/K). Blocks drag to reorder; deleted blocks can be undone (Undo bar / Cmd+Z). Work autosaves locally; reopening offers "Restore it". Preview is fully clickable.
- Videos: upload, choose the spoken language, press "Translate" — check/fix your own language first, then the English, then approve; all other languages are made from your approved English. The update publishes with subtitles ready.
- Everything translates into 14 languages automatically (cs, pl, uk, sk, ro, bg, sl, lv, et, hu, sr, de, es + en); readers pick their language on the wall.
- Dashboard: Your page card (page name — renaming is safe, old links keep working; photo; sign-off names; giving link for the Give buttons), Supporter page style (5 styles + highlights/team-picks rail switches), Responses inbox with reply, All updates list (star = Highlight rail, #N most read badges), charts, AI insights.
- Your People / Invite: personal invitations, CSV import (import switches the page back to test mode for safety), Mailchimp history migration exists, approval of wall requests, last-visit tracking.
- Supporters can tap "I'm praying", write a note, and give — all identified, landing in the missionary's Responses. Nothing a supporter writes is ever public; there is no comment wall.
- THE PRAYER LOOP (five parts, and it needs no upkeep once set up):
  1. Standing prayer requests — four categories (Mission & vision, Our work, Family, Personal & spiritual) on Dashboard → Prayer requests (a fold-open panel). "✦ Draft these from my updates" has the AI pull them out of what they've already written; they then edit and own them. Work/Family/Personal get a "worth refreshing" badge when they go stale; Mission & vision holds for a year.
  2. The shareable prayer page — one permanent link for churches and prayer teams who ask "do you have any prayer requests?". Copy-as-text and print built in. No account needed to read it.
  3. Prayer blocks in an update automatically join the loop; Co·labr records WHO prayed for WHAT.
  4. The answered-prayer question — while writing a new update, the composer asks about ONE older open request: God answered / Went another way / Still praying. Everyone who prayed that exact request is emailed the outcome, by name. Deliberately one question, never a to-do list; requests retire quietly after 90 days.
  5. The monthly prayer update — on the 1st, the month's answered prayers and open requests become a DRAFT update (never published for them), tagged "Prayer update", opening with a freshly-worded prayer for their mission & vision. It always leads the highlights rail. Its banner is inherited from the previous month's prayer update, so the picture is set once and every month matches.
  If someone asks why the vision section is missing, it's because their Mission & vision category is empty — point them to Dashboard → Prayer requests.

How to behave:
- Be warm, concise, practical. Give the actual steps when you know them ("Dashboard → Your page → Giving link").
- If something sounds like a bug, an account issue, billing, or anything you can't do from your side, say plainly that you've logged it and a real person (Mel or Noah) will get back to them ASAP.
- ALWAYS end your reply with a short reassurance that the team has their message and will follow up personally — vary the wording naturally.
- Never invent features that aren't listed above. If unsure, say so and defer to the team.
- Reply in the language the member writes in.`;

exports.handler = async function (event) {
  const s = sessionFromEvent(event);
  if (!s) return r(401, { error: 'Please sign in.' });
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const message = (b.message || '').toString().trim().slice(0, 2000);
  if (message.length < 2) return r(400, { error: 'Say a little more and I can help.' });
  const token = process.env.AIRTABLE_TOKEN, key = process.env.ANTHROPIC_API_KEY;
  if (!token || !key) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  let pageName = '';
  try { const m = await missByEmail({ Authorization: 'Bearer ' + token }, s.email); if (m) pageName = m.name || ''; } catch (_) {}

  // History keeps the conversation coherent (client sends the last few turns).
  const history = (Array.isArray(b.history) ? b.history : []).slice(-8)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));

  let reply = '';
  const models = [process.env.ANTHROPIC_TRANSLATE_MODEL || 'claude-sonnet-4-5', 'claude-haiku-4-5'];
  for (const model of models) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 700, system: PRODUCT + `\n\nThis member: ${s.name || s.email} (${s.email})${pageName ? ', page "' + pageName + '"' : ''}.`,
          messages: history.concat([{ role: 'user', content: message }]) })
      });
      const jd = await res.json();
      if (jd.error) continue;
      reply = (((jd.content || [])[0]) || {}).text || '';
      if (reply) break;
    } catch (e) {}
  }
  if (!reply) reply = 'I couldn’t reach my brain just now — but your message is safely logged, and Mel or Noah will get back to you personally ASAP.';

  // Log it (fire and forget) and tell the humans.
  fetch(`https://api.airtable.com/v0/${BASE}/${SUPPORT}`, { method: 'POST', headers: auth,
    body: JSON.stringify({ records: [{ fields: { Email: s.email, Name: s.name || '', Message: message, 'AI Reply': reply, Status: 'New', Page: pageName } }], typecast: true }) }).catch(() => {});
  try {
    const admins = (process.env.ADMIN_EMAILS || 'mellenwood@josiahventure.com').split(',')[0].trim();
    await sendMail({ to: admins, subject: `Co·labr help: ${s.name || s.email}`, replyTo: s.email,
      html: `<div style="font-family:-apple-system,Arial,sans-serif;max-width:540px;color:#241f1b">
        <p style="font-size:14px"><b>${esc(s.name || s.email)}</b>${pageName ? ' (' + esc(pageName) + ')' : ''} wrote to the helper:</p>
        <blockquote style="border-left:3px solid #FF6600;margin:0 0 12px;padding:6px 0 6px 14px;font-size:14.5px">${esc(message)}</blockquote>
        <p style="font-size:12.5px;color:#7a756f">The helper replied:</p>
        <div style="font-size:13px;color:#3c3733;background:#f6f2ec;border-radius:10px;padding:10px 14px">${esc(reply).replace(/\n/g, '<br>')}</div>
        <p style="font-size:12.5px;color:#7a756f;margin-top:12px">Reply to this email to reach them directly. Logged in the Support table.</p></div>` });
  } catch (e) {}

  return r(200, { reply });
};
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
