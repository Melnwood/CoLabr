// Sandbox feedback module — the only endpoint.
// Testers POST {action:'submit'}; the board and the desk POST everything else.
// Copy into netlify/functions/ alongside _sandbox.js.
const S = require('./_sandbox');

// What another app's browser is allowed to ask for. Reading or changing the list
// is same-origin only, so a guest site can file reports but never read them.
const GUEST_ACTIONS = ['whoami', 'submit'];

exports.handler = async function (event) {
  const c = S.cfg();
  const where = S.whichProject(event, c);
  const cors = S.corsHeaders(where);

  if (event.httpMethod === 'OPTIONS') return { statusCode: where.allowed ? 204 : 403, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return S.json(405, { error: 'Method not allowed' });
  if (!where.allowed) return S.json(403, { error: 'This site is not on the sandbox list. Add its address to "guests" in sandbox.config.json.' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch (e) { return S.json(400, { error: 'Bad request.' }, cors); }
  if (where.cross && GUEST_ACTIONS.indexOf(b.action) < 0) return S.json(403, { error: 'Reports only from here.' }, cors);

  const who = S.identify(event, b, c);
  const site = 'https://' + ((event.headers && (event.headers['x-forwarded-host'] || event.headers.host)) || '');
  const needAdmin = () => who.admin ? null : S.json(403, { error: 'This is the sandbox owner’s list.' });

  try {
    // Who am I, and may I see the list? The widget, the board and the desk all open with this.
    if (b.action === 'whoami') {
      return S.json(200, {
        ok: true, project: where.key, label: where.label || where.key,
        who: { name: who.name, email: who.email, via: who.via }, admin: who.admin,
        statuses: S.STATUSES, locked: !!c.adminKey, projects: who.admin ? S.projectLabels(c) : undefined
      }, cors);
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

    // list  → just this project.  everything → every app that reports here.
    if (b.action === 'list' || b.action === 'everything') {
      const no = needAdmin(); if (no) return no;
      const opts = { open: !!b.open };
      if (b.action === 'everything' && c.desk) opts.project = null;   // the desk sees every app
      const rows = await S.list(c, opts);
      return S.json(200, { ok: true, rows, project: where.key, label: where.label || where.key, projects: S.projectLabels(c) });
    }
    if (b.action === 'status') {
      const no = needAdmin(); if (no) return no;
      if (!b.id || !S.STATUSES.includes(b.status)) return S.json(400, { error: 'Missing id or status.' });
      await S.setStatus(c, b.id, b.status);
      return S.json(200, { ok: true });
    }
    if (b.action === 'note') {
      const no = needAdmin(); if (no) return no;
      if (!b.id) return S.json(400, { error: 'Missing id.' });
      await S.setNotes(c, b.id, String(b.notes || '').slice(0, 4000));
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
      const base = /^https:\/\/[\w.-]+$/.test(b.site || '') ? b.site : site;
      const path = /^\/[\w\-./]*$/.test(b.path || '') ? b.path : '/';
      const token = S.inviteToken(String(b.name || '').trim().slice(0, 80), email, c);
      return S.json(200, { ok: true, link: `${base}${path}${path.includes('?') ? '&' : '?'}sbx=${encodeURIComponent(token)}` });
    }

    /* -------------------------------- filing a report ------------------------------ */
    const note = String(b.note || '').trim().slice(0, 4000);
    if (!note) return S.json(400, { error: 'Tell us what happened first.' }, cors);
    if (!who.email && !who.name) return S.json(400, { error: 'Add your name so we know who found it.' }, cors);

    const page = String(b.page || '').slice(0, 500);
    const context = String(b.context || '').slice(0, 1200);
    // Screenshots arrive as base64 without the data: prefix. 6 MB is Netlify's ceiling.
    const shot = /^[A-Za-z0-9+/=\s]+$/.test(b.shot || '') ? String(b.shot).replace(/\s/g, '') : '';
    const shotType = /^image\/(png|jpeg|webp)$/.test(b.shotType || '') ? b.shotType : 'image/jpeg';

    await S.save(c, { note, page, context, who, shot, shotType, project: where.key });
    await S.announce(c, { note, who, page, boardUrl: `${site}/sandbox-desk.html`, project: where.label || where.key });
    return S.json(200, { ok: true }, cors);
  } catch (e) {
    return S.json(502, { error: (e && e.message) || 'Could not reach the server.' }, cors);
  }
};
