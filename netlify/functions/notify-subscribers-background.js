// Co-Labr — background sender. When an update is published, email each active subscriber
// the way they chose (Full email = whole update; Link email = heads-up + link). Runs async
// (Netlify "-background" function, up to 15 min) so large lists never time out.
// Triggered internally by create-update / admin with a shared secret. Idempotent via the Update "Sent" flag.
const { sendMail, esc } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const SUBS = 'tbl21LyWOBxln6bOy';
const MIS = 'tbli1L8AO0JUDL7Wl';
const UF = { title: 'fldhkHAXyvqtrx3cu', status: 'fldV9l8rl1XNK0OjS', blocks: 'fldN9B0v6YU0xptFu', body: 'fld96vgsguk83wclD', excerpt: 'fld9PBqSvmd4vNiyh', cover: 'fldsU5p6r9LzdeTF7', video: 'fldzK9sIREqMYJU5e', sent: 'fldLIEGYuHv5G1iC2' };
const SF = { name: 'fld95CZHX6o0uNKEb', email: 'fldzhY8nJPjWLKjUK', pref: 'fldI3ED38BzW05kzQ', missionary: 'fldz4NfdnkTC9dw3t', token: 'fldUS2VRksgaVipcC' };
const SITE_MISSIONARY = process.env.SITE_MISSIONARY || 'The Ellenwood Family';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405 };
    const token = process.env.AIRTABLE_TOKEN; if (!token) return { statusCode: 200 };
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return { statusCode: 200 }; }
    if (!b.secret || b.secret !== process.env.SESSION_SECRET) return { statusCode: 401 };
    if (!b.updateId) return { statusCode: 200 };
    const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const api = `https://api.airtable.com/v0/${BASE}`;

    // Load the update.
    const ur = await fetch(`${api}/${UPDATES}/${b.updateId}?returnFieldsByFieldId=true`, { headers: auth });
    if (!ur.ok) return { statusCode: 200 };
    const urec = await ur.json(); const c = urec.fields || {};
    const status = c[UF.status]; const statusName = (status && status.name) ? status.name : status;
    if (statusName !== 'Published') return { statusCode: 200 };
    if (c[UF.sent]) return { statusCode: 200 }; // already sent — idempotent

    // Claim it immediately so a duplicate trigger can't double-send.
    await fetch(`${api}/${UPDATES}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ records: [{ id: b.updateId, fields: { [UF.sent]: true } }], typecast: true }) });

    // Missionary reply-to.
    let replyTo = process.env.GMAIL_SENDER || '';
    try {
      const mf = encodeURIComponent(`{Name}='${SITE_MISSIONARY.replace(/'/g, "")}'`);
      const mr = await fetch(`${api}/${MIS}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${mf}`, { headers: auth });
      if (mr.ok) { const md = await mr.json(); const rec = (md.records || [])[0]; const em = rec && rec.fields && rec.fields['fld65nJ51ewtIWTxj']; if (em) replyTo = em; }
    } catch (e) {}

    // Active subscribers for this missionary who want an email each update.
    const sf = encodeURIComponent(`AND({Active}=1,{Missionary}='${SITE_MISSIONARY.replace(/'/g, "")}',OR({Preference}='Full email',{Preference}='Link email'))`);
    let subs = [], url = `${api}/${SUBS}?pageSize=100&returnFieldsByFieldId=true&filterByFormula=${sf}`;
    while (url) {
      const sr = await fetch(url, { headers: auth }); if (!sr.ok) break;
      const sd = await sr.json(); subs = subs.concat(sd.records || []);
      url = sd.offset ? `${api}/${SUBS}?pageSize=100&returnFieldsByFieldId=true&filterByFormula=${sf}&offset=${sd.offset}` : '';
    }
    if (!subs.length) return { statusCode: 200 };

    const site = process.env.SITE_BASE || '';
    const title = c[UF.title] || 'A new update';
    const cover = (c[UF.cover] || '').replace(/^http:\/\//i, 'https://');
    let blocks = []; try { blocks = JSON.parse(c[UF.blocks] || '[]'); } catch {}
    const fullBody = blocks.length ? renderBlocks(blocks, site) : `<p style="font-size:15px;line-height:1.65;color:#3c3733">${esc(c[UF.body] || c[UF.excerpt] || '').replace(/\n/g, '<br>')}</p>`;
    const excerpt = (c[UF.excerpt] || c[UF.body] || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 45).join(' ');

    for (const s of subs) {
      const f = s.fields || {};
      const email = f[SF.email]; if (!email) continue;
      const prefSel = f[SF.pref]; const pref = (prefSel && prefSel.name) ? prefSel.name : prefSel;
      const first = ((f[SF.name] || '').split(/\s+/)[0]) || 'friend';
      const manage = f[SF.token] && site ? `${site}/prefs.html?t=${f[SF.token]}` : '';
      const coverHtml = cover ? `<img src="${esc(cover)}" alt="" style="width:100%;max-width:560px;border-radius:12px;margin:0 0 16px">` : '';
      let html;
      if (pref === 'Full email') {
        html = wrap(`${coverHtml}<h1 style="font-size:24px;font-weight:800;color:#241f1b;margin:0 0 14px">${esc(title)}</h1>${fullBody}`, site, manage);
      } else {
        html = wrap(`${coverHtml}<h1 style="font-size:22px;font-weight:800;color:#241f1b;margin:0 0 10px">${esc(title)}</h1>
          <p style="font-size:15px;line-height:1.6;color:#3c3733;margin:0 0 16px">${esc(excerpt)}…</p>
          ${site ? `<p><a href="${site}" style="display:inline-block;background:#FF6600;color:#fff;font-weight:700;text-decoration:none;padding:12px 26px;border-radius:10px">Read the full update →</a></p>` : ''}`, site, manage);
      }
      try { await sendMail({ to: email, subject: title, html, replyTo, fromName: SITE_MISSIONARY }); } catch (e) {}
    }
    return { statusCode: 200 };
  } catch (e) {
    return { statusCode: 200 };
  }
};

function wrap(inner, site, manage) {
  return `<div style="font-family:-apple-system,Arial,sans-serif;max-width:560px;margin:0 auto;color:#241f1b">
    <p style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#FF6600;font-weight:800;margin:0 0 10px">The Ellenwoods · Ministry Update</p>
    ${inner}
    <hr style="border:none;border-top:1px solid #e7e4e0;margin:22px 0 12px">
    <p style="font-size:11.5px;color:#7a756f;line-height:1.5">You're receiving this because you chose to follow the Ellenwoods.${manage ? ` <a href="${manage}" style="color:#FF6600">Change how you hear from us or unsubscribe</a>.` : ''}</p>
  </div>`;
}
// Render Co-Labr blocks to simple, email-safe HTML.
function renderBlocks(blocks, site) {
  const GIVE = 'https://www.josiahventure.com/give/give-form/?designation=c3c16a55-b527-4490-bb86-3f981460c969';
  const em = s => esc(s || '').replace(/\n/g, '<br>');
  return blocks.map(bk => {
    switch (bk.type) {
      case 'hero': return `${bk.url ? `<img src="${esc(bk.url)}" style="width:100%;border-radius:12px;margin:0 0 14px">` : ''}${bk.heading ? `<h2 style="font-size:22px;font-weight:800;margin:0 0 6px">${esc(bk.heading)}</h2>` : ''}${bk.sub ? `<p style="color:#7a756f;margin:0 0 14px">${esc(bk.sub)}</p>` : ''}`;
      case 'heading': return `<h3 style="font-size:18px;font-weight:750;margin:14px 0 8px;color:#1c1814">${esc(bk.text)}</h3>`;
      case 'text': return `<p style="font-size:15px;line-height:1.65;color:#3c3733;margin:0 0 14px">${em(bk.text)}</p>`;
      case 'quote': return `<blockquote style="border-left:3px solid #FF6600;margin:0 0 14px;padding:2px 0 2px 14px;font-style:italic;color:#241f1b">${esc(bk.text)}${bk.by ? `<br><span style="font-style:normal;font-size:12.5px;color:#FF6600;font-weight:700">${esc(bk.by)}</span>` : ''}</blockquote>`;
      case 'prayer': return `<div style="background:#eef3fe;border-left:3px solid #2f6df0;border-radius:10px;padding:12px 14px;margin:0 0 14px;color:#3c3733"><b style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#2f6df0;margin-bottom:4px">Prayer</b>${em(bk.text)}</div>`;
      case 'praise': return `<div style="background:#eafaf1;border-left:3px solid #2f9e63;border-radius:10px;padding:12px 14px;margin:0 0 14px;color:#2c4a38"><b style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#2f9e63;margin-bottom:4px">Praise</b>${em(bk.text)}</div>`;
      case 'numbers': { const it = [[bk.a, bk.al], [bk.b, bk.bl], [bk.c, bk.cl]].filter(x => x[0]); if (!it.length) return ''; return `<table style="width:100%;margin:0 0 14px"><tr>${it.map(x => `<td style="text-align:center;padding:8px"><div style="font-size:22px;font-weight:800;color:#FF6600">${esc(x[0])}</div><div style="font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:#7a756f">${esc(x[1] || '')}</div></td>`).join('')}</tr></table>`; }
      case 'photo': return bk.url ? `<img src="${esc((bk.url || '').replace(/^http:\/\//i, 'https://'))}" style="width:100%;border-radius:12px;margin:0 0 6px">${bk.caption ? `<div style="font-size:12px;color:#7a756f;margin:0 0 14px">${esc(bk.caption)}</div>` : '<div style="margin-bottom:14px"></div>'}` : '';
      case 'video': { const v = bk.url || ''; return v ? `<p style="margin:0 0 14px"><a href="${esc(v)}" style="color:#FF6600;font-weight:700">▶ Watch the video</a></p>` : ''; }
      case 'give': return `<p style="margin:6px 0 14px"><a href="${esc(bk.url || GIVE)}" style="display:inline-block;background:#FF6600;color:#fff;font-weight:700;text-decoration:none;padding:11px 24px;border-radius:9px">${esc(bk.label || 'Give')}</a></p>`;
      case 'signoff': return `<p style="font-family:Georgia,serif;font-style:italic;color:#3c3733;margin:6px 0 14px">${em(bk.text)}</p>`;
      case 'divider': return `<hr style="border:none;border-top:1px solid #e7e4e0;margin:16px 0">`;
      default: return '';
    }
  }).join('');
}

// Exported so a preview tool can render an identical email to what we actually send.
module.exports.wrap = wrap;
module.exports.renderBlocks = renderBlocks;
