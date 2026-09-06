// ml-engine.js - Privacy Vision Agent
// In-browser ML inference. Loads the numpy-trained model (weights.json, vocab.json)
// and runs a forward pass to classify a user's task into a browser action.
// Vanilla JS implementation (no external dependencies) for full privacy - all
// inference happens locally in the page.

const ML = (function () {
  let weights = null;
  let wordIndex = null;
  let labelsArr = null;
  let config = null;
  let loaded = false;
  let loadingPromise = null;

  const MODEL_URL = chrome.runtime.getURL("model/weights.json");
  const VOCAB_URL = chrome.runtime.getURL("model/vocab.json");
  const LABELS_URL = chrome.runtime.getURL("model/labels.json");
  const CONFIG_URL = chrome.runtime.getURL("model/config.json");

  function matMul(A, B) {
    const rows = A.length;
    const inner = B.length;
    const cols = B[0].length;
    const out = new Array(rows);
    for (let i = 0; i < rows; i++) {
      out[i] = new Array(cols).fill(0);
      const arow = A[i];
      for (let j = 0; j < cols; j++) {
        let sum = 0;
        for (let k = 0; k < inner; k++) {
          sum += arow[k] * B[k][j];
        }
        out[i][j] = sum;
      }
    }
    return out;
  }

  function matAddVec(M, b) {
    const rows = M.length;
    const cols = M[0].length;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        M[i][j] += b[j];
      }
    }
    return M;
  }

  function relu(M) {
    const rows = M.length;
    const cols = M[0].length;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        M[i][j] = M[i][j] > 0 ? M[i][j] : 0;
      }
    }
    return M;
  }

  function softmaxRows(M) {
    const rows = M.length;
    const cols = M[0].length;
    const out = new Array(rows);
    for (let i = 0; i < rows; i++) {
      let max = M[i][0];
      for (let j = 1; j < cols; j++) if (M[i][j] > max) max = M[i][j];
      let sum = 0;
      out[i] = new Array(cols);
      for (let j = 0; j < cols; j++) {
        const e = Math.exp(M[i][j] - max);
        out[i][j] = e;
        sum += e;
      }
      for (let j = 0; j < cols; j++) out[i][j] /= sum;
    }
    return out;
  }

  // Average token embeddings -> (seq_len, embed_dim) pooled into (embed_dim,)
  function embedPool(sequence) {
    const pooled = new Array(config.embed_dim).fill(0);
    let count = 0;
    for (const idx of sequence) {
      if (idx === 0) continue; // skip padding
      const vec = weights.embedding[idx];
      for (let d = 0; d < config.embed_dim; d++) pooled[d] += vec[d];
      count++;
    }
    if (count > 0) {
      for (let d = 0; d < config.embed_dim; d++) pooled[d] /= count;
    }
    return [pooled];
  }

  function prepareText(text) {
    const raw = text.toLowerCase().trim();
    const words = raw.split(/\s+/).filter((w) => w.length > 0);
    const seq = [];
    for (const w of words) {
      const idx = wordIndex.hasOwnProperty(w) ? wordIndex[w] : 1; // <UNK>
      seq.push(idx);
      if (seq.length >= config.max_len) break;
    }
    while (seq.length < config.max_len) seq.push(0); // <PAD>
    return seq;
  }

  function classify(text, k) {
    if (!loaded) {
      throw new Error("Model not loaded yet.");
    }
    const seq = prepareText(text);
    let h = embedPool(seq);
    h = matAddVec(matMul(h, weights.W1), weights.b1);
    h = relu(h);
    h = matAddVec(matMul(h, weights.W2), weights.b2);
    const probs = softmaxRows(h)[0];

    const result = labelsArr.map((label, i) => ({ label, score: probs[i] }));
    result.sort((a, b) => b.score - a.score);

    if (k) {
      return result.slice(0, k);
    }
    return result[0];
  }

  async function load() {
    if (loaded) return true;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      try {
        const [w, v, l, c] = await Promise.all([
          fetch(MODEL_URL).then((r) => r.json()),
          fetch(VOCAB_URL).then((r) => r.json()),
          fetch(LABELS_URL).then((r) => r.json()),
          fetch(CONFIG_URL).then((r) => r.json()),
        ]);
        weights = w;
        wordIndex = v;
        labelsArr = l;
        config = c;
        loaded = true;
        console.log("ML model loaded. Vocab:", Object.keys(wordIndex).length,
          "Classes:", labelsArr);
        return true;
      } catch (err) {
        console.error("Failed to load ML model:", err);
        loaded = false;
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
    load,
    isLoaded,
    classify,
  };
})();
