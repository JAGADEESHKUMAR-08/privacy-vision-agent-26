/**
 * Privacy Vision Agent - Benchmarking Suite (honest rewrite)
 *
 * Compares four detection approaches against the pii_test.json dataset, using
 * ONLY predictions derived from the input text - never from the ground-truth
 * label (the previous "full pipeline" leaked labels and was dishonest).
 *
 *   A. Regex-Only        - pattern matching with no context
 *   B. DOM-Enhanced      - regex plus simulated DOM context signals
 *   C. ML-Only           - the real on-device PII classifier (pii-inference.js)
 *                          runs a genuine forward pass on the raw text
 *   D. Hybrid (Regex+ML) - ensemble: union of regex and ML detections
 *
 * Measures: accuracy, per-class precision/recall/F1, macro + weighted F1,
 *           average detection time, memory.
 *
 * Usage:  node benchmark/run.js
 * Output: console tables + benchmark/results.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TEST_DATA_PATH = path.resolve(ROOT, 'ml', 'data_generation', 'pii_test.json');
const RESULTS_PATH = path.resolve(__dirname, 'results.json');

// ─── Test Data Loading ───────────────────────────────────────────────────────

let testData;
try {
  testData = JSON.parse(fs.readFileSync(TEST_DATA_PATH, 'utf-8'));
} catch (err) {
  console.error('[Benchmark] Failed to load test data:', err.message);
  process.exit(1);
}

// ─── Real PII ML Engine (loaded from extension) ──────────────────────────────

// Shim for chrome.runtime.getURL + a file:// fetch shim (Node has no file fetch).
global.chrome = {
  runtime: {
    getURL: (p) => 'file://' + path.join(ROOT, 'extension', p).replace(/\\/g, '/'),
  },
};
const fileFetch = async (url) => {
  const file = url.replace(/^file:\/+/, '').split('?')[0];
  const content = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(content) };
};
const sandbox = { console, fetch: fileFetch, chrome };
vm.createContext(sandbox);
const engineSrc = fs.readFileSync(path.join(ROOT, 'extension', 'pii-inference.js'), 'utf8');
vm.runInContext(engineSrc + '\n;globalThis.__INIT_PII = PII;', sandbox);
const PII = sandbox.__INIT_PII;

// ─── Label Mapping (dataset labels -> internal PII categories) ───────────────

const LABEL_MAP = {
  EMAIL: 'EMAIL', PHONE: 'PHONE', NAME: 'NAME', ADDRESS: 'ADDRESS',
  PASSWORD: 'PASSWORD', USERNAME: 'USERNAME', CREDIT_CARD: 'CREDIT_CARD',
  BANK_ACCOUNT: 'BANK_ACCOUNT', API_KEY: 'API_KEY', AUTH_TOKEN: 'AUTH_TOKEN',
  DATE_OF_BIRTH: 'DATE_OF_BIRTH', SSN: 'GOVERNMENT_ID', MEDICAL_ID: 'MEDICAL_ID',
  FINANCIAL_DATA: 'FINANCIAL_DATA', NONE: 'NONE',
};

// The ML model emits its own class names (uses SSN directly); map through the
// same table so categories are comparable, and drop NONE (no detection).
function mlLabelToCategory(mlLabel) {
  return LABEL_MAP[mlLabel] || mlLabel;
}

// ─── Regex Detection Patterns (ported from content.js) ───────────────────────

const EMAIL_EXCLUSIONS = new Set([
  'example.com', 'test.com', 'localhost', 'domain.com',
  'email.com', 'mail.com', 'sentry.io', 'wixpress.com',
  'example.org', 'example.net', 'test.org', 'invalid',
]);
const EMAIL_FILTER = /^(?:test|admin|info|noreply|no-reply|support|hello|webmaster|postmaster|abuse)@/i;
const TRUSTED_DOMAINS = new Set([
  'google.com', 'microsoft.com', 'apple.com', 'github.com',
  'mozilla.org', 'w3.org', 'schema.org', 'cloudflare.com',
]);

function luhnCheck(num) {
  const digits = num.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (isNaN(n)) return false;
    if (alternate) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function isValidPhone(value) {
  const stripped = value.replace(/[\s()+.\-]/g, '');
  if (stripped.length < 7 || stripped.length > 15) return false;
  if (/^\d{7,8}$/.test(stripped)) return false;
  const digitCount = stripped.replace(/\D/g, '').length;
  return digitCount >= 7 && digitCount <= 15;
}

function normalizePhone(raw) {
  return raw.replace(/[\s()+.\-]/g, '');
}

function findMatches(text, patterns) {
  const results = [];
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let match;
    while ((match = re.exec(text)) !== null) results.push(match[0]);
  }
  return results;
}

// ─── Regex-Only Detection ────────────────────────────────────────────────────

function detectRegexOnly(text) {
  if (!text || text.trim().length === 0) return [];
  const entities = [];
  const seen = new Set();

  function add(type, value, confidence) {
    const key = type + ':' + value;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({ type, value, confidence });
  }

  const emailRe = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;
  let m;
  while ((m = emailRe.exec(text)) !== null) {
    const email = m[0];
    const domain = email.split('@')[1]?.toLowerCase() || '';
    if (EMAIL_EXCLUSIONS.has(domain)) continue;
    if (EMAIL_FILTER.test(email)) continue;
    let conf = 0.9;
    if (TRUSTED_DOMAINS.has(domain)) conf -= 0.2;
    if (conf > 0.2) add('EMAIL', email, Math.min(conf, 1));
  }

  const phonePatterns = [
    /\+?\d{1,3}[\s.\-]?\(?\d{2,4}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}/g,
    /\(\d{3}\)\s?\d{3}[\s.\-]\d{4}/g,
    /\d{3}[\s.\-]\d{3}[\s.\-]\d{4}/g,
    /\d{5}\s\d{6}/g,
  ];
  const phoneSeen = new Set();
  for (const re of phonePatterns) {
    for (const phone of findMatches(text, [re])) {
      if (!isValidPhone(phone)) continue;
      const normalized = normalizePhone(phone);
      if (phoneSeen.has(normalized)) continue;
      phoneSeen.add(normalized);
      let conf = 0.85;
      if (normalized.startsWith('+')) conf += 0.05;
      if (/^\+1?\d{10}$/.test(normalized)) conf += 0.03;
      add('PHONE', phone, Math.min(conf, 1));
    }
  }

  const ccPatterns = [
    /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,
    /\b\d{4}[\s\-]?\d{6}[\s\-]?\d{4}\b/g,
    /\b\d{4}[\s\-]?\d{5}[\s\-]?\d{5}\b/g,
  ];
  const ccSeen = new Set();
  for (const re of ccPatterns) {
    for (const cc of findMatches(text, [re])) {
      if (!luhnCheck(cc)) continue;
      const digits = cc.replace(/\D/g, '');
      if (ccSeen.has(digits)) continue;
      ccSeen.add(digits);
      add('CREDIT_CARD', cc, 0.95);
    }
  }

  const govPatterns = [
    /\b\d{3}-?\d{2}-?\d{4}\b/g, /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    /\b[A-Z]{5}\d{4}[A-Z]\b/gi, /\b\d{12}\b/g, /\b[A-Z]{1,2}\d{6,7}[A-Z\d]\b/gi,
  ];
  for (const re of govPatterns) {
    for (const gov of findMatches(text, [re])) {
      const stripped = gov.replace(/[\s\-]/g, '');
      let conf = 0;
      if (/^\d{3}-?\d{2}-?\d{4}$/.test(stripped)) conf = 0.92;
      else if (/^\d{4}\s?\d{4}\s?\d{4}$/.test(stripped)) conf = 0.88;
      else if (/^[A-Z]{5}\d{4}[A-Z]$/i.test(stripped)) conf = 0.9;
      else if (/^[A-Z]\d{7,8}$/i.test(stripped)) conf = 0.85;
      else if (/^\d{12}$/.test(stripped)) conf = 0.8;
      else if (/^[A-Z]{1,2}\d{6,7}[A-Z\d]$/i.test(stripped)) conf = 0.82;
      else continue;
      add('GOVERNMENT_ID', gov, conf);
    }
  }

  const apiKeyPatterns = [
    /\b(?:sk|pk|ak|rk|ghp|gho|ghu|ghs|github_pat|xox[baprs])[_\-]?[A-Za-z0-9\-]{16,}\b/g,
    /\b(?:AIza)[A-Za-z0-9_\-]{35}\b/g,
    /(?:api[_\-]?key|apikey|secret[_\-]?key|access[_\-]?key)\s*[:=]\s*['"]?([A-Za-z0-9_\-]{20,})['"]?/gi,
  ];
  for (const re of apiKeyPatterns) {
    for (const key of findMatches(text, [re])) {
      let conf = 0.7;
      if (/\bsk[_\-](?:live[_\-]|test[_\-]|prod[_\-])?[A-Za-z0-9]{16,64}\b/.test(key)) conf = 0.95;
      else if (/\bpk[_\-](?:live[_\-]|test[_\-]|prod[_\-])?[A-Za-z0-9]{16,64}\b/.test(key)) conf = 0.95;
      else if (/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/.test(key)) conf = 0.98;
      else if (/\b(?:xox[baprs])-[A-Za-z0-9\-]{10,48}\b/.test(key)) conf = 0.97;
      else if (/\b(?:AIza)[A-Za-z0-9_\-]{35}\b/.test(key)) conf = 0.96;
      add('API_KEY', key, conf);
    }
  }

  const jwtMatches = findMatches(text, [/\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g]);
  for (const jwt of jwtMatches) {
    let conf = 0.7;
    const parts = jwt.split('.');
    if (parts.length === 3) {
      try {
        const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
        if (header.alg && header.typ) conf = 0.97;
      } catch { conf = 0.7; }
    }
    add('AUTH_TOKEN', jwt, conf);
  }
  for (const b of findMatches(text, [/Bearer\s+[A-Za-z0-9_\-\.]{20,}/gi])) add('AUTH_TOKEN', b, 0.95);
  for (const t of findMatches(text, [/\b(?:sess|sid|token|jwt)[_\-]?[A-Za-z0-9_\-]{20,}\b/gi])) add('AUTH_TOKEN', t, 0.85);

  for (const med of findMatches(text, [/\b(?:MRN|mrn)[\s.\-]?\d{6,10}\b/gi])) {
    let conf = 0.75;
    if (/^MRN[\s.\-]?\d{6,10}$/i.test(med)) conf = 0.88;
    add('MEDICAL_ID', med, conf);
  }

  for (const bank of findMatches(text, [
    /\b(?:account|acct)[\s.#:_\-]*(?:number|#|no\.?)?[\s:#_]*(\d{8,17})\b/gi,
    /\b(?:routing|rtn|aba)[\s.#:_\-]*(?:number|#|no\.?)?[\s:#_]*(\d{9})\b/gi,
  ])) add('BANK_ACCOUNT', bank, 0.82);

  const streetRe = /\d+\s+[A-Za-z0-9\s]+(?:st|nd|rd|th|ave|blvd|dr|ln|way|ct|pl|cir|hwy|terr|trail|pkwy)\b/i;
  const zipRe = /\b\d{5}(?:-\d{4})?\b/;
  const addrParts = text.split(/[;|\n]/);
  for (const part of addrParts) {
    const trimmed = part.trim();
    if (trimmed.length > 5 && trimmed.length < 200) {
      if (streetRe.test(trimmed) && zipRe.test(trimmed)) add('ADDRESS', trimmed, 0.88);
      else if (streetRe.test(trimmed)) add('ADDRESS', trimmed, 0.75);
    }
  }

  const currencyRe = /^[\$€£¥]\s?\d{1,3}(?:[,.]\d{3})*(?:\.\d{2})?$/;
  const currencyAltRe = /^\d{1,3}(?:[,.]\d{3})*(?:\.\d{2})?\s?(?:USD|EUR|GBP|INR|JPY|CAD|AUD)$/i;
  const trimmedText = text.trim();
  if (currencyRe.test(trimmedText) || currencyAltRe.test(trimmedText)) {
    const numStr = text.replace(/[^0-9.]/g, '');
    const amount = parseFloat(numStr);
    if (!isNaN(amount) && amount > 0) {
      const conf = amount > 100000 ? 0.65 : amount > 10000 ? 0.55 : 0.45;
      add('FINANCIAL_DATA', trimmedText, conf);
    }
  }

  const dobPatterns = [
    /\b(?:0[1-9]|1[0-2])[\/\-.](?:0[1-9]|[12]\d|3[01])[\/\-.](?:19|20)\d{2}\b/,
    /\b(?:0[1-9]|[12]\d|3[01])[\/\-.](?:0[1-9]|1[0-2])[\/\-.](?:19|20)\d{2}\b/,
    /\b(?:19|20)\d{2}[\/\-.](?:0[1-9]|1[0-2])[\/\-.](?:0[1-9]|[12]\d|3[01])\b/,
  ];
  for (const re of dobPatterns) {
    if (re.test(trimmedText)) { add('DATE_OF_BIRTH', trimmedText, 0.5); break; }
  }

  return entities;
}

// ─── DOM-Context-Enhanced Detection ──────────────────────────────────────────

function buildSimulatedDOMContext(text, label) {
  const lower = text.toLowerCase();
  const hints = {
    hasPasswordField: false, hasFinancialField: false, hasMedicalField: false,
    hasGovernmentField: false, hasEmailField: false, hasPhoneField: false,
    hasBirthField: false,
  };
  if (/password|passwd|secret|login|sign.?in|credential/i.test(text)) {
    hints.hasPasswordField = true;
    hints.hasEmailField = true;
  }
  if (/credit|card|account|routing|payment|bank|checkout|billing/i.test(text)) hints.hasFinancialField = true;
  if (/medical|health|patient|diagnosis|mrn|prescription|hospital|clinic/i.test(text)) hints.hasMedicalField = true;
  if (/ssn|social.?security|aadhaar|pan.?card|passport|government|national.?id/i.test(text)) hints.hasGovernmentField = true;
  if (/email|e-?mail|inbox|compose/i.test(text)) hints.hasEmailField = true;
  if (/phone|mobile|tel|call|contact/i.test(text)) hints.hasPhoneField = true;
  if (/birth|dob|date.?of.?birth/i.test(text)) hints.hasBirthField = true;
  return hints;
}

// NOTE: `label` is passed only to reproduce DOM-context heuristics equivalent to
// what real page-DOM inspection would provide. It is never used to inject the
// ground-truth answer directly (that would be dishonest).
function detectDOMEnhanced(text, label) {
  const regexEntities = detectRegexOnly(text);
  const domContext = buildSimulatedDOMContext(text, label);

  for (const entity of regexEntities) {
    if (entity.type === 'EMAIL' && domContext.hasEmailField) entity.confidence = Math.min(entity.confidence + 0.08, 1);
    if (entity.type === 'PHONE' && domContext.hasPhoneField) entity.confidence = Math.min(entity.confidence + 0.1, 1);
    if (entity.type === 'CREDIT_CARD' && domContext.hasFinancialField) entity.confidence = Math.min(entity.confidence + 0.05, 1);
    if (entity.type === 'GOVERNMENT_ID' && domContext.hasGovernmentField) entity.confidence = Math.min(entity.confidence + 0.1, 0.98);
    if (entity.type === 'MEDICAL_ID' && domContext.hasMedicalField) entity.confidence = Math.min(entity.confidence + 0.1, 0.95);
    if (entity.type === 'BANK_ACCOUNT' && domContext.hasFinancialField) entity.confidence = Math.min(entity.confidence + 0.05, 0.9);
    if (entity.type === 'FINANCIAL_DATA' && domContext.hasFinancialField) entity.confidence = Math.min(entity.confidence + 0.15, 0.85);
    if (entity.type === 'DATE_OF_BIRTH' && domContext.hasBirthField) entity.confidence = Math.min(entity.confidence + 0.35, 0.9);
  }

  if (domContext.hasPasswordField && text.length >= 4 && text.length <= 128) {
    if (!regexEntities.some((e) => e.type === 'PASSWORD')) {
      regexEntities.push({ type: 'PASSWORD', value: text.trim(), confidence: 0.95 });
    }
  }
  if (/username|user.?name|login|handle/i.test(text) || domContext.hasPasswordField) {
    if (text.length >= 3 && text.length <= 30 && /^[A-Za-z0-9_\-\.]+$/.test(text.trim())) {
      if (!regexEntities.some((e) => e.type === 'USERNAME')) {
        regexEntities.push({ type: 'USERNAME', value: text.trim(), confidence: 0.65 });
      }
    }
  }
  return regexEntities;
}

// ─── ML-Only Detection (real forward pass) ───────────────────────────────────

function detectMLOnly(text) {
  const top = PII.classifyText(text);
  const cat = mlLabelToCategory(top.label);
  // Represent the prediction explicitly (including NONE) so the evaluator can
  // credit correct rejections and penalise false NONE calls.
  return [{ type: cat === 'NONE' ? 'NONE' : cat, value: text.trim(), confidence: top.score }];
}

// ─── Hybrid Detection (regex + ML ensemble) ──────────────────────────────────

function detectHybrid(text, label) {
  const regexEntities = detectDOMEnhanced(text, label);
  const mlTop = PII.classifyText(text);
  const mlCat = mlLabelToCategory(mlTop.label);
  const mlIsPII = mlCat !== 'NONE';

  // Add the ML PII category to the regex detections when it is a distinct type.
  if (mlIsPII && !regexEntities.some((e) => e.type === mlCat)) {
    regexEntities.push({ type: mlCat, value: text.trim(), confidence: mlTop.score });
  }

  // Report NONE only when BOTH detectors found no PII (correct rejection).
  if (regexEntities.length === 0 && !mlIsPII) {
    return [{ type: 'NONE', value: text.trim(), confidence: mlTop.score }];
  }

  return regexEntities;
}

// ─── Evaluation Metrics ──────────────────────────────────────────────────────

function evaluate(testData, detectFn, methodName) {
  const categories = new Set(testData.map((d) => LABEL_MAP[d.label] || d.label));
  const allCats = [...categories].sort();

  const perClass = {};
  for (const cat of allCats) perClass[cat] = { tp: 0, fp: 0, fn: 0, tn: 0 };

  let totalCorrect = 0;
  const timings = [];

  for (const sample of testData) {
    const expectedCategory = LABEL_MAP[sample.label] || sample.label;
    const start = performance.now();
    const detected = detectFn(sample.text, sample.label);
    const elapsed = performance.now() - start;
    timings.push(elapsed);

    const detectedTypes = new Set(detected.map((e) => e.type));

    for (const cat of allCats) {
      const isExpected = cat === expectedCategory;
      const isDetected = detectedTypes.has(cat);
      if (isExpected && isDetected) perClass[cat].tp++;
      else if (!isExpected && isDetected) perClass[cat].fp++;
      else if (isExpected && !isDetected) perClass[cat].fn++;
      else perClass[cat].tn++;
    }

    if (detectedTypes.has(expectedCategory)) totalCorrect++;
  }

  const metrics = {};
  let macroPrecision = 0, macroRecall = 0, macroF1 = 0;
  let weightedPrecision = 0, weightedRecall = 0, weightedF1 = 0;
  let validClasses = 0, totalSupport = 0;

  for (const cat of allCats) {
    const c = perClass[cat];
    const precision = c.tp + c.fp > 0 ? c.tp / (c.tp + c.fp) : 0;
    const recall = c.tp + c.fn > 0 ? c.tp / (c.tp + c.fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const support = c.tp + c.fn;

    metrics[cat] = { precision, recall, f1, tp: c.tp, fp: c.fp, fn: c.fn, support };
    macroPrecision += precision;
    macroRecall += recall;
    macroF1 += f1;
    validClasses++;
    totalSupport += support;
    weightedPrecision += precision * support;
    weightedRecall += recall * support;
    weightedF1 += f1 * support;
  }

  macroPrecision /= validClasses || 1;
  macroRecall /= validClasses || 1;
  macroF1 /= validClasses || 1;
  weightedPrecision /= totalSupport || 1;
  weightedRecall /= totalSupport || 1;
  weightedF1 /= totalSupport || 1;

  const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
  const memBefore = process.memoryUsage();
  const accuracy = totalCorrect / testData.length;

  return {
    method: methodName,
    accuracy,
    macroPrecision, macroRecall, macroF1,
    weightedPrecision, weightedRecall, weightedF1,
    avgTimePerSampleUs: Math.round(avgTime * 1000),
    totalSamples: testData.length,
    correctDetections: totalCorrect,
    memoryRssMB: Math.round(memBefore.rss / 1024 / 1024),
    memoryHeapUsedMB: Math.round(memBefore.heapUsed / 1024 / 1024),
    perClass: metrics,
  };
}

// ─── Console Output ──────────────────────────────────────────────────────────

function printSection(title) {
  console.log('\n' + '-'.repeat(80));
  console.log(`  ${title}`);
  console.log('-'.repeat(80));
}

function printMethodResults(result) {
  printSection(`Method: ${result.method}`);
  console.log(`  Overall Accuracy:    ${(result.accuracy * 100).toFixed(1)}%`);
  console.log(`  Macro Precision:     ${(result.macroPrecision * 100).toFixed(1)}%`);
  console.log(`  Macro Recall:        ${(result.macroRecall * 100).toFixed(1)}%`);
  console.log(`  Macro F1:            ${(result.macroF1 * 100).toFixed(1)}%`);
  console.log(`  Weighted F1:         ${(result.weightedF1 * 100).toFixed(1)}%`);
  console.log(`  Avg Time/Sample:     ${result.avgTimePerSampleUs} us`);
  console.log(`  Correct:             ${result.correctDetections}/${result.totalSamples}`);
  console.log(`  Memory (RSS):        ${result.memoryRssMB} MB`);
  console.log(`  Memory (Heap):       ${result.memoryHeapUsedMB} MB`);

  console.log('\n  Per-Class Results:');
  console.log('  ' + '-'.repeat(80));
  console.log(
    '  ' +
    'Category'.padEnd(22) + 'Precision'.padStart(10) + 'Recall'.padStart(10) +
    'F1'.padStart(10) + 'TP'.padStart(6) + 'FP'.padStart(6) + 'FN'.padStart(6) + 'Support'.padStart(10)
  );
  console.log('  ' + '-'.repeat(80));

  const cats = Object.keys(result.perClass).sort();
  for (const cat of cats) {
    const c = result.perClass[cat];
    if (c.support === 0) continue;
    console.log(
      '  ' + cat.padEnd(22) +
      (c.precision * 100).toFixed(1).padStart(9) + '%' +
      (c.recall * 100).toFixed(1).padStart(9) + '%' +
      (c.f1 * 100).toFixed(1).padStart(9) + '%' +
      String(c.tp).padStart(6) + String(c.fp).padStart(6) + String(c.fn).padStart(6) +
      String(c.support).padStart(10)
    );
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(80));
console.log('  Privacy Vision Agent - Benchmark Suite (honest)');
console.log('='.repeat(80));
console.log(`  Test samples: ${testData.length}`);
console.log(`  Date: ${new Date().toISOString()}`);
console.log('='.repeat(80) + '\n');

(async () => {
  console.log('[Benchmark] Loading PII ML model...');
  await PII.load();
  console.log('[Benchmark] ML model loaded:', PII.isLoaded());

  console.log('[Benchmark] Running Method A: Regex-Only...');
  const resultsA = evaluate(testData, detectRegexOnly, 'Regex-Only');

  console.log('[Benchmark] Running Method B: DOM-Context-Enhanced...');
  const resultsB = evaluate(testData, detectDOMEnhanced, 'DOM-Context-Enhanced');

  console.log('[Benchmark] Running Method C: ML-Only (real forward pass)...');
  const resultsC = evaluate(testData, detectMLOnly, 'ML-Only');

  console.log('[Benchmark] Running Method D: Hybrid (Regex+ML)...');
  const resultsD = evaluate(testData, detectHybrid, 'Hybrid-Regex+ML');

  printMethodResults(resultsA);
  printMethodResults(resultsB);
  printMethodResults(resultsC);
  printMethodResults(resultsD);

  printSection('Comparison Summary');
  console.log(
    '  ' +
    'Metric'.padEnd(26) + 'Regex'.padStart(12) + 'DOM'.padStart(14) +
    'ML'.padStart(14) + 'Hybrid'.padStart(14)
  );
  console.log('  ' + '-'.repeat(80));
  const comparisons = [
    ['Accuracy (%)', (r) => (r.accuracy * 100).toFixed(1) + '%'],
    ['Macro Precision (%)', (r) => (r.macroPrecision * 100).toFixed(1) + '%'],
    ['Macro Recall (%)', (r) => (r.macroRecall * 100).toFixed(1) + '%'],
    ['Macro F1 (%)', (r) => (r.macroF1 * 100).toFixed(1) + '%'],
    ['Weighted F1 (%)', (r) => (r.weightedF1 * 100).toFixed(1) + '%'],
    ['Avg Time/Sample (us)', (r) => String(r.avgTimePerSampleUs)],
    ['Correct', (r) => `${r.correctDetections}/${r.totalSamples}`],
  ];
  for (const [label, fn] of comparisons) {
    console.log(
      '  ' + label.padEnd(26) +
      fn(resultsA).padStart(12) + fn(resultsB).padStart(14) +
      fn(resultsC).padStart(14) + fn(resultsD).padStart(14)
    );
  }

  printSection('Per-Category F1 Comparison');
  const allCatUnion = new Set([
    ...Object.keys(resultsA.perClass), ...Object.keys(resultsB.perClass),
    ...Object.keys(resultsC.perClass), ...Object.keys(resultsD.perClass),
  ]);
  console.log('  ' + 'Category'.padEnd(22) + 'Regex'.padStart(12) + 'DOM'.padStart(14) +
    'ML'.padStart(14) + 'Hybrid'.padStart(14));
  console.log('  ' + '-'.repeat(76));
  for (const cat of [...allCatUnion].sort()) {
    console.log(
      '  ' + cat.padEnd(22) +
      ((resultsA.perClass[cat]?.f1 ?? 0) * 100).toFixed(1).padStart(11) + '%' +
      ((resultsB.perClass[cat]?.f1 ?? 0) * 100).toFixed(1).padStart(13) + '%' +
      ((resultsC.perClass[cat]?.f1 ?? 0) * 100).toFixed(1).padStart(13) + '%' +
      ((resultsD.perClass[cat]?.f1 ?? 0) * 100).toFixed(1).padStart(13) + '%'
    );
  }

  const outputResults = {
    timestamp: new Date().toISOString(),
    testSamples: testData.length,
    note: 'Honest evaluation: every method predicts purely from input text; ' +
      'no ground-truth label is fed to any classifier.',
    methods: {
      'regex-only': resultsA,
      'dom-context-enhanced': resultsB,
      'ml-only': resultsC,
      'hybrid-regex+ml': resultsD,
    },
    summary: {
      bestAccuracy: [resultsA, resultsB, resultsC, resultsD].sort((a, b) => b.accuracy - a.accuracy)[0].method,
      bestF1: [resultsA, resultsB, resultsC, resultsD].sort((a, b) => b.weightedF1 - a.weightedF1)[0].method,
      fastestMethod: [resultsA, resultsB, resultsC, resultsD].sort((a, b) => a.avgTimePerSampleUs - b.avgTimePerSampleUs)[0].method,
    },
  };

  try {
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(outputResults, null, 2), 'utf-8');
    console.log(`\n[Benchmark] Results saved to ${RESULTS_PATH}`);
  } catch (err) {
    console.error('[Benchmark] Failed to save results:', err.message);
  }

  console.log('\n' + '='.repeat(80));
  console.log('  Benchmark Complete');
  console.log('='.repeat(80) + '\n');
})().catch((err) => {
  console.error('[Benchmark] Fatal error:', err);
  process.exit(1);
});
