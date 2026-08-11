// Co·labr — sandbox roster. Admins assign testers a perspective to look from;
// each tester opens sandbox.html and sees only their own assignment.
const { sessionFromEvent, isAdmin } = require('./_auth');
const { sendMail, esc } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tblnKDQEyHU8TIILB';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const sess = sessionFromEvent(event);
  if (!sess) return r(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  let b; try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); }

  const row = rec => {
    const c = rec.fields || {};
    return { id: rec.id, name: c['Name'] || '', email: (c['Email'] || '').toLowerCase(),
      partner: (c['Partner email'] || '').toLowerCase(),
      perspectives: c['Perspectives'] || [], device: c['Device'] || [],
      status: (c['Status'] && c['Status'].name) ? c['Status'].name : (c['Status'] || 'Invited'),
      notes: c['Notes'] || '' };
  };

  try {
    // Any signed-in member: "what am I testing?"
    if (b.action === 'mine') {
      const mine = String(sess.email || '').toLowerCase().replace(/'/g, "\\'");
      const f = encodeURIComponent(`OR(LOWER({Email})='${mine}', LOWER({Partner email})='${mine}')`);
      const rr = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?maxRecords=1&filterByFormula=${f}`, { headers: auth });
      const rec = rr.ok ? (((await rr.json()).records) || [])[0] : null;
      return r(200, { ok: true, me: rec ? row(rec) : null, admin: isAdmin(sess.email) });
    }

    if (!isAdmin(sess.email)) return r(403, { error: 'Admins only.' });

    if (b.action === 'list') {
      let rows = [], url = `https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100`;
      while (url) {
        const rr = await fetch(url, { headers: auth }); if (!rr.ok) break;
        const d = await rr.json(); rows = rows.concat((d.records || []).map(row));
        url = d.offset ? `https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100&offset=${d.offset}` : '';
      }
      rows.sort((a, z) => (a.name || '').localeCompare(z.name || ''));
      return r(200, { ok: true, rows });
    }

    if (b.action === 'save') {
      const fields = {
        'Name': String(b.name || '').slice(0, 80),
        'Email': String(b.email || '').toLowerCase().slice(0, 120),
        'Partner email': String(b.partner || '').toLowerCase().slice(0, 120),
        'Perspectives': Array.isArray(b.perspectives) ? b.perspectives.slice(0, 11) : [],
        'Device': Array.isArray(b.device) ? b.device.slice(0, 3) : [],
        'Status': b.status || 'Invited',
        'Notes': String(b.notes || '').slice(0, 1000)
      };
      if (!fields.Email) return r(400, { error: 'An email is required — that is how they see their assignment.' });
      let res;
      if (b.id) {
        res = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'PATCH', headers: auth,
          body: JSON.stringify({ records: [{ id: b.id, fields }], typecast: true }) });
      } else {
        res = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'POST', headers: auth,
          body: JSON.stringify({ fields, typecast: true }) });
      }
      const d = await res.json();
      if (!res.ok) return r(502, { error: (d.error && d.error.message) || 'Could not save.' });

      // Tell them what they're testing, with the door in.
      if (b.notify && fields.Email) {
        const site = process.env.SITE_BASE || '';
        // A shared page is two people — both of them get the assignment.
        const to = [fields.Email, fields['Partner email']].filter(Boolean).join(', ');
        try {
          await sendMail({
            to, subject: 'You\'re on the Co·labr sandbox team',
            html: `<div style="font-family:-apple-system,Arial,sans-serif;max-width:540px;color:#241f1b">
              <p style="font-size:15px">Hi ${esc((fields.Name || '').split(' ')[0] || 'there')},</p>
              <p style="font-size:14.5px;line-height:1.6">Thanks for helping us test Co·labr. You're looking at it from this perspective:</p>
              <p style="font-size:15px;font-weight:700">${fields.Perspectives.map(p => esc(p)).join(' · ') || 'Anything you like'}</p>
              ${fields.Device.length ? `<p style="font-size:13px;color:#7a756f">On: ${fields.Device.map(d2 => esc(d2)).join(', ')}</p>` : ''}
              ${fields.Notes ? `<p style="font-size:14px;line-height:1.6">${esc(fields.Notes)}</p>` : ''}
              <p style="font-size:14px;line-height:1.6"><b>The one rule:</b> if anything confuses you for more than five seconds, that's a bug. Click Noah's face (bottom right of any page) → <b>Found a problem?</b>, say what you expected, paste a screenshot.</p>
              ${site ? `<p style="margin:18px 0"><a href="${site}/sandbox.html" style="background:#FF6600;color:#fff;font-weight:700;text-decoration:none;border-radius:10px;padding:11px 20px;display:inline-block">See my assignment →</a></p>` : ''}
            </div>`,
            replyTo: sess.email || '', fromName: 'Co·labr Sandbox'
          });
        } catch (e) {}
      }
      return r(200, { ok: true, id: b.id || d.id });
    }

    if (b.action === 'remove') {
      if (!b.id) return r(400, { error: 'Missing id.' });
      const dr = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}/${b.id}`, { method: 'DELETE', headers: auth });
      return dr.ok ? r(200, { ok: true }) : r(502, { error: 'Could not remove.' });
    }

    return r(400, { error: 'Unknown action.' });
  } catch (e) {
    return r(502, { error: 'Could not reach the server.' });
  }
};
function r(statusCode, b) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
