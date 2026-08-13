// Sandbox feedback module — the only endpoint.
// Testers POST {action:'submit'}; the board POSTs everything else.
// Copy into netlify/functions/ alongside _sandbox.js.
const S = require('./_sandbox');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return S.json(405, { error: 'Method not allowed' });
  const c = S.cfg();
  let b; try { b = JSON.parse(event.body || '{}'); } catch (e) { return S.json(400, { error: 'Bad request.' }); }
  const who = S.identify(event, b, c);
  const site = 'https://' + ((event.headers && (event.headers['x-forwarded-host'] || event.headers.host)) || '');
  const needAdmin = () => who.admin ? null : S.json(403, { error: 'This is the sandbox owner’s list.' });

  try {
    // Who am I, and may I see the list? The widget and the board both open with this.
    if (b.action === 'whoami') {
      return S.json(200, {
        ok: true, project: c.project, label: c.label || c.project,
        who: { name: who.name, email: who.email, via: who.via }, admin: who.admin,
        statuses: S.STATUSES, locked: !!c.adminKey
      });
    }

    // The board's way in when the project has no accounts of its own.
    if (b.action === 'unlock') {
      if (!c.adminKey || !c.secret) return S.json(400, { error: 'Set SANDBOX_ADMIN_KEY and SANDBOX_SECRET to use the key.' });
      const given = String(b.key || '');
      const ok = given.length === c.adminKey.length &&
        require('crypto').timingSafeEqual(Buffer.from(given), Buffer.from(c.adminKey));
      if (!ok) return S.json(403, { error: 'That key doesn’t match.' });
      return S.json(200, { ok: true }, { 'Set-Cookie': S.adminCookie(c) });
    }

    if (b.action === 'list') {
      const no = needAdmin(); if (no) return no;
      return S.json(200, { ok: true, rows: await S.list(c, { open: !!b.open }), project: c.project, label: c.label || c.project });
    }
    if (b.action === 'status') {
      const no = needAdmin(); if (no) return no;
      if (!b.id || !S.STATUSES.includes(b.status)) return S.json(400, { error: 'Missing id or status.' });
      await S.setStatus(c, b.id, b.status);
      return S.json(200, { ok: true });
    }
    if (b.action === 'remove') {
      const no = needAdmin(); if (no) return no;
      if (!b.id) return S.json(400, { error: 'Missing id.' });
      await S.remove(c, b.id);
      return S.json(200, { ok: true });
    }

    // Invite someone in. Stateless — the link itself carries their name, signed.
    if (b.action === 'invite') {
      const no = needAdmin(); if (no) return no;
      if (!c.secret) return S.json(400, { error: 'Set SANDBOX_SECRET before minting invite links.' });
      const email = String(b.email || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return S.json(400, { error: 'That email doesn’t look right.' });
      const path = /^\/[\w\-./]*$/.test(b.path || '') ? b.path : '/';
      const token = S.inviteToken(String(b.name || '').trim().slice(0, 80), email, c);
      return S.json(200, { ok: true, link: `${site}${path}${path.includes('?') ? '&' : '?'}sbx=${encodeURIComponent(token)}` });
    }

    /* -------------------------------- filing a report ------------------------------ */
    const note = String(b.note || '').trim().slice(0, 4000);
    if (!note) return S.json(400, { error: 'Tell us what happened first.' });
    if (!who.email && !who.name) return S.json(400, { error: 'Add your name so we know who found it.' });

    const page = String(b.page || '').slice(0, 500);
    const context = String(b.context || '').slice(0, 1200);
    // Screenshots arrive as base64 without the data: prefix. 6 MB is Netlify's ceiling.
    const shot = /^[A-Za-z0-9+/=\s]+$/.test(b.shot || '') ? String(b.shot).replace(/\s/g, '') : '';
    const shotType = /^image\/(png|jpeg|webp)$/.test(b.shotType || '') ? b.shotType : 'image/jpeg';

    await S.save(c, { note, page, context, who, shot, shotType });
    await S.announce(c, { note, who, page, boardUrl: `${site}/sandbox-board.html` });
    return S.json(200, { ok: true });
  } catch (e) {
    return S.json(502, { error: (e && e.message) || 'Could not reach the server.' });
  }
};
