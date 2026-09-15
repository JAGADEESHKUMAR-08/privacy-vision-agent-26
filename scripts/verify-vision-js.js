/**
 * Cross-check vision-inference.js (the vanilla-JS VisionNet port in
 * extension/) against the pure-NumPy reference (ml/vision/model.py).
 *
 * The Python reference produces scripts/vision_python_predictions.json
 * (see ml/vision/export_reference.py). This script loads the same crops,
 * runs the JS forward pass, and requires:
 *   - max |JS prob - Python prob| <= 0.02  (float32 vs float64 tolerance)
 *   - mean abs error <= 0.005
 *   - identical threshold decisions (prob > 0.5 -> sensitive) on all samples
 *
 * Usage: node scripts/verify-vision-js.js
 * Exit:   0 if PASS, 1 otherwise.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

global.chrome = {
  runtime: {
    getURL: (p) => 'file://' + path.join(ROOT, 'extension', p).replace(/\\/g, '/'),
  },
};

const ref = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'vision_python_predictions.json'), 'utf8')
);

const src0 = fs.readFileSync(path.join(ROOT, 'extension', 'vision-inference.js'), 'utf8');
const src = src0 + '\n;globalThis.__INIT_VISION = VISION;';

const fileFetch = async (url) => {
  const file = url.replace(/^file:\/+/, '').split('?')[0];
  const content = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(content) };
};

const sandbox = { console, fetch: fileFetch, chrome };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const VISION = sandbox.__INIT_VISION;

(async () => {
  await VISION.load();
  if (!VISION.isLoaded()) throw new Error('Vision model failed to load');
  console.log('Vision model loaded.');

  const n = ref.length;
  let maxErr = 0;
  let sumErr = 0;
  let decisionMismatches = 0;

  for (const r of ref) {
    const gray = Float32Array.from(r.gray);
    const jsProb = VISION.classify(gray);
    const refProb = r.prob;
    const err = Math.abs(jsProb - refProb);
    maxErr = Math.max(maxErr, err);
    sumErr += err;
    if ((jsProb > 0.5) !== (refProb > 0.5)) decisionMismatches++;
  }

  const meanErr = sumErr / n;
  console.log(`Samples:                 ${n}`);
  console.log(`Max |JS - Python| prob:  ${maxErr.toFixed(6)}`);
  console.log(`Mean abs error:          ${meanErr.toFixed(6)}`);
  console.log(`Threshold decision flips: ${decisionMismatches}`);

  const pass = maxErr <= 0.02 && meanErr <= 0.005 && decisionMismatches === 0;
  console.log(pass
    ? '\nRESULT: JS vision engine matches Python reference.'
    : '\nRESULT: VISION PARITY CHECK FAILED.');
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});