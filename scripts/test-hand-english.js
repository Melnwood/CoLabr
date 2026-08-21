// Exercises the REAL translate-update-background handler with every outbound call
// stubbed: Airtable, Google token, GCS upload and Anthropic. Costs nothing, touches
// nothing, and proves the one property that matters — a writer's own English is never
// regenerated and never overwritten.
const crypto = require('crypto');
const path = require('path');

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

process.env.AIRTABLE_TOKEN = 'tok';
process.env.ANTHROPIC_API_KEY = 'key';
process.env.GCS_BUCKET = 'bucket';
process.env.SESSION_SECRET = 'sekret';
process.env.GCP_SA_KEY = JSON.stringify({ client_email: 'x@y.z', private_key: privateKey });

let RECORD, uploads, asked, patched;

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const ok = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });

  if (u.includes('oauth2.googleapis.com')) return ok({ access_token: 'gt' });

  if (u.includes('storage.googleapis.com/upload')) {
    const name = decodeURIComponent(u.split('name=')[1] || '');
    uploads[name] = JSON.parse(opts.body);
    return ok({});
  }

  if (u.includes('api.anthropic.com')) {
    const prompt = JSON.parse(opts.body).messages[0].content;
    if (/ISO 639-1/.test(prompt)) return ok({ content: [{ text: 'cs' }] });
    const lines = prompt.split('\n').filter(l => /^\d+⟶ /.test(l)).map(l => l.replace(/^\d+⟶ /, ''));
    asked.push(lines);                                   // what the model was actually shown
    return ok({ content: [{ text: JSON.stringify(lines.map(l => 'MACHINE(' + l + ')')) }] });
  }

  if (u.includes('api.airtable.com')) {
    if ((opts.method || 'GET') === 'GET') {
      if (u.includes('tbli1L8AO0JUDL7Wl') || u.includes('tbl152sVfqGyrqpJQ')) return { ok: false, status: 404, json: async () => ({}) };
      return ok({ id: 'recTEST', fields: RECORD });
    }
    if (opts.method === 'PATCH') { patched.push(JSON.parse(opts.body)); return ok({}); }
    return ok({});                                        // the __TRANSLATE__ log row
  }
  throw new Error('unstubbed fetch: ' + u);
};

const modPath = path.resolve('netlify/functions/translate-update-background.js');
async function run(fields) {
  delete require.cache[modPath];
  RECORD = fields; uploads = {}; asked = []; patched = [];
  const { handler } = require(modPath);
  await handler({ httpMethod: 'POST', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ secret: 'sekret', recordId: 'recTEST' }) });
  return { uploads, asked, patched };
}

const CZ_STORY = 'Honza seděl na schodech.';
const CZ_PRAY  = 'Modlete se za Honzu.';
const base = (extra = {}) => ({
  Title: 'Zimní akademie',
  Blocks: JSON.stringify([
    { type: 'hero', url: 'u', heading: 'Zimní akademie', sub: '' },
    Object.assign({ type: 'text', text: CZ_STORY }, extra.text || {}),
    Object.assign({ type: 'prayer', text: CZ_PRAY }, extra.prayer || {}),
  ]),
});

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); }
};

(async () => {
  console.log('\n— 1. no hand English: everything is machine translated —');
  let r = await run(base());
  let en = r.uploads['translations/recTEST/en.json'];
  check('en.json written', !!en);
  check('story machine translated', en && en.blocks[1].text === 'MACHINE(' + CZ_STORY + ')', en && en.blocks[1].text);
  check('model was shown the story', JSON.stringify(r.asked).includes(CZ_STORY));

  console.log('\n— 2. hand English on the prayer block —');
  r = await run(base({ prayer: { en: { text: { v: 'Please pray for Honza.', h: 'abc123456789' } } } }));
  en = r.uploads['translations/recTEST/en.json'];
  check('hand English used verbatim', en && en.blocks[2].text === 'Please pray for Honza.', en && en.blocks[2].text);
  check('model NEVER shown that line', !JSON.stringify(r.asked).includes(CZ_PRAY), JSON.stringify(r.asked));
  check('other blocks still translated', en && en.blocks[1].text === 'MACHINE(' + CZ_STORY + ')');
  check('bookkeeping stripped from output', en && !('en' in en.blocks[2]), JSON.stringify(en && en.blocks[2]));

  console.log('\n— 3. the Czech changes underneath: hand English SURVIVES —');
  r = await run({ Title: 'Zimní akademie', Blocks: JSON.stringify([
    { type: 'hero', url: 'u', heading: 'Zimní akademie', sub: '' },
    { type: 'text', text: 'ÚPLNĚ JINÝ TEXT.' },
    { type: 'prayer', text: 'ZMĚNĚNÁ MODLITBA.', en: { text: { v: 'Please pray for Honza.', h: 'abc123456789' } } },
  ])});
  en = r.uploads['translations/recTEST/en.json'];
  check('hand English still intact after source edit', en && en.blocks[2].text === 'Please pray for Honza.', en && en.blocks[2].text);
  check('changed block WAS retranslated', en && en.blocks[1].text === 'MACHINE(ÚPLNĚ JINÝ TEXT.)');

  console.log('\n— 4. hand English is in the content hash (English-only edits publish) —');
  const noHand = await run(base());
  const withHand = await run(base({ prayer: { en: { text: { v: 'Pray for Honza.', h: 'h1' } } } }));
  const hOf = (res) => { const f = res.patched.map(p => p.records[0].fields['fld9BeSNNbZpUAtd0']).filter(Boolean).pop(); return f ? JSON.parse(f).h : null; };
  check('hash moves when only the English changed', hOf(noHand) && hOf(withHand) && hOf(noHand) !== hOf(withHand),
        hOf(noHand) + ' vs ' + hOf(withHand));

  console.log('\n— 5. hand English on EVERY line: no API call at all —');
  r = await run({ Title: 'T', Blocks: JSON.stringify([
    { type: 'hero', url: 'u', heading: 'Zimní akademie', sub: '', en: { __title: { v: 'Winter Academy', h: 'x' }, heading: { v: 'Winter Academy', h: 'y' } } },
    { type: 'text', text: CZ_STORY, en: { text: { v: 'Honza sat on the steps.', h: 'z' } } },
  ])});
  en = r.uploads['translations/recTEST/en.json'];
  check('title is the writer\'s own', en && en.title === 'Winter Academy', en && en.title);
  check('no translation call was made', r.asked.length === 0, JSON.stringify(r.asked));

  console.log('\n' + (fail ? 'FAILED ' + fail + ' / passed ' + pass : 'ALL ' + pass + ' CHECKS PASSED') + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('harness error:', e); process.exit(1); });
