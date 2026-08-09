// Co-Labr — supporter response intake (public, no login).
// A supporter prays, sends a private note, or leaves public encouragement on an update.
// Writes to the Responses table. Uses AIRTABLE_TOKEN (needs write scope).
// Notifies the missionary by email — via Google Workspace/Gmail (preferred) or Resend (fallback).
const { sendMail, esc } = require('./_mail');
const { sessionFromEvent } = require('./_auth');
const { missByEmail } = require('./_shares');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tblVNMG5VnOnFFeto';
const F = {
  name: 'fld0i05my8OeyflZH', type: 'fldigSBFHPa27Hh3s', message: 'fld5GlgEzO1WbORGu',
  email: 'fld0q8b1lxqx3gKqA', public: 'fld6Aax3AjDcDDJLx', read: 'fldns2iYDQ2tPOrGd',
  update: 'fldTML1g8IhU6gH70', updateTitle: 'fld1g3obOcBG6vFxb', missionary: 'fldGrurNkcRsUDnDk',
  updateId: 'fldkg6say56a4pYQD'
};
const TYPES = ['Prayer', 'Note', 'Encouragement'];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }
  const type = TYPES.includes(b.type) ? b.type : null;
  if (!type) return r(400, { error: 'Unknown response type.' });

  // A supporter key anchors identity server-side: the missionary always knows who
  // prayed or wrote, even if the form was left blank.
  let known = null;
  const vt = (b.t || '').toString().trim();
  if (vt && /^[a-f0-9]{16,64}$/i.test(vt) && b.missionary) {
    try {
      const tf = encodeURIComponent(`AND({Token}='${vt}',{Missionary}='${String(b.missionary).replace(/'/g, "")}',{Active}=1)`);
      const trr = await fetch(`https://api.airtable.com/v0/${BASE}/tbl21LyWOBxln6bOy?maxRecords=1&filterByFormula=${tf}`, { headers: { Authorization: 'Bearer ' + token } });
      if (trr.ok) { const rec = (((await trr.json()).records) || [])[0]; if (rec) known = { name: rec.fields['Name'] || '', email: rec.fields['Email'] || '' }; }
    } catch (e) {}
  }
  // Signed-in members are known by their session — the missionary always learns WHO
  // prayed or wrote, and responding to your OWN page is a test, never a real number.
  const session = sessionFromEvent(event);
  let mine = null;
  if (session && session.email) {
    try { mine = await missByEmail({ Authorization: 'Bearer ' + token }, session.email); } catch (e) {}
    if (mine && mine.name && b.missionary && mine.name === String(b.missionary)) {
      return r(200, { ok: true, test: true });
    }
  }
  const name = (b.name || '').toString().trim().slice(0, 80)
    || (known && known.name)
    || (mine && mine.name)
    || (session && session.email)
    || (type === 'Prayer' ? 'A supporter' : '');
  if (!name) return r(400, { error: 'Please add your name.' });
  const message = (b.message || '').toString().trim().slice(0, 2000);
  if ((type === 'Note' || type === 'Encouragement') && !message) return r(400, { error: 'Please write a message.' });

  // Only encouragement can ever be public; notes & prayers are private to the missionary.
  const isPublic = type === 'Encouragement' && b.public !== false;

  const fields = {
    [F.name]: name,
    [F.type]: type,
    [F.public]: isPublic,
    [F.read]: false
  };
  if (message) fields[F.message] = message;
  const emailFinal = (b.email || '').toString().trim().slice(0, 120) || (known && known.email) || (session && session.email) || '';
  if (emailFinal) fields[F.email] = emailFinal;
  if (b.updateId) { fields[F.update] = [b.updateId]; fields[F.updateId] = b.updateId; }
  if (b.updateTitle) fields[F.updateTitle] = (b.updateTitle || '').toString().slice(0, 200);
  if (b.missionary) fields[F.missionary] = (b.missionary || '').toString().slice(0, 120);

  try {
    const resp = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: true })
    });
    const data = await resp.json();
    if (!resp.ok) return r(resp.status, { error: (data.error && data.error.message) || 'Could not send.' });
    // Best-effort: notify the missionary by email so they can reply quickly. Never blocks the response.
    try { await notify(token, { type, name, message, email: emailFinal, missionary: b.missionary, updateTitle: b.updateTitle }); } catch (e) {}
    return r(200, { ok: true, id: data.id, public: isPublic });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};

// Look up the missionary's inbox and notify them. Uses the shared mailer (Gmail preferred, Resend fallback).
async function notify(token, x) {
  const MIS_TABLE = 'tbli1L8AO0JUDL7Wl', MIS_EMAIL = 'fld65nJ51ewtIWTxj';
  let to = process.env.NOTIFY_EMAIL || '';
  if (x.missionary) {
    const f = encodeURIComponent(`{Name}='${String(x.missionary).replace(/'/g, "")}'`);
    const mr = await fetch(`https://api.airtable.com/v0/${BASE}/${MIS_TABLE}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${f}`, { headers: { Authorization: 'Bearer ' + token } });
    if (mr.ok) { const md = await mr.json(); const rec = (md.records || [])[0]; const em = rec && rec.fields && rec.fields[MIS_EMAIL]; if (em) to = em; }
  }
  if (!to) return;

  const label = x.type === 'Prayer' ? 'is praying for you' : (x.type === 'Note' ? 'sent you a note' : 'left you encouragement');
  const subject = `${x.name} ${label}` + (x.updateTitle ? ` \u00b7 ${x.updateTitle}` : '');
  const site = process.env.SITE_BASE || '';
  const html =
    `<div style="font-family:-apple-system,Arial,sans-serif;max-width:520px">
      <p style="font-size:15px;color:#241f1b"><b>${esc(x.name)}</b> ${label}${x.updateTitle ? ` on <b>${esc(x.updateTitle)}</b>` : ''}.</p>
      ${x.message ? `<blockquote style="border-left:3px solid #FF6600;margin:0 0 14px;padding:6px 0 6px 14px;color:#3c3733;font-size:15px;line-height:1.5">${esc(x.message)}</blockquote>` : ''}
      ${x.email ? `<p style="font-size:13px;color:#7a756f">From ${esc(x.email)} — reply to this email (or reply inside Co-Labr) to write ${esc(x.name)} back.</p>` : ''}
      ${site ? `<p><a href="${site}/manage.html" style="color:#FF6600;font-weight:700">Open your Co-Labr inbox \u2192</a></p>` : ''}
    </div>`;

  const fromName = x.missionary ? `${x.missionary} via Co-Labr` : 'Co-Labr';
  await sendMail({ to, subject, html, replyTo: x.email, fromName });
}

function r(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
