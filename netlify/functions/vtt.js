// Co-Labr — serve a caption track (WebVTT) for a published update's video block, same-origin
// and with the correct text/vtt MIME so iOS/Safari actually load it. Public (read-only).
const BASE = 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

exports.handler = async function (event) {
  const token = process.env.AIRTABLE_TOKEN;
  const q = event.queryStringParameters || {};
  const id = q.u; const bi = parseInt(q.b || '0', 10); const lang = (q.l || 'en');
  const hdr = { 'Content-Type': 'text/vtt; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' };
  if (!token || !id) return { statusCode: 400, headers: hdr, body: 'WEBVTT\n\n' };
  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}/${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return { statusCode: 404, headers: hdr, body: 'WEBVTT\n\n' };
    const c = (await r.json()).fields || {};
    let blocks = []; try { blocks = JSON.parse(c['Blocks'] || '[]'); } catch {}
    const bk = blocks[bi];
    let vtt = '';
    if (bk && Array.isArray(bk.captions)) {
      const cap = bk.captions.find(x => x && x.lang === lang) || bk.captions[0];
      if (cap && cap.vtt) vtt = cap.vtt;
    }
    return { statusCode: 200, headers: hdr, body: vtt || 'WEBVTT\n\n' };
  } catch (e) {
    return { statusCode: 500, headers: hdr, body: 'WEBVTT\n\n' };
  }
};
