// Turn a Mailchimp campaign's HTML into ordered Co·labr blocks (text + inline photos),
// preserving the order things appeared in the newsletter. Also returns a suggested cover
// (the first real content image). Dependency-free — tuned to Mailchimp's table markup.

const ENT = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', mdash:'—', ndash:'–',
  rsquo:'’', lsquo:'‘', rdquo:'”', ldquo:'“', hellip:'…', copy:'©', reg:'®', trade:'™', deg:'°' };

function decodeEntities(s) {
  return (s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n] !== undefined ? ENT[n] : (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m)));
}
function cp(n) { try { return String.fromCodePoint(n); } catch { return ''; } }

// Repair "mojibake": UTF-8 bytes that were mis-decoded as Windows-1252 (â€™, Â©, Ã©, …).
// Older Mailchimp campaigns are full of it. We only touch strings that show the tell-tale
// markers, and only when every char maps cleanly back to a byte — so correct text is untouched.
const CP1252 = { 0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F };
function fixMojibake(s) {
  if (!s || !/â€|Ã.|Â./.test(s)) return s;
  // Primary: reverse the cp1252-misdecode of UTF-8, byte-exact (also fixes accents).
  let ok = true; const bytes = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c <= 0xFF) bytes.push(c);
    else if (CP1252[c] !== undefined) bytes.push(CP1252[c]);
    else { ok = false; break; }
  }
  if (ok) { try { const dec = Buffer.from(bytes).toString('utf8'); if (!dec.includes('�')) return dec; } catch {} }
  // Fallback: targeted fixes for the common sequences (used only if the clean decode bails).
  return s
    .replace(/â€™/g, '’').replace(/â€˜/g, '‘')
    .replace(/â€œ/g, '“').replace(/â€/g, '”')
    .replace(/â€¦/g, '…').replace(/â€¢/g, '•').replace(/â€/g, '”')
    .replace(/Â©/g, '©').replace(/Â®/g, '®').replace(/Â /g, ' ').replace(/Â/g, '')
    .replace(/Ã©/g, 'é').replace(/Ã¨/g, 'è').replace(/Ã¡/g, 'á').replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó').replace(/Ãº/g, 'ú').replace(/Ã±/g, 'ñ').replace(/Ã¼/g, 'ü');
}

// Fragment of inner HTML → clean plain text with paragraph breaks preserved.
function htmlTextToPlain(frag) {
  if (!frag) return '';
  let t = fixMojibake(frag);
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi, '\n');
  t = t.replace(/<li[^>]*>/gi, '• ');
  t = t.replace(/<[^>]+>/g, '');
  t = decodeEntities(t);
  t = t.replace(/\*\|[^|]*\|\*/g, '');
  t = t.replace(/ /g, ' ').replace(/\r/g, '');
  t = t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

const FOOTER_RE = /(copyright ©|our mailing address is|want to change how you receive these emails|unsubscribe from this list|you can update your preferences|this email was sent to|add us to your address book|view this email in your browser)/i;
function stripFooter(text) {
  if (!text) return '';
  const m = text.match(FOOTER_RE);
  let t = m ? text.slice(0, m.index) : text;
  t = t.replace(/^\s*view this email in your browser\s*/i, '');
  // Mailchimp's default preview-text placeholder (and empty copyright remnants).
  t = t.replace(/Use this area to offer a short preview of your email['’]?s content\.?/gi, '');
  t = t.replace(/Copyright ©\s*,?\s*All rights reserved\.?/gi, '');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// Pick the sharpest source for an <img>: largest srcset candidate, else src
// (with WordPress's -WxH thumbnail suffix stripped so we get the original).
function bestSrc(tag) {
  const srcset = attr(tag, 'srcset');
  if (srcset) {
    let best = '', bw = 0;
    srcset.split(',').forEach(p => {
      const m = p.trim().match(/^(\S+)\s+(\d+)w/);
      if (m && +m[2] > bw) { bw = +m[2]; best = m[1]; }
    });
    if (best) return best;
  }
  let src = attr(tag, 'src');
  if (/wp-content\/uploads/.test(src)) src = src.replace(/-\d+x\d+(\.\w+)$/, '$1');
  return src;
}

function attr(tag, name) {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*["\\\']([^"\\\']*)["\\\']', 'i'));
  return m ? m[1] : '';
}

// Is this <img> decorative/junk rather than real content?
function isJunkImg(src, w) {
  if (!src) return true;
  const s = src.toLowerCase();
  if (w && w > 0 && w <= 4) return true;                                  // spacers
  if (/spacer|clear\.gif|transparent|pixel|1x1|blank\.gif/.test(s)) return true;
  if (/cdn-images\.mailchimp\.com\/(icons|templates|monkey_rewards)/.test(s)) return true; // template/social/badge icons
  if (/(facebook|twitter|instagram|youtube|linkedin|pinterest|tumblr|vimeo|soundcloud|snapchat|tiktok)/.test(s)
      && /(icon|soc|share|\.png|\.svg)/.test(s)) return true;            // social icons
  if (/(track|beacon|open\.php|impression|\/o\.gif)/.test(s)) return true;
  if (/\/logo|logo\.|-logo|_logo|wordmark|masthead|header-?image/.test(s)) return true; // org logo/header
  if (/signature/.test(s)) return true;                                   // signed-letter signature images
  return false;
}

// Only keep images that look like real, hosted content photos.
function isContentImg(src) {
  const s = (src || '').toLowerCase();
  return /(mcusercontent\.com|gallery\.mailchimp\.com|\.amazonaws\.com|files\.constantcontact|googleusercontent|cloudfront)/.test(s)
    || /wp-content\/uploads/.test(s)
    || /\/images\//.test(s);
}

// Main: html string -> { cover, blocks: [...] }
function htmlToBlocks(html, opts) {
  opts = opts || {};
  const knownCover = (opts.cover || '').replace(/^http:\/\//i, 'https://').toLowerCase();
  if (!html) return { cover: '', blocks: [] };

  let h = html;
  const bodyM = h.match(/<body[\s\S]*?<\/body>/i);
  if (bodyM) h = bodyM[0];
  h = h.replace(/<!--[\s\S]*?-->/g, '')
       .replace(/<head[\s\S]*?<\/head>/gi, '')
       .replace(/<style[\s\S]*?<\/style>/gi, '')
       .replace(/<script[\s\S]*?<\/script>/gi, '');

  // Collect text blocks and standalone images, tagged with their source position.
  const items = [];
  const textRe = /<td[^>]*class="[^"]*mcnTextContent[^"]*"[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = textRe.exec(h))) items.push({ pos: m.index, kind: 'text', raw: m[1] });
  // Not a Mailchimp campaign? Fall back to generic article HTML (WordPress posts etc.):
  // paragraphs and blockquotes become text, h2-h4 become headings.
  if (!items.length) {
    const pRe = /<(p|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    while ((m = pRe.exec(h))) items.push({ pos: m.index, kind: 'text', raw: m[2] });
    const hRe = /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    while ((m = hRe.exec(h))) items.push({ pos: m.index, kind: 'head', raw: m[2] });
  }
  const imgRe = /<img\b[^>]*>/gi;
  while ((m = imgRe.exec(h))) items.push({ pos: m.index, kind: 'img', src: bestSrc(m[0]), w: parseInt(attr(m[0], 'width') || '0', 10) });
  items.sort((a, b) => a.pos - b.pos);

  const blocks = [];
  let cover = '';
  const seen = new Set();
  if (knownCover) seen.add(knownCover);

  function takeImage(src, w) {
    if (!src) return;
    if (isJunkImg(src, w)) return;
    if (!isContentImg(src)) return;
    const norm = src.replace(/^http:\/\//i, 'https://');
    const key = norm.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (!cover && !knownCover) { cover = norm; return; }   // first real image is the cover
    blocks.push({ type: 'photo', url: norm });
  }

  for (const it of items) {
    if (it.kind === 'img') { takeImage(it.src, it.w); continue; }
    if (it.kind === 'head') { const t = htmlTextToPlain(it.raw); if (t) blocks.push({ type: 'heading', text: t }); continue; }
    // A text block may itself contain inline images — split so order is preserved.
    const seg = it.raw;
    const innerImg = /<img\b[^>]*>/gi;
    let last = 0, im;
    while ((im = innerImg.exec(seg))) {
      const before = seg.slice(last, im.index);
      const txt = htmlTextToPlain(before);
      if (txt) blocks.push({ type: 'text', text: txt });
      takeImage(bestSrc(im[0]), parseInt(attr(im[0], 'width') || '0', 10));
      last = im.index + im[0].length;
    }
    const tail = htmlTextToPlain(seg.slice(last));
    if (tail) blocks.push({ type: 'text', text: tail });
  }

  // Strip footer boilerplate from text blocks; drop any that become empty.
  const cleaned = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      const t = stripFooter(b.text);
      if (t) cleaned.push({ type: 'text', text: t });
    } else cleaned.push(b);
  }
  // Merge adjacent text blocks (Mailchimp often splits one paragraph across cells).
  const merged = [];
  for (const b of cleaned) {
    const prev = merged[merged.length - 1];
    if (b.type === 'text' && prev && prev.type === 'text') prev.text += '\n\n' + b.text;
    else merged.push(b);
  }
  return { cover, blocks: merged };
}

module.exports = { htmlToBlocks, htmlTextToPlain, decodeEntities };
