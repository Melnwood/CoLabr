// Co-Labr — ONE-OFF (delete after use): short follow-up to the accidental "test video"
// blast of 2026-08-06. Sends a brief, human note to every Active Ellenwood subscriber —
// the same set the original send reached. Secret-gated; background (list takes a few minutes).
const { sendMail, esc } = require('./_mail');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const SUBS = 'tbl21LyWOBxln6bOy';
const SF = { name: 'fld95CZHX6o0uNKEb', email: 'fldzhY8nJPjWLKjUK', missionary: 'fldz4NfdnkTC9dw3t', active: 'fld5jtmsj3FtyZCJj', token: 'fldUS2VRksgaVipcC' };

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405 };
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
    if (!b.secret || (b.secret !== process.env.SESSION_SECRET && b.secret !== process.env.IMPORT_SECRET)) return { statusCode: 401 };
    const token = process.env.AIRTABLE_TOKEN; if (!token) return { statusCode: 500 };
    const auth = { Authorization: 'Bearer ' + token };
    const site = process.env.SITE_BASE || 'https://colabr.netlify.app';

    // Every Active Ellenwood subscriber (same audience the "test video" send reached).
    const subs = [];
    let offset = '';
    do {
      const f = encodeURIComponent(`AND({Active},{Missionary}='The Ellenwood Family')`);
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${SUBS}?returnFieldsByFieldId=true&pageSize=100&filterByFormula=${f}${offset ? '&offset=' + offset : ''}`, { headers: auth });
      if (!r.ok) break;
      const jj = await r.json();
      (jj.records || []).forEach(rec => subs.push(rec.fields || {}));
      offset = jj.offset || '';
    } while (offset);

    let sent = 0, failed = 0;
    for (const s of subs) {
      const email = (s[SF.email] || '').trim(); if (!email) continue;
      const first = ((s[SF.name] || '').split(/\s+/)[0] || 'friend');
      const prefs = s[SF.token] ? `${site}/prefs.html?t=${s[SF.token]}` : site;
      const html = `<div style="font-family:-apple-system,Arial,sans-serif;max-width:540px">
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#241f1b">Dear ${esc(first)},</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#241f1b">If an odd email called &ldquo;test video&rdquo; reached you this morning &mdash; that was us, testing a new home for our ministry updates&hellip; a little too enthusiastically.</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#241f1b">Nothing is wrong and there&rsquo;s nothing you need to do. The real thing is coming soon &mdash; we think you&rsquo;ll love it.</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#241f1b">With love,<br>Mel and Amy</p>
        <p style="font-size:12px;color:#7a756f;margin-top:18px">You're receiving this because you chose to follow the Ellenwoods. <a href="${prefs}" style="color:#FF6600">Change how you hear from us or unsubscribe</a>.</p></div>`;
      const res = await sendMail({ to: email, subject: 'About that "test video" email…', html, replyTo: 'mellenwood@josiahventure.com', fromName: 'Mel and Amy Ellenwood' });
      if (res.ok) sent++; else failed++;
    }
    console.log('oops-note done', { subs: subs.length, sent, failed });
    return { statusCode: 200 };
  } catch (e) { console.log('oops-note EXCEPTION', String(e && e.message || e)); return { statusCode: 200 }; }
};
