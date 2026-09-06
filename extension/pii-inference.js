// pii-inference.js - Privacy Vision Agent
// In-browser ML inference for the PII type classifier.
// Ports the pure-NumPy architecture in ml/model.py (class PiiClassifier) to
// vanilla JS so all inference runs locally - no data ever leaves the page.
//
// Architecture (must match Python exactly):
//   tokenize(text) -> word + char tokens (case preserved, '#'-prefixed chars)
//   sequence -> vocab ids   [embedding: (vocab_size=4707, embed_dim=128)]
//   mean-pool embeddings over non-padding tokens
//   z1 = pooled @ W1 + b1   [W1: (128,128)], a1 = relu(z1)
//   z2 = a1 @ W2 + b2       [W2: (128,15)],  a2 = softmax(z2)
//
// Weights come from extension/model/pii_model.json (config + labels + vocab +
// weights in a single file). Vanilla JS, no external deps.

const PII = (function () {
  let model = null; // { config, labels, vocab, weights }
  let loaded = false;
  let loadingPromise = null;

  const MODEL_URL = chrome.runtime.getURL("model/pii_model.json");

  // ─── Linear algebra primitives ──────────────────────────────────────────────
  function matVecMul(M, v) {
    // Returns the NumPy-equivalent of `v @ M` (v is a row vector).
    // M is stored row-major as (rows, cols); for output over columns:
    //   out[j] = sum_k v[k] * M[k][j]
    const rows = M.length;
    const cols = M[0].length;
    const out = new Array(cols).fill(0);
    for (let k = 0; k < rows; k++) {
      const vk = v[k];
      const Mrow = M[k];
      for (let j = 0; j < cols; j++) out[j] += vk * Mrow[j];
    }
    return out;
  }

  function softmax(z) {
    let max = z[0];
    for (let i = 1; i < z.length; i++) if (z[i] > max) max = z[i];
    const e = new Array(z.length);
    let sum = 0;
    for (let i = 0; i < z.length; i++) {
      e[i] = Math.exp(z[i] - max);
      sum += e[i];
    }
    for (let i = 0; i < z.length; i++) e[i] /= sum;
    return e;
  }

  // ─── Tokenizer (mirrors ml/model.py tokenize) ───────────────────────────────
  // NOTE: does NOT lowercase - vocab distinguishes "the" vs "The" and "#T" vs "#t".
  function tokenize(text) {
    const tokens = [];
    const words = String(text).split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.length === 0) continue;
      tokens.push(w); // word token, original case
      for (let c = 0; c < w.length; c++) {
        tokens.push("#" + w[c]); // char token
      }
    }
    return tokens;
  }

  function textsToSequences(texts) {
    const maxLen = model.config.max_len;
    const vocab = model.vocab;
    const unk = vocab["<UNK>"] !== undefined ? vocab["<UNK>"] : 1;
    return texts.map(function (text) {
      const raw = tokenize(text);
      const seq = new Array(maxLen).fill(0);
      const n = Math.min(raw.length, maxLen);
      for (let i = 0; i < n; i++) {
        const tok = raw[i];
        const id = vocab.hasOwnProperty(tok) ? vocab[tok] : unk;
        seq[i] = id;
      }
      return seq;
    });
  }

  // ─── Forward pass (single sample) ───────────────────────────────────────────
  // Returns probability vector over model.labels.
  function forwardSample(seq) {
    const cfg = model.config;
    const W = model.weights;
    const embedDim = cfg.embed_dim;
    const hiddenDim = cfg.hidden_dim;
    const numClasses = cfg.num_classes;

    // Mean-pool embeddings over non-padding tokens.
    const pooled = new Array(embedDim).fill(0);
    let count = 0;
    for (let t = 0; t < seq.length; t++) {
      const id = seq[t];
      if (id === 0) continue; // padding
      const vec = W.embedding[id];
      for (let d = 0; d < embedDim; d++) pooled[d] += vec[d];
      count++;
    }
    if (count > 0) {
      for (let d = 0; d < embedDim; d++) pooled[d] /= count;
    }

    // z1 = pooled @ W1 + b1 ; a1 = relu(z1)
    let z1 = matVecMul(W.W1, pooled); // W1: (embed_dim, hidden_dim) -> hidden
    for (let i = 0; i < hiddenDim; i++) {
      z1[i] += W.b1[i];
      z1[i] = z1[i] > 0 ? z1[i] : 0;
    }

    // z2 = a1 @ W2 + b2 ; probs = softmax(z2)
    // W2: (hidden_dim, num_classes); a1 (hidden,) @ W2 -> (num_classes,)
    let z2 = matVecMul(W.W2, z1);
    for (let j = 0; j < numClasses; j++) z2[j] += W.b2[j];
    return softmax(z2);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  function classifyText(text) {
    if (!loaded) throw new Error("PII model not loaded yet.");
    const seq = textsToSequences([text])[0];
    const probs = forwardSample(seq);
    const result = model.labels.map(function (label, i) {
      return { label: label, score: probs[i] };
    });
    result.sort(function (a, b) { return b.score - a.score; });
    return result[0];
  }

  function classifyAll(texts) {
    if (!loaded) throw new Error("PII model not loaded yet.");
    const seqs = textsToSequences(texts);
    const out = [];
    for (let i = 0; i < seqs.length; i++) {
      const probs = forwardSample(seqs[i]);
      let best = 0;
      for (let j = 1; j < probs.length; j++) if (probs[j] > probs[best]) best = j;
      out.push({ label: model.labels[best], score: probs[best], index: i });
    }
    return out;
  }

  function predictLabel(text) {
    return classifyText(text).label;
  }

  async function load() {
    if (loaded) return true;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      try {
        const resp = await fetch(MODEL_URL);
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
        if (!data || !data.config || !data.weights || !data.vocab || !data.labels) {
          throw new Error("Malformed PII model payload");
        }
        model = data;
        loaded = true;
        return true;
      } catch (err) {
        console.error("[PII-Inference] Failed to load model:", err);
        loaded = false;
        model = null;
        loadingPromise = null;
        throw err;
      }
    })();

    return loadingPromise;
  }

  function isLoaded() {
    return loaded;
  }

  return {
    load: load,
    isLoaded: isLoaded,
    classifyText: classifyText,
    classifyAll: classifyAll,
    predictLabel: predictLabel,
  };
})();
