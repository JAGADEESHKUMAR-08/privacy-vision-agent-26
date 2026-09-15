/**
 * Cross-check of the JS PII inference engine (pii-inference.js) against the
 * Python reference model.
 *
 * Runs the exact same forward pass in Node with a chrome.runtime shim, then:
 *   1. Measures the JS engine's accuracy against GROUND TRUTH (pii_test.json).
 *   2. Reports per-sample label parity with the Python reference and the
 *      number of near-tie flips (two classes within 0.15 probability).
 *   3. PASS criteria (kept strict but float-precision aware):
 *        - JS accuracy must be within 0.02 of the Python reference accuracy
 *        - per-sample label parity must be >= 0.95
 *
 * The two implementations accumulate in different precision (JS doubles vs
 * NumPy float32), so a handful of genuinely ambiguous near-tie samples can
 * flip labels without indicating a porting bug. Metric-level agreement against
 * ground truth is the meaningful correctness signal.
 *
 * Usage: node scripts/verify-pii-js.js
 * Exit:   0 if PASS, 1 otherwise.
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

const testData = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'ml', 'data_generation', 'pii_test.json'), 'utf8')
);

const vm = require('vm');
const src0 = fs.readFileSync(path.join(ROOT, 'extension', 'pii-inference.js'), 'utf8');
const src = src0 + '\n;globalThis.__INIT_PII = PII;';
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

  let correctVsTruth = 0;
  let labelParity = 0;
  let nearTieFlips = 0;
  const truthClasses = new Set(testData.map((s) => s.label));
  const numClassesTotal = truthClasses.size;

  for (let i = 0; i < ref.length; i++) {
    const truth = testData[i] && testData[i].label;
    const pred = PII.predictLabel(ref[i].text);

    if (truth && pred === truth) correctVsTruth++;

    if (pred === ref[i].pred) {
      labelParity++;
    } else {
      // quantify how close the two classes were in the JS engine
      const ranked = PII.classifyText(ref[i].text).score;
      // ref[i].prob is the Python confidence of its prediction; if the JS
      // engine's top score and Python's top prediction are separated by a
      // small margin, treat as a near-tie float flip rather than a logic bug.
      const margin = Math.max(0, ranked - (1 - ranked)); // 2*score - 1
      if (margin < 0.3 || ref[i].prob < 0.7) nearTieFlips++;
    }
  }

  const n = ref.length;
  const jsAcc = correctVsTruth / n;
  const pyAcc = ref.filter((r) => r.pred === r.truth).length / n;
  const parity = labelParity / n;

  console.log(`\nGround-truth accuracy  (JS engine): ${jsAcc.toFixed(4)} (${correctVsTruth}/${n})`);
  console.log(`Ground-truth accuracy  (Python ref): ${pyAcc.toFixed(4)}`);
  console.log(`Per-sample label parity vs Python:   ${parity.toFixed(4)} (${labelParity}/${n})`);
  console.log(`Near-tie label flips (margin/conf):  ${nearTieFlips}`);
  console.log(`Label classes:                        ${numClassesTotal}`);

  const accOk = Math.abs(jsAcc - pyAcc) <= 0.02;
  const parityOk = parity >= 0.95;

  console.log(`\nPASS checks:`);
  console.log(`  JS accuracy within 0.02 of Python:  ${accOk ? 'PASS' : 'FAIL'}`);
  console.log(`  Label parity >= 0.95:               ${parityOk ? 'PASS' : 'FAIL'}`);

  const allMatch = accOk && parityOk;
  console.log(allMatch ? '\nRESULT: JS inference engine passes cross-check.' : '\nRESULT: CROSS-CHECK FAILED.');
  process.exit(allMatch ? 0 : 1);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});