// Co·labr — repair Mailchimp imports that came over as photos-only. Some campaigns'
// HTML defeated the text extractor, so their Blocks hold just images while the whole
// story sits unused in Body — the wall opens to pictures and silence. This rebuilds
// those records: Body is cleaned of Mailchimp chrome (masthead tagline, footer,
// unsubscribe block) and becomes text blocks, followed by the existing photos.
// Secret-gated, idempotent: repaired records gain text blocks and stop matching.
const BASE = process.env.AIRTABLE_BASE || 'appsSmwptTnmK4luA';
const TABLE = 'tbl7aVErl35Qw36QZ';

// Junk is filtered LINE by line — old plain-text campaigns mix real signatures with
// "[2]Friend us on Facebook" in the same paragraph, so paragraph-level drops lose story.
const DROPLINE = [
  /^A movement of God among the youth/i,     // newsletter masthead tagline
  /^Equipping young leaders to fulfill/i,    // footer tagline
  /^josiahventure$/i,                        // bare footer logo alt text
  /^This email was sent/i,
  /why did I get this/i,
  /unsubscribe/i,
  /update subscription preferences/i,
  /friend us on facebook/i,
  /forward this to them/i,
  /^send to a friend$/i,
  /^links:$/i,
  /^\d+\.\s*$/,                              // orphaned "1." link-reference stubs
  /\(mailto:\)/,
];

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return j(405);
    let b; try { b = JSON.parse(event.body || '{}'); } catch { return j(400); }
    if (!b.secret || (b.secret !== process.env.SESSION_SECRET && b.secret !== process.env.IMPORT_SECRET)) return j(401);
    const token = process.env.AIRTABLE_TOKEN; if (!token) return j(500);
    const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;

    let recs = [], offset = '';
    const f = encodeURIComponent(`AND({Source}='Mailchimp import', LEN({Body})>0)`);
    do {
      const r = await fetch(`${api}?pageSize=100&filterByFormula=${f}${offset ? '&offset=' + offset : ''}`, { headers: auth });
      if (!r.ok) break;
      const d = await r.json(); recs = recs.concat(d.records || []); offset = d.offset || '';
    } while (offset);

    let fixed = 0, skipped = 0;
    for (const rec of recs) {
      const c = rec.fields || {};
      let blocks = []; try { blocks = JSON.parse(c['Blocks'] || '[]'); } catch { skipped++; continue; }
      const hasText = blocks.some(x => x && ['text', 'heading', 'quote', 'prayer', 'praise', 'numbers'].includes(x.type));
      if (hasText) { skipped++; continue; }   // healthy import — leave alone

      const paras = String(c['Body'] || '')
        .replace(/\r/g, '')
        .split(/\n\s*\n/)
        .map(p => p.split('\n')
          .filter(l => !DROPLINE.some(rx => rx.test(l.trim())))
          .join('\n').replace(/\[\d+\]/g, '').trim())
        .filter(Boolean);
      if (!paras.length) { skipped++; continue; }   // nothing recoverable (footer-only Body)

      // The story leads; the imported photos follow as a gallery (the wall reader
      // already dedupes whichever photo doubles as the cover).
      const rebuilt = paras.map(t => ({ type: 'text', text: t })).concat(blocks);
      const pr = await fetch(api, { method: 'PATCH', headers: auth,
        body: JSON.stringify({ records: [{ id: rec.id, fields: { Blocks: JSON.stringify(rebuilt) } }], typecast: true }) });
      if (pr.ok) fixed++; else skipped++;
    }
    console.log('fix-import-text', JSON.stringify({ scanned: recs.length, fixed, skipped }));
    return j(200);
  } catch (e) { console.log('fix-import-text EXCEPTION', String(e && e.message || e)); return j(200); }
};
function j(s) { return { statusCode: s, body: '{}' }; }
