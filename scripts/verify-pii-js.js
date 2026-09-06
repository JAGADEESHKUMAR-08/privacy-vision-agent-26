/**
 * Cross-checks the JS PII inference engine (pii-inference.js) against the
 * Python reference predictions (scripts/pii_python_predictions.json).
 *
 * Runs the exact same forward pass in Node with a chrome.runtime shim and
 * compares predicted labels per sample. Any mismatch indicates a porting bug.
 *
 * Usage: node scripts/verify-pii-js.js
 * Exit:   0 if all match, 1 otherwise.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

global.chrome = {
  runtime: {
    getURL: (p) => 'file://' + path.join(ROOT, 'extension', p).replace(/\\/g, '/'),
  },
};

const ref = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'pii_python_predictions.json'), 'utf8')
);

// Load the vanilla JS engine into a shared VM context so its top-level
// `const PII = ...` binding stays accessible across calls.
const vm = require('vm');
const src0 = fs.readFileSync(path.join(ROOT, 'extension', 'pii-inference.js'), 'utf8');
// Append a hoist so the lexical `const PII` is reachable from the sandbox.
const src = src0 + '\n;globalThis.__INIT_PII = PII;';
// Node's global fetch cannot read file:// URLs; shim it to read from disk.
const fileFetch = async (url) => {
  const file = url.replace(/^file:\/+/, '').split('?')[0];
  const content = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(content) };
};
const sandbox = { console, fetch: fileFetch, chrome };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const PII = sandbox.__INIT_PII;

(async () => {
  await PII.load();
  console.log('JS model loaded:', PII.isLoaded());

  let matches = 0;
  let mismatches = 0;
  const examples = [];

  for (const r of ref) {
    let pred;
    try {
      pred = PII.predictLabel(r.text);
    } catch (e) {
      console.error('JS classify error for:', JSON.stringify(r.text), e.message);
      mismatches++;
      continue;
    }
    if (pred === r.pred) {
      matches++;
    } else {
      mismatches++;
      if (examples.length < 15) examples.push({ text: r.text, py: r.pred, js: pred });
    }
  }

  console.log(`\nMatching labels: ${matches}/${ref.length}`);
  console.log(`Mismatches:      ${mismatches}`);
  if (examples.length) {
    console.log('\nFirst mismatches:');
    for (const e of examples) {
      console.log(`  py=${e.py.padEnd(16)} js=${e.js.padEnd(16)} text=${JSON.stringify(e.text)}`);
    }
  }

  const allMatch = mismatches === 0;
  console.log(allMatch ? '\nRESULT: JS matches Python reference exactly.' : '\nRESULT: MISMATCH detected.');
  process.exit(allMatch ? 0 : 1);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
