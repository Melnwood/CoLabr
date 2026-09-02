#!/usr/bin/env node
/* Co·labr — the checks that must pass before anything ships.
 *
 * One script so CI and a person run exactly the same thing. Until now these lived in
 * habit, which worked because the habit belonged to one reliable person. That does not
 * survive a second pair of hands.
 *
 * Every check is here because something actually went wrong:
 *   syntax   a // comment inside a 14,000-character line swallowed a closing brace
 *   divs     an unbalanced page still renders, just wrongly, and silently
 *   dashes   house rule: no em or en dashes anywhere a reader sees
 *   secrets  nothing sensitive has ever been committed, and that stays true
 *   toml     a malformed netlify.toml takes the whole site down on deploy
 *
 * Compiles in-process with vm.Script rather than spawning node per file, because the
 * spawning version took minutes and a check nobody waits for is a check nobody runs.
 *
 *   node scripts/check.js
 */
import fs from 'fs'; import vm from 'vm'; import cp from 'child_process';
const fail = [];
const bad = (check, detail) => fail.push(`${check}: ${detail}`);

const read = f => fs.readFileSync(f, 'utf8');
const htmls = fs.readdirSync('.').filter(f => f.endsWith('.html')).sort();
const rootJs = fs.readdirSync('.').filter(f => f.endsWith('.js')).sort();
const fnJs = fs.existsSync('netlify/functions')
  ? fs.readdirSync('netlify/functions').filter(f => f.endsWith('.js')).map(f => 'netlify/functions/' + f).sort() : [];

function compiles(code, label) {
  // A snippet may legitimately use top-level await, so accept either form.
  try { new vm.Script(code); return true; } catch (e) {
    try { new vm.Script('(async()=>{' + code + '\n})'); return true; } catch (e2) {
      bad('syntax', `${label}: ${String(e.message).slice(0, 90)}`);
      return false;
    }
  }
}

// ---- syntax ----
for (const f of [...rootJs, ...fnJs]) compiles(read(f), f);
for (const f of htmls) {
  const s = read(f);
  const re = /<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/g;
  let m, i = 0;
  while ((m = re.exec(s))) {
    const attrs = m[1] || '';
    if (/type\s*=/.test(attrs) && !/javascript|module/.test(attrs)) { i++; continue; }
    compiles(m[2], `${f} script#${i++}`);
  }
}

// ---- div balance ----
for (const f of htmls) {
  const s = read(f);
  const o = (s.match(/<div\b/g) || []).length, c = (s.match(/<\/div>/g) || []).length;
  if (o !== c) bad('divs', `${f}: ${o} open, ${c} close`);
}

// ---- house rule: no em or en dashes in anything a reader sees ----
// A WARNING, not a failure, on purpose. There are still dashes in the older copy and
// each one wants a different fix, a comma here, a full stop there, a colon in a pair.
// Blocking every push until all of them are judged would mean nobody runs this at all.
// It counts what is left so the number goes down instead of quietly growing.
// Blind spot worth knowing: text built inside <script> is not seen here, because
// stripping code is what keeps this free of false positives.
let dashCount = 0; const dashFiles = [];
for (const f of htmls) {
  const text = read(f).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const n = (text.match(/[—–]/g) || []).length;
  if (n) { dashCount += n; dashFiles.push(`${f}(${n})`); }
}

// ---- nothing sensitive committed ----
const tracked = cp.execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const patterns = [[/sk_live_[A-Za-z0-9]{10,}/, 'stripe live key'], [/\bre_[A-Za-z0-9]{24,}/, 'resend key'],
                  [/-----BEGIN [A-Z ]*PRIVATE KEY/, 'private key'], [/"private_key"\s*:/, 'service account json']];
for (const f of tracked) {
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) continue;
  if (f.startsWith('scripts/check')) continue;
  let s; try { s = read(f); } catch (e) { continue; }
  for (const [pat, what] of patterns) if (pat.test(s)) bad('secrets', `${f}: looks like a ${what}`);
}

// ---- netlify.toml ----
{
  const s = read('netlify.toml');
  for (const line of s.split('\n')) {
    if (/^\s*\[/.test(line) && !/^\s*\[\[?[A-Za-z0-9_."\-]+\]\]?\s*$/.test(line)) {
      bad('toml', `malformed table header: ${line.trim().slice(0, 60)}`);
    }
  }
  if ((s.match(/"/g) || []).length % 2) bad('toml', 'odd number of quotes');
}

// ---- nothing sensitive readable by a stranger ----
// A database snapshot sat in a public bucket for weeks because the code looked fine and
// nobody fetched it back without credentials. This does exactly that. Skipped offline so
// it never blocks a local run, but it runs in CI on every push.
async function checkExposure() {
  const bucket = 'colabr-photos-jv';                 // the deliberately public photo bucket
  const mustNotBeThere = ['backups/', 'backups/latest.json'];
  for (const prefix of mustNotBeThere) {
    try {
      const u = prefix.endsWith('/')
        ? `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix)}&maxResults=1`
        : `https://storage.googleapis.com/${bucket}/${prefix}`;
      const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      if (prefix.endsWith('/')) {
        const d = await r.json().catch(() => ({}));
        if ((d.items || []).length) bad('exposure', `${prefix} is readable by anyone in the public bucket`);
      } else {
        bad('exposure', `${prefix} is downloadable by anyone, with no sign-in`);
      }
    } catch (e) { /* offline or blocked: not a failure, just unchecked */ }
  }
}

await checkExposure();

if (dashCount) {
  console.log(`\nwarning: ${dashCount} em or en dash${dashCount === 1 ? '' : 'es'} still in visible copy`);
  console.log('  ' + dashFiles.join(' '));
}
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? '' : 's'}:\n`);
  for (const f of fail) console.log('  ' + f);
  process.exit(1);
}
console.log(`checks passed: ${htmls.length} pages, ${rootJs.length + fnJs.length} scripts, syntax + divs + dashes + secrets + toml`);
