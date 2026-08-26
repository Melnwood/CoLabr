// Co·labr — super-admin: add JV staff to Co·labr and email them the onboarding walkthrough.
// Admin-only (see ADMIN_EMAILS). Creates a Missionary/page record, then sends the welcome email.
const { sessionFromEvent, isAdmin } = require('./_auth');
const { sendMail } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const MIS = 'tbli1L8AO0JUDL7Wl';
const F = { name: 'fldPYSQwxoQJGb0Zd', email: 'fld65nJ51ewtIWTxj', loc: 'fld0mx3Sp4JnNnIfc', org: 'fldCQ8c1Eu6SXmY98', style: 'fldvLZXckaQVUbD7F', photo: 'fldiXSCuELTQiiT08', national: 'fld4WE8NRwSrNj7ih' };
const STYLES = ['Field Notes', 'Cover Grid', 'Timeline', 'Gallery Wall'];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });
  const session = sessionFromEvent(event);
  if (!session) return resp(401, { error: 'Please sign in.' });
  if (!isAdmin(session.email)) return resp(403, { error: 'This area is for Co·labr admins.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(500, { error: 'Server not configured.' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Bad request.' }); }
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = `https://api.airtable.com/v0/${BASE}/${MIS}`;

  try {
    if (b.action === 'list') {
      const r = await fetch(`${api}?pageSize=100&returnFieldsByFieldId=true`, { headers: auth });
      const d = await r.json(); if (!r.ok) return resp(r.status, { error: 'Could not load people.' });
      const people = (d.records || []).map(rec => { const f = rec.fields || {}; const s = f[F.style];
        return { id: rec.id, name: f[F.name] || '', email: f[F.email] || '', location: f[F.loc] || '', org: f[F.org] || '', style: (s && s.name) ? s.name : (s || ''), photo: f[F.photo] || '', national: !!f[F.national] };
      }).sort((a, b2) => a.name.localeCompare(b2.name));
      return resp(200, { ok: true, people, styles: STYLES });
    }

    if (b.action === 'add') {
      const o = b.person || {};
      if (!o.name || !o.name.trim()) return resp(400, { error: 'A name is required.' });
      const emails = String(o.emails || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!emails.length) return resp(400, { error: 'At least one JV email is required.' });
      const bad = emails.find(e => !/^[^\s@]+@josiahventure\.com$/i.test(e));
      if (bad) return resp(400, { error: `“${bad}” isn’t a @josiahventure.com address.` });
      const style = STYLES.includes(o.style) ? o.style : 'Field Notes';
      const fields = { [F.name]: o.name.trim(), [F.email]: emails.join(', '), [F.loc]: o.location || '', [F.org]: o.org || '', [F.style]: style, [F.national]: !!o.national };
      const cr = await fetch(api, { method: 'POST', headers: auth, body: JSON.stringify({ fields, typecast: true }) });
      const cd = await cr.json();
      if (!cr.ok) return resp(cr.status, { error: (cd.error && cd.error.message) || 'Could not create the page.' });

      // Send the onboarding email to each address.
      const sent = []; const failed = [];
      for (const to of emails) {
        try {
          const m = await sendMail({ to, subject: 'Welcome to Co·labr — let’s get your updates online', html: onboardingEmail(o.name.trim(), emails), fromName: 'Co·labr' });
          (m.ok ? sent : failed).push(to);
        } catch (e) { failed.push(to); }
      }
      return resp(200, { ok: true, id: cd.id, sent, failed });
    }

    if (b.action === 'setNational') {
      if (!b.id) return resp(400, { error: 'Missing id.' });
      const ur = await fetch(`${api}/${b.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ fields: { [F.national]: !!b.national }, typecast: true }) });
      if (!ur.ok) { const ud = await ur.json().catch(() => ({})); return resp(ur.status, { error: (ud.error && ud.error.message) || 'Could not update.' }); }
      return resp(200, { ok: true, national: !!b.national });
    }

    if (b.action === 'resend') {
      if (!b.id) return resp(400, { error: 'Missing id.' });
      const gr = await fetch(`${api}/${b.id}?returnFieldsByFieldId=true`, { headers: auth });
      if (!gr.ok) return resp(gr.status, { error: 'Person not found.' });
      const f = (await gr.json()).fields || {};
      const emails = String(f[F.email] || '').split(',').map(s => s.trim()).filter(Boolean);
      const sent = []; const failed = [];
      for (const to of emails) { try { const m = await sendMail({ to, subject: 'Your Co·labr sign-in & setup', html: onboardingEmail(f[F.name] || '', emails), fromName: 'Co·labr' }); (m.ok ? sent : failed).push(to); } catch (e) { failed.push(to); } }
      return resp(200, { ok: true, sent, failed });
    }

    return resp(400, { error: 'Unknown action.' });
  } catch (e) {
    return resp(502, { error: 'Something went wrong.' });
  }
};

function onboardingEmail(name, emails) {
  const site = (process.env.SITE_BASE || 'https://colabr.netlify.app').replace(/\/$/, '');
  const pageUrl = `${site}/?m=${encodeURIComponent(name)}`;
  const which = emails.length > 1 ? `either of your JV addresses (${emails.map(escH).join(' or ')})` : 'your JV Google account';
  const step = (n, t, d) => `<tr><td style="vertical-align:top;padding:0 12px 16px 0"><div style="width:26px;height:26px;border-radius:50%;background:#FF6600;color:#fff;font-weight:800;font-size:13px;text-align:center;line-height:26px">${n}</div></td><td style="padding:0 0 16px 0"><div style="font-weight:700;font-size:15px;color:#241f1b">${t}</div><div style="font-size:14px;line-height:1.55;color:#4a4030;margin-top:2px">${d}</div></td></tr>`;
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#241f1b">
    <p style="font-size:16px">Hi ${escH(name)},</p>
    <p style="font-size:15px;line-height:1.6">Welcome to <b>Co·labr</b> — a simple, living home for your supporter updates. One place where your friends and partners can read your stories, watch your videos (with translation for other languages), pray with you, and cheer you on — and where you can see who's engaging. Here's how to get going; it takes just a few minutes.</p>
    <table style="border-collapse:collapse;margin:18px 0">
      ${step(1, 'Sign in', `Go to <a href="${site}" style="color:#FF6600;font-weight:700">${site.replace(/^https?:\/\//,'')}</a> and click <b>Sign in with Google</b> using ${which}. No password to remember.`)}
      ${step(2, 'Add your photo &amp; pick a style', `On your dashboard, upload a photo of you/your family and choose how your page looks under <b>Get set up</b>.`)}
      ${step(3, 'Bring in your history', `If you've been sending updates through Mailchimp, you can import them so your page starts full, not empty.`)}
      ${step(4, 'Write your first update', `Click <b>New update</b> — add your words, photos, even a video. When you publish, it goes to <i>your</i> page and out to your supporters in their language.`)}
      ${step(5, 'Invite your supporters', `Use <b>Invite</b> to send a warm note to your partners so they can follow along and choose how they hear from you.`)}
    </table>
    <p style="font-size:15px;line-height:1.6">Your page will live here once you publish your first update:<br><a href="${escH(pageUrl)}" style="color:#FF6600;font-weight:700">${escH(pageUrl)}</a></p>
    <p style="font-size:15px;line-height:1.6">We're so glad you're on board. Praise God for what He's doing through you.</p>
    <p style="font-size:13px;color:#7a756f;margin-top:22px">Sent from Co·labr · Josiah Venture. If you weren't expecting this, you can ignore it.</p>
  </div>`;
}

function escH(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function resp(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
