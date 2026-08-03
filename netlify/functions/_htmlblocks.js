// Turn a Mailchimp campaign's HTML into ordered Co-Labr blocks (text + inline photos),
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

// Fragment of inner HTML → clean plain text with paragraph breaks preserved.
function htmlTextToPlain(frag) {
  if (!frag) return '';
  let t = frag;
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
  return t.replace(/\n{3,}/g, '\n\n').trim();
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
  return false;
}

// Only keep images that look like real, hosted content photos.
function isContentImg(src) {
  const s = (src || '').toLowerCase();
  return /(mcusercontent\.com|gallery\.mailchimp\.com|\.amazonaws\.com|files\.constantcontact|googleusercontent|cloudfront)/.test(s)
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
  const imgRe = /<img\b[^>]*>/gi;
  while ((m = imgRe.exec(h))) items.push({ pos: m.index, kind: 'img', src: attr(m[0], 'src'), w: parseInt(attr(m[0], 'width') || '0', 10) });
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
    // A text block may itself contain inline images — split so order is preserved.
    const seg = it.raw;
    const innerImg = /<img\b[^>]*>/gi;
    let last = 0, im;
    while ((im = innerImg.exec(seg))) {
      const before = seg.slice(last, im.index);
      const txt = htmlTextToPlain(before);
      if (txt) blocks.push({ type: 'text', text: txt });
      takeImage(attr(im[0], 'src'), parseInt(attr(im[0], 'width') || '0', 10));
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
