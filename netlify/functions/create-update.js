// Co-Labr — create an update. Writes a new record into Airtable.
// Security: requires a private passcode (Netlify env var EDIT_KEY) sent by the composer.
// Uses AIRTABLE_TOKEN (must have data.records:write scope on the base).

const { sessionFromEvent } = require('./_auth');
const { fireNotify } = require('./_notify');
const { missByEmail } = require('./_shares');
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(500, { error: 'Missing AIRTABLE_TOKEN.' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return resp(400, { error: 'Bad request.' }); }

  const editKey = process.env.EDIT_KEY;
  const session = sessionFromEvent(event);
  if (!session && !(editKey && b.key === editKey)) return resp(401, { error: 'Please sign in.' });
  if (!b.title || !b.title.trim()) return resp(400, { error: 'A title is required.' });

  // Tag the update to the signed-in member's OWN page. No page, no publishing —
  // the old fallback silently posted to the Ellenwoods' site.
  let missionaryName = 'The Ellenwood Family';
  if (session) {
    let me = null;
    try { me = await missByEmail({ Authorization: 'Bearer ' + token }, session.email); } catch (e) {}
    if (!me || !me.name) return resp(403, { error: 'Your page isn\'t set up yet — create it first.', join: true });
    missionaryName = me.name;
  }

  const blocks = Array.isArray(b.blocks) ? b.blocks : [];
  // Strip the composer's inline format markers for the plain-text Body/Excerpt.
  const stripFmt = t => String(t || '').replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\+\+([^+]+)\+\+/g, '$1').replace(/_([^_\n]+)_/g, '$1');
  const bodyText = blocks.filter(x => ['heading','text','quote','prayer','praise','signoff'].includes(x.type))
    .map(x => stripFmt(x.text || ''))
    .concat(blocks.filter(x => x.type === 'hero').map(x => x.heading || ''))
    .filter(Boolean).join('\n\n').trim();
  const firstPhoto = (blocks.find(x => (x.type === 'hero' || x.type === 'photo') && x.url) || {}).url || '';
  const firstVideo = (blocks.find(x => x.type === 'video' && x.url) || {}).url || '';

  // Mark freshly-uploaded videos as "captions processing" so the page can show status.
  let pendingVideo = false;
  for (const bk of blocks) {
    if (bk && bk.type === 'video' && bk.url && /storage\.googleapis\.com\/.+\/videos\//.test(bk.url) && bk.lang && !(Array.isArray(bk.captions) && bk.captions.length)) {
      bk.captionStatus = 'processing';
      pendingVideo = true;
    }
  }

  const fields = {
    'Title': b.title.trim(),
    'Body': bodyText || (b.body || ''),
    'Excerpt': (bodyText || b.body || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    'Type': b.type || 'Newsletter',
    // A published update with a video still generating subtitles HOLDS as 'Processing' —
    // invisible to supporters — and the caption pipeline releases it when every language
    // is ready. No half-dressed updates on the wall.
    'Status': b.publish ? (pendingVideo ? 'Processing' : 'Published') : 'Draft',
    'Source': 'Co-Labr',
    'Missionary': [missionaryName],
    'Date': b.date || new Date().toISOString().slice(0, 10)
  };
  if (blocks.length) fields['Blocks'] = JSON.stringify(blocks);
  if (b.audiences && b.audiences.length) fields['Audiences'] = b.audiences;
  const cover = b.cover || firstPhoto; if (cover) fields['Cover Image URL'] = cover;
  // The crop the missionary chose lives with the cover, so every card shows the faces.
  if (cover) {
    const cb = blocks.find(x => (x.type === 'hero' || x.type === 'photo') && x.url === cover) || {};
    fields['Cover Focus'] = `${cb.fx != null ? +cb.fx : 50}% ${cb.fy != null ? +cb.fy : 50}%`;
  }
  const video = b.video || firstVideo; if (video) fields['Video URL'] = video;

  try {
    const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;
    const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    let r;
    if (b.id) {
      r = await fetch(api, { method: 'PATCH', headers, body: JSON.stringify({ records: [{ id: b.id, fields }], typecast: true }) });
    } else {
      r = await fetch(api, { method: 'POST', headers, body: JSON.stringify({ fields, typecast: true }) });
    }
    const data = await r.json();
    if (!r.ok) return resp(r.status, { error: (data.error && data.error.message) || 'Airtable rejected the write.' });
    const recId = b.id ? (data.records && data.records[0] && data.records[0].id) : data.id;
    // Auto-caption any newly-uploaded (GCS-hosted) videos that don't have captions yet.
    if (recId) { try { await fireCaptions(recId, blocks); } catch (e) {} }
    // Videos whose English was checked in the composer publish immediately — the other
    // languages are made from that approved English in the background.
    if (recId && fields.Status !== 'Draft') { try { await fireTail(recId, blocks); } catch (e) {} }
    // Translate the written update into every field language (best-effort, async).
    if (recId && (fields.Status === 'Published' || fields.Status === 'Processing')) { try { await fireTranslate(recId); } catch (e) {} }
    // If this update just went out as Published, notify subscribers (best-effort, async).
    if ((fields.Status === 'Published' || fields.Status === 'Processing') && recId) {
      if (b.emailChoice === 'wall') {
        // Wall-only publish: claim Sent so no send path (now or later) ever emails this update.
        try { await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ records: [{ id: recId, fields: { 'fldLIEGYuHv5G1iC2': true } }] }) }); } catch (e) {}
      } else if (fields.Status === 'Published') {
        try { await fireNotify(recId); } catch (e) {}
      }
    }
    return resp(200, { ok: true, id: recId, status: fields.Status });
  } catch (e) {
    return resp(502, { error: 'Could not reach Airtable.' });
  }
};

// Fire the heart-language caption job for each uploaded video block missing captions.
async function fireCaptions(recId, blocks) {
  const secret = process.env.SESSION_SECRET, site = process.env.SITE_BASE;
  if (!secret || !site) return;
  for (let i = 0; i < blocks.length; i++) {
    const bk = blocks[i];
    if (!bk || bk.type !== 'video' || !bk.url) continue;
    if (!/storage\.googleapis\.com\/.+\/videos\//.test(bk.url)) continue;      // only our own uploads
    if (Array.isArray(bk.captions) && bk.captions.length) continue;            // already captioned
    if (!bk.lang) continue;                                                    // need a spoken language
    const gsUri = bk.url.replace(/^https:\/\/storage\.googleapis\.com\//, 'gs://');
    try {
      await fetch(`${site}/.netlify/functions/caption-video-background`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, gsUri, lang: bk.lang, recordId: recId, blockIndex: i })
      });
    } catch (e) {}
  }
}

// Composer-approved subtitles: translate the other languages FROM the checked English.
async function fireTail(recId, blocks) {
  const secret = process.env.SESSION_SECRET, site = process.env.SITE_BASE;
  if (!secret || !site) return;
  for (let i = 0; i < blocks.length; i++) {
    const bk = blocks[i];
    if (!bk || bk.type !== 'video' || bk.captionStatus !== 'approved') continue;
    const caps = Array.isArray(bk.captions) ? bk.captions : [];
    if (!caps.some(t => t.lang === 'en') || caps.length > 2) continue;   // >2 = full set already
    try {
      await fetch(`${site}/.netlify/functions/retranslate-captions-background`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, u: recId, b: i })
      });
    } catch (e) {}
  }
}

// Fire the written-update translation job (into every field language + English).
async function fireTranslate(recId) {
  const secret = process.env.SESSION_SECRET, site = process.env.SITE_BASE;
  if (!secret || !site) return;
  try {
    await fetch(`${site}/.netlify/functions/translate-update-background`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, recordId: recId })
    });
  } catch (e) {}
}

function resp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
