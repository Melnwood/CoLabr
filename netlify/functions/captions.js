// Co·labr — subtitle review & correction. The person who uploaded a video knows what
// was actually said; this lets them read the cues, fix any line, and (from corrected
// English) regenerate every other language. Owner-of-the-update or super admin only.
// GET  ?u=<updateId>[&b=<blockIdx>]  -> { title, blockIndex, videoLang, tracks:[{lang,label,cues:[{s,e,t}]}] }
// POST { u, b, lang, cues:[{s,e,t}], retranslate? } -> saves that track; retranslate
//      fires the background redo of all other languages from the saved English.
const { sessionFromEvent, isAdmin } = require('./_auth');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const UPDATES = 'tbl7aVErl35Qw36QZ';
const MISS = 'tbli1L8AO0JUDL7Wl';

exports.handler = async function (event) {
  const s = sessionFromEvent(event);
  if (!s) return r(401, { error: 'Please sign in.' });
  const token = process.env.AIRTABLE_TOKEN; if (!token) return r(500, { error: 'Server not configured.' });
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = `https://api.airtable.com/v0/${BASE}`;

  const q = event.queryStringParameters || {};
  let b = {};
  if (event.httpMethod === 'POST') { try { b = JSON.parse(event.body || '{}'); } catch { return r(400, { error: 'Bad request.' }); } }
  const updateId = (b.u || q.u || '').toString();
  if (!/^rec[a-zA-Z0-9]{14}$/.test(updateId)) return r(400, { error: 'Which update?' });

  const gr = await fetch(`${api}/${UPDATES}/${updateId}`, { headers: auth });
  if (!gr.ok) return r(404, { error: 'Update not found.' });
  const f = (await gr.json()).fields || {};

  // Ownership: the update's missionary must be the signed-in person's page (admins pass).
  if (!isAdmin(s.email)) {
    const missId = ((f['Missionary'] || [])[0]) || '';
    let owns = false;
    if (missId) {
      const mr = await fetch(`${api}/${MISS}/${missId}`, { headers: auth });
      if (mr.ok) {
        const me = ((await mr.json()).fields || {})['Email'] || '';
        owns = me.toLowerCase().split(/[\s,;]+/).includes(s.email.toLowerCase());
      }
    }
    if (!owns) return r(403, { error: 'This isn’t your update.' });
  }

  let blocks = []; try { blocks = JSON.parse(f['Blocks'] || '[]'); } catch {}
  let idx = parseInt((b.b != null ? b.b : q.b) || '-1', 10);
  if (!(blocks[idx] && blocks[idx].type === 'video' && (blocks[idx].captions || []).length)) {
    idx = blocks.findIndex(x => x && x.type === 'video' && (x.captions || []).length);
  }
  if (idx < 0) return r(404, { error: 'No subtitled video on this update yet.' });
  const block = blocks[idx];

  if (event.httpMethod === 'GET') {
    return r(200, {
      title: f['Title'] || '', blockIndex: idx, videoLang: block.lang || '',
      videoUrl: block.url || '',
      tracks: (block.captions || []).map(t => ({ lang: t.lang, label: t.label || t.lang, cues: parseVtt(t.vtt || '') })),
    });
  }

  if (event.httpMethod !== 'POST') return r(405, { error: 'Method not allowed' });
  const lang = (b.lang || '').toString();
  const cues = Array.isArray(b.cues) ? b.cues : null;
  if (!lang || !cues || !cues.length) return r(400, { error: 'Nothing to save.' });
  const ti = (block.captions || []).findIndex(t => t.lang === lang);
  if (ti < 0) return r(400, { error: 'That language track doesn’t exist on this video.' });
  block.captions[ti].vtt = buildVtt(cues);
  await fetch(`${api}/${UPDATES}`, { method: 'PATCH', headers: auth,
    body: JSON.stringify({ records: [{ id: updateId, fields: { Blocks: JSON.stringify(blocks) } }], typecast: true }) });

  let redoing = false;
  if (b.retranslate && lang === 'en') {
    const secret = process.env.SESSION_SECRET, site = process.env.SITE_BASE;
    if (secret && site) {
      redoing = true;
      await fetch(`${site}/.netlify/functions/retranslate-captions-background`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, u: updateId, b: idx })
      }).catch(() => { redoing = false; });
    }
  }
  return r(200, { ok: true, redoing });
};

function parseVtt(vtt) {
  const cues = [];
  const parts = String(vtt).replace(/\r/g, '').split(/\n\n+/);
  for (const p of parts) {
    const lines = p.split('\n').filter(x => x.trim() !== '');
    const tl = lines.findIndex(x => x.includes('-->'));
    if (tl < 0) continue;
    const m = lines[tl].match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
    if (!m) continue;
    cues.push({ s: sec(m[1]), e: sec(m[2]), t: lines.slice(tl + 1).join('\n') });
  }
  return cues;
}
function sec(ts) { const a = ts.split(':').map(Number); return a.length === 3 ? a[0] * 3600 + a[1] * 60 + a[2] : a[0] * 60 + a[1]; }
function buildVtt(cues) {
  return 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${vt(+c.s || 0)} --> ${vt(+c.e || 0)}\n${String(c.t || '').trim()}`).join('\n\n') + '\n';
}
function vt(t) { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000); return `${p2(h)}:${p2(m)}:${p2(s)}.${p3(ms)}`; }
function p2(n) { return String(n).padStart(2, '0'); } function p3(n) { return String(n).padStart(3, '0'); }
function r(s, body) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
