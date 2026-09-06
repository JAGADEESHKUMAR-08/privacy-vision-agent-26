// verify_ml.js - Validates the in-browser ML engine forward pass against
// known training-time predictions. Runs the same math as ml-engine.js in Node.

const fs = require("fs");
const path = require("path");

// Shim for chrome.runtime.getURL used by ml-engine.js
global.chrome = {
  runtime: {
    getURL: (p) => "file://" + path.join(__dirname, "..", "extension", p).replace(/\\/g, "/"),
  },
};

const MODEL_DIR = path.join(__dirname, "..", "extension", "model");

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.join(MODEL_DIR, file), "utf8"));
}

// ---- Replicate ml-engine forward pass ----
const weights = loadJson("weights.json");
const wordIndex = loadJson("vocab.json");
const labelsArr = loadJson("labels.json");
const config = loadJson("config.json");

function matMul(A, B) {
  const rows = A.length, inner = B.length, cols = B[0].length;
  const out = new Array(rows);
  for (let i = 0; i < rows; i++) {
    out[i] = new Array(cols).fill(0);
    for (let j = 0; j < cols; j++) {
      let sum = 0;
      for (let k = 0; k < inner; k++) sum += A[i][k] * B[k][j];
      out[i][j] = sum;
    }
  }
  return out;
}
function matAddVec(M, b) {
  for (let i = 0; i < M.length; i++)
    for (let j = 0; j < M[0].length; j++) M[i][j] += b[j];
  return M;
}
function relu(M) {
  for (let i = 0; i < M.length; i++)
    for (let j = 0; j < M[0].length; j++) M[i][j] = M[i][j] > 0 ? M[i][j] : 0;
  return M;
}
function softmaxRows(M) {
  const out = new Array(M.length);
  for (let i = 0; i < M.length; i++) {
    let max = M[i][0];
    for (let j = 1; j < M[0].length; j++) if (M[i][j] > max) max = M[i][j];
    let sum = 0;
    out[i] = new Array(M[0].length);
    for (let j = 0; j < M[0].length; j++) { const e = Math.exp(M[i][j] - max); out[i][j] = e; sum += e; }
    for (let j = 0; j < M[0].length; j++) out[i][j] /= sum;
  }
  return out;
}
function embedPool(sequence) {
  const pooled = new Array(config.embed_dim).fill(0);
  let count = 0;
  for (const idx of sequence) {
    if (idx === 0) continue;
    const vec = weights.embedding[idx];
    for (let d = 0; d < config.embed_dim; d++) pooled[d] += vec[d];
    count++;
  }
  if (count > 0) for (let d = 0; d < config.embed_dim; d++) pooled[d] /= count;
  return [pooled];
}
function prepareText(text) {
  const words = text.toLowerCase().trim().split(/\s+/).filter((w) => w.length > 0);
  const seq = [];
  for (const w of words) {
    seq.push(wordIndex.hasOwnProperty(w) ? wordIndex[w] : 1);
    if (seq.length >= config.max_len) break;
  }
  while (seq.length < config.max_len) seq.push(0);
  return seq;
}
function classify(text) {
  const seq = prepareText(text);
  let h = embedPool(seq);
  h = matAddVec(matMul(h, weights.W1), weights.b1);
  h = relu(h);
  h = matAddVec(matMul(h, weights.W2), weights.b2);
  const probs = softmaxRows(h)[0];
  const result = labelsArr.map((label, i) => ({ label, score: probs[i] }));
  result.sort((a, b) => b.score - a.score);
  return result[0];
}

// ---- Test cases ----
const tests = [
  { input: "click the search button", expect: "click_button" },
  { input: "open my profile", expect: "click_link" },
  { input: "fill in the email field", expect: "fill_input" },
  { input: "scroll to the bottom", expect: "scroll" },
  { input: "find pending applications", expect: "search" },
  { input: "what time is it", expect: "unknown" },
  { input: "please click on settings", expect: "click_link" },
  { input: "i want to see my account", expect: "click_link" },
  { input: "search for documents", expect: "search" },
  { input: "type in the password", expect: "fill_input" },
  { input: "scroll down to comments", expect: "scroll" },
  { input: "fill the search box with application", expect: "fill_input" },
  { input: "open the applications link", expect: "click_link" },
  { input: "tell me a joke", expect: "unknown" },
  // Treat all 6 classes as reachable/learned
  { input: "search for pending applications", expect: "search" },
  { input: "scroll up to the header", expect: "scroll" },
  { input: "click the save changes button", expect: "click_button" },
  { input: "open the help center link", expect: "click_link" },
  { input: "fill the email field", expect: "fill_input" },
  { input: "play some music", expect: "unknown" },
];

let pass = 0, fail = 0;
for (const t of tests) {
  const r = classify(t.input);
  const ok = r.label === t.expect;
  if (ok) pass++; else fail++;
  console.log(
    (ok ? "PASS" : "FAIL") +
    `  '${t.input}' -> ${r.label} (${(r.score*100).toFixed(1)}%)` +
    (ok ? "" : `  [expected ${t.expect}]`)
  );
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
