// Sandbox feedback module — shared core (storage, identity, config).
// Portable: no npm dependencies, no framework, talks to Airtable over REST.
// Copy this file and sandbox-report.js into your project's netlify/functions/.
const crypto = require('crypto');

// Field names in the Airtable table. Override with SANDBOX_FIELDS (JSON) when
// binding the module to a table that already exists under different names.
const DEFAULT_FIELDS = {
  project: 'Project',      // singleLineText — which sandbox this report belongs to
  note: 'Note',            // multilineText  — what the tester wrote
  name: 'Name',            // singleLineText — who they are
  email: 'Email',          // email
  page: 'Page',            // url            — where they were standing
  shot: 'Shot',            // multipleAttachments — the screenshot
  shotUrl: 'Screenshot',   // url            — legacy//hosted screenshot, read-only fallback
  context: 'Context',      // multilineText  — browser, screen size, JS errors
  status: 'Status',        // singleSelect   — New / Working on it / Fixed / Not a bug
  notes: 'Notes'           // multilineText  — what we decided when we worked it
};
const STATUSES = ['New', 'Working on it', 'Fixed', 'Not a bug'];

// Settings come from three places, each beating the one below it:
//   1. environment variables  — for anything secret, and per-deploy overrides
//   2. sandbox.config.json    — the one file you edit when dropping the kit into a project
//   3. the defaults here
const FILE = (function () { try { return require('./sandbox.config.json') || {}; } catch (e) { return {}; } })();

function cfg() {
  let fields = Object.assign({}, DEFAULT_FIELDS, FILE.fields || {});
  try { Object.assign(fields, JSON.parse(process.env.SANDBOX_FIELDS || '{}')); } catch (e) {}
  const pick = (env, key, dflt) => (process.env[env] != null && process.env[env] !== '') ? process.env[env]
    : (FILE[key] != null && FILE[key] !== '') ? FILE[key] : dflt;
  const list = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(s => String(s).trim()).filter(Boolean);
  const flag = v => v === true || /^(1|true|yes)$/i.test(String(v || ''));
  // Other sites can report into this same list without a backend of their own:
  // {"https://otherapp.com": {"key":"otherapp","label":"Other App"}}. The project
  // is decided by which origin the browser came from, never by what it claims.
  let guests = {};
  const rawGuests = pick('SANDBOX_GUESTS', 'guests', null);
  try { guests = typeof rawGuests === 'string' ? JSON.parse(rawGuests || '{}') : (rawGuests || {}); } catch (e) {}
  const byOrigin = {};
  Object.keys(guests).forEach(o => {
    const g = guests[o] || {};
    byOrigin[String(o).trim().toLowerCase().replace(/\/$/, '')] =
      { key: String(g.key || '').trim().toLowerCase(), label: String(g.label || g.key || '') };
  });
  return {
    project: String(pick('SANDBOX_PROJECT', 'project', 'default')).trim().toLowerCase(),
    label: String(pick('SANDBOX_LABEL', 'label', '')),
    guests: byOrigin,
    base: pick('SANDBOX_AIRTABLE_BASE', 'base', process.env.AIRTABLE_BASE || ''),
    table: pick('SANDBOX_TABLE', 'table', 'Sandbox Reports'),
    token: process.env.SANDBOX_AIRTABLE_TOKEN || process.env.AIRTABLE_TOKEN || '',
    secret: process.env.SANDBOX_SECRET || process.env.SESSION_SECRET || '',
    // If the host app already signs its own session cookie the same way (payload.hmac),
    // name it here and signed-in people are identified without any invite link.
    sessionCookie: pick('SANDBOX_SESSION_COOKIE', 'sessionCookie', ''),
    adminKey: process.env.SANDBOX_ADMIN_KEY || '',
    admins: list(pick('SANDBOX_ADMINS', 'admins', process.env.ADMIN_EMAILS || '')).map(s => s.toLowerCase()),
    notify: list(pick('SANDBOX_NOTIFY', 'notify', '')),
    webhook: process.env.SANDBOX_WEBHOOK || '',      // Slack / Make / IFTTT — any POST-JSON hook
    resendKey: process.env.SANDBOX_RESEND_KEY || '',
    from: pick('SANDBOX_FROM', 'from', ''),
    // Reports saved before this module existed have no project stamped on them.
    includeUntagged: flag(pick('SANDBOX_INCLUDE_UNTAGGED', 'includeUntagged', '')),
    // Only the one deployment you work from reads every app's reports at once.
    desk: flag(pick('SANDBOX_DESK', 'desk', '')),
    fields
  };
}

/* ---------------- signing: invite tokens, admin cookie, host sessions ------------- */
// Same shape as a typical HMAC session cookie: base64url(payload).base64url(sig)

function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function sign(payload, secret) {
  const p = b64url(JSON.stringify(payload));
  return p + '.' + b64url(crypto.createHmac('sha256', secret).update(p).digest());
}
function verify(token, secret) {
  if (!token || !secret || token.indexOf('.') < 0) return null;
  const [p, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', secret).update(p).digest());
  if (!sig || sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}
function cookies(event) {
  const out = {};
  const raw = (event.headers && (event.headers.cookie || event.headers.Cookie)) || '';
  raw.split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}

// Who is filing this? In order of how much we trust it.
function identify(event, body, c) {
  const ck = cookies(event);
  const admin = () => {
    const a = verify(ck.sbx_admin, c.secret);
    return !!(a && a.r === 'admin');
  };
  // 1. The host app's own signed-in session.
  if (c.sessionCookie && ck[c.sessionCookie]) {
    const s = verify(ck[c.sessionCookie], c.secret);
    if (s && s.email) return { name: s.name || s.email, email: s.email, via: 'account', admin: c.admins.includes(String(s.email).toLowerCase()) || admin() };
  }
  // 2. An invite link we minted.
  const t = verify((body && body.token) || ck.sbx_who, c.secret);
  if (t && t.e) return { name: t.n || t.e, email: t.e, via: 'invite', admin: c.admins.includes(String(t.e).toLowerCase()) || admin() };
  // 3. Whatever they typed into the widget — unverified, but still a name and a time.
  const email = String((body && body.email) || '').trim().slice(0, 120);
  const name = String((body && body.name) || '').trim().slice(0, 120);
  if (name || email) return { name: name || email, email, via: 'typed', admin: (email && c.admins.includes(email.toLowerCase())) || admin() };
  return { name: '', email: '', via: 'anonymous', admin: admin() };
}
function inviteToken(name, email, c, days) {
  return sign({ n: name || '', e: email, p: c.project, r: 'tester', exp: Date.now() + (days || 180) * 864e5 }, c.secret);
}
function adminCookie(c) {
  const t = sign({ r: 'admin', p: c.project, exp: Date.now() + 30 * 864e5 }, c.secret);
  return `sbx_admin=${t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`;
}

/* ---------------------------------- Airtable ------------------------------------- */

let SCHEMA = null;   // cached for the life of the lambda container

function api(c) {
  return (path, init) => fetch('https://api.airtable.com/v0/' + path, Object.assign({}, init, {
    headers: Object.assign({ Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, (init || {}).headers)
  }));
}

// Find the reports table — creating it on first run if the token may write schema.
async function schema(c) {
  if (SCHEMA) return SCHEMA;
  const call = api(c);
  const mr = await call(`meta/bases/${c.base}/tables`);
  if (!mr.ok) throw new Error('Could not read the Airtable base. Check SANDBOX_AIRTABLE_BASE and the token scopes.');
  const tables = (await mr.json()).tables || [];
  const want = c.table.toLowerCase();
  let t = tables.find(x => x.id === c.table) || tables.find(x => String(x.name).toLowerCase() === want);
  if (!t) t = await createTable(c, call);
  SCHEMA = { id: t.id, types: {} };
  (t.fields || []).forEach(f => { SCHEMA.types[f.name] = f.type; });
  return SCHEMA;
}
function has(sch, name) { return Object.prototype.hasOwnProperty.call(sch.types, name); }

async function createTable(c, call) {
  const f = c.fields;
  const body = {
    name: c.table,
    description: 'Sandbox feedback — what testers found, who found it, and when.',
    fields: [
      { name: f.note, type: 'multilineText' },
      { name: f.name, type: 'singleLineText' },
      { name: f.email, type: 'email' },
      { name: f.project, type: 'singleLineText' },
      { name: f.page, type: 'url' },
      { name: f.shot, type: 'multipleAttachments' },
      { name: f.context, type: 'multilineText' },
      { name: f.notes, type: 'multilineText' },
      { name: f.status, type: 'singleSelect', options: { choices: STATUSES.map(name => ({ name })) } }
    ]
  };
  const cr = await call(`meta/bases/${c.base}/tables`, { method: 'POST', body: JSON.stringify(body) });
  if (!cr.ok) throw new Error(`No "${c.table}" table in this base, and it could not be created automatically (the token needs schema.bases:write). Create it by hand — the fields are listed in sandbox-kit/README.md.`);
  return await cr.json();
}

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);

async function save(c, { note, page, context, who, shot, shotType, project }) {
  const sch = await schema(c);
  const call = api(c);
  const f = c.fields;
  const fields = {};
  fields[f.note] = note;
  if (has(sch, f.name)) fields[f.name] = who.name || who.email || 'Someone';
  if (has(sch, f.email)) fields[f.email] = who.email || '';
  if (has(sch, f.project)) fields[f.project] = project || c.project;
  if (has(sch, f.page) && page) fields[f.page] = page;
  if (has(sch, f.context) && context) fields[f.context] = context;
  if (has(sch, f.status)) fields[f.status] = 'New';

  const cr = await call(`${c.base}/${sch.id}`, { method: 'POST', body: JSON.stringify({ fields, typecast: true }) });
  if (!cr.ok) throw new Error('Could not save the report.');
  const rec = await cr.json();

  // Screenshots ride along as an Airtable attachment — no bucket, no second service.
  // Airtable takes 5 MB of file bytes; the widget shrinks first, this is the backstop.
  const tooBig = shot && shot.length * 0.75 > 5 * 1024 * 1024;
  if (shot && !tooBig && sch.types[f.shot] === 'multipleAttachments') {
    try {
      await fetch(`https://content.airtable.com/v0/${c.base}/${rec.id}/${encodeURIComponent(f.shot)}/uploadAttachment`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: shotType || 'image/jpeg', file: shot, filename: `sandbox-${Date.now()}.jpg` })
      });
    } catch (e) { /* the words matter more than the picture — keep the record */ }
  }
  return rec.id;
}

// Pass project:null to read every project at once — that's the daily desk.
async function list(c, opts) {
  const sch = await schema(c);
  const call = api(c);
  const f = c.fields;
  const project = (opts && 'project' in opts) ? opts.project : c.project;
  let where = '';
  if (project && has(sch, f.project)) {
    const p = String(project).replace(/'/g, "\\'");
    where = c.includeUntagged ? `OR({${f.project}}='${p}',{${f.project}}='')` : `{${f.project}}='${p}'`;
  }
  const rows = [];
  let offset = '', pages = 0;
  do {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (where) qs.set('filterByFormula', where);
    if (offset) qs.set('offset', offset);
    const rr = await call(`${c.base}/${sch.id}?${qs}`);
    if (!rr.ok) throw new Error('Could not read the list.');
    const d = await rr.json();
    (d.records || []).forEach(rec => {
      const x = rec.fields || {};
      const att = Array.isArray(x[f.shot]) ? x[f.shot][0] : null;
      const st = x[f.status];
      rows.push({
        id: rec.id,
        note: x[f.note] || '',
        name: x[f.name] || '',
        email: x[f.email] || '',
        page: x[f.page] || '',
        context: x[f.context] || '',
        // Attachment URLs from Airtable expire, so the board always reads them fresh.
        shot: (att && (att.url || (att.thumbnails && att.thumbnails.large && att.thumbnails.large.url))) || x[f.shotUrl] || '',
        status: (st && st.name) ? st.name : (st || 'New'),
        notes: x[f.notes] || '',
        project: x[f.project] || '',
        created: rec.createdTime || ''
      });
    });
    offset = d.offset || '';
  } while (offset && ++pages < 5);
  rows.sort((a, z) => (z.created || '').localeCompare(a.created || ''));
  return opts && opts.open ? rows.filter(r => r.status !== 'Fixed' && r.status !== 'Not a bug') : rows;
}

async function setStatus(c, id, status) {
  const sch = await schema(c);
  const fields = {}; fields[c.fields.status] = status;
  const pr = await api(c)(`${c.base}/${sch.id}`, { method: 'PATCH', body: JSON.stringify({ records: [{ id, fields }], typecast: true }) });
  if (!pr.ok) throw new Error('Could not update that report.');
}
async function setNotes(c, id, notes) {
  const sch = await schema(c);
  if (!has(sch, c.fields.notes)) throw new Error('This table has no Notes field to write into.');
  const fields = {}; fields[c.fields.notes] = notes;
  const pr = await api(c)(`${c.base}/${sch.id}`, { method: 'PATCH', body: JSON.stringify({ records: [{ id, fields }], typecast: true }) });
  if (!pr.ok) throw new Error('Could not save that note.');
}

/* ------------------------- which app is this report from? ------------------------- */
// Decided by the browser's Origin header, never by anything the page claims, so one
// deployment can safely take reports from every other app you've built.

function whichProject(event, c) {
  const h = event.headers || {};
  const origin = String(h.origin || h.Origin || '').trim().toLowerCase().replace(/\/$/, '');
  const self = 'https://' + String(h['x-forwarded-host'] || h.host || '').toLowerCase();
  if (!origin || origin === self) return { key: c.project, label: c.label || c.project, cross: false, allowed: true };
  const guest = c.guests[origin];
  if (!guest || !guest.key) return { key: '', label: '', cross: true, allowed: false, origin };
  return { key: guest.key, label: guest.label, cross: true, allowed: true, origin };
}
function corsHeaders(where) {
  if (!where.cross || !where.allowed) return {};
  return {
    'Access-Control-Allow-Origin': where.origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
// Every project's name, for the page that reads them all at once.
function projectLabels(c) {
  const out = {};
  out[c.project] = c.label || c.project;
  Object.keys(c.guests).forEach(o => { const g = c.guests[o]; if (g.key) out[g.key] = g.label || g.key; });
  return out;
}
async function remove(c, id) {
  const sch = await schema(c);
  const dr = await api(c)(`${c.base}/${sch.id}/${id}`, { method: 'DELETE' });
  if (!dr.ok) throw new Error('Could not remove that report.');
}

/* --------------------------- telling somebody about it ---------------------------- */
// Both optional, both zero-dependency. Failure here never loses the report.

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

async function announce(c, { note, who, page, boardUrl, project }) {
  const app = project || c.label || c.project;
  const title = `${who.name || 'Someone'} found something in ${app}`;
  if (c.webhook) {
    try {
      await fetch(c.webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${title}:\n${note}\n${page || ''}`, project: c.project, reporter: who.name, email: who.email, note, page, board: boardUrl })
      });
    } catch (e) {}
  }
  if (c.resendKey && c.notify.length && c.from) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + c.resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: c.from, to: c.notify, reply_to: who.email || undefined,
          subject: `Sandbox (${app}): ${note.slice(0, 60)}${note.length > 60 ? '…' : ''}`,
          html: `<div style="font-family:-apple-system,Arial,sans-serif;max-width:560px;color:#241f1b">
            <p style="font-size:14px"><b>${esc(who.name || 'A tester')}</b> found something${page ? ` on <a href="${esc(page)}">${esc(page.replace(/^https?:\/\/[^/]+/, '')) || 'the site'}</a>` : ''}:</p>
            <blockquote style="border-left:3px solid #FF6600;margin:0 0 14px;padding:6px 0 6px 14px;font-size:14.5px;line-height:1.55;white-space:pre-wrap">${esc(note)}</blockquote>
            ${boardUrl ? `<p style="font-size:13px"><a href="${esc(boardUrl)}">Open the sandbox list</a> — screenshot and everything else is there.</p>` : ''}
          </div>`
        })
      });
    } catch (e) {}
  }
}

function json(statusCode, body, extra) {
  return { statusCode, headers: Object.assign({ 'Content-Type': 'application/json' }, extra || {}), body: JSON.stringify(body) };
}

module.exports = { cfg, STATUSES, sign, verify, cookies, identify, inviteToken, adminCookie, schema, save, list, setStatus, setNotes, remove, announce, whichProject, corsHeaders, projectLabels, slug, esc, json };
