// vision-inference.js - Privacy Vision Agent
// On-device binary vision classifier for sensitive UI regions.
// Ports the pure-NumPy MobileNet-style CNN in ml/vision/model.py (class
// VisionNet) to vanilla JS so rendered screenshot crops can be classified
// locally - pixels never leave the page.
//
// Architecture (input 48x96 grayscale, layout [B=1, C=1, H=48, W=96]):
//   stem    : Conv3x3 1->16    ReLU  MaxPool2x2
//   ds1     : DWConv3x3 16     ReLU  Pointwise 16->32  ReLU    (stride 1)
//   ds2     : DWConv3x3 32 s2  ReLU  Pointwise 32->48  ReLU    (stride 2)
//   head    : GAP -> Dense 48->1 -> Sigmoid
//
// The engine interprets extension/model/vision_model.json directly (the exact
// export produced by VisionNet.export()), matching the Python forward pass 1:1.
// Weight layout: conv w = [out, in, k, k]; dwconv w = [ch, 1, k, k];
// dense w = [out, in].

const VISION = (function () {
  let model = null; // { version, input, task, layers }
  let loaded = false;
  let loadingPromise = null;

  const MODEL_URL = chrome.runtime.getURL("model/vision_model.json");

  // ─── Math helpers ───────────────────────────────────────────────────────────
  function sigmoid(z) {
    var clipped = Math.max(-30, Math.min(30, z));
    return 1 / (1 + Math.exp(-clipped));
  }

  // Input/output tensors are plain objects: { data: Float32Array, C, H, W }.

  function conv2d(x, layer) {
    var k = layer.k, pad = layer.pad, stride = layer.stride;
    var outC = layer.w.length;
    var OH = Math.floor((x.H + 2 * pad - k) / stride) + 1;
    var OW = Math.floor((x.W + 2 * pad - k) / stride) + 1;
    var out = new Float32Array(outC * OH * OW);

    for (var oc = 0; oc < outC; oc++) {
      var wt = layer.w[oc];
      var biasAcc = layer.b ? layer.b[oc] : 0;
      for (var oh = 0; oh < OH; oh++) {
        var ihBase = oh * stride - pad;
        for (var ow = 0; ow < OW; ow++) {
          var iwBase = ow * stride - pad;
          var acc = biasAcc;
          for (var ic = 0; ic < x.C; ic++) {
            var wc = wt[ic];
            var plane = ic * x.H;
            for (var kh = 0; kh < k; kh++) {
              var ih = ihBase + kh;
              if (ih < 0 || ih >= x.H) continue;
              var rowBase = (plane + ih) * x.W;
              var wk = wc[kh];
              for (var kw = 0; kw < k; kw++) {
                var iw = iwBase + kw;
                if (iw < 0 || iw >= x.W) continue;
                acc += x.data[rowBase + iw] * wk[kw];
              }
            }
          }
          out[(oc * OH + oh) * OW + ow] = acc;
        }
      }
    }
    return { data: out, C: outC, H: OH, W: OW };
  }

  function dwconv2d(x, layer) {
    var k = layer.k, pad = layer.pad, stride = layer.stride;
    var OH = Math.floor((x.H + 2 * pad - k) / stride) + 1;
    var OW = Math.floor((x.W + 2 * pad - k) / stride) + 1;
    var out = new Float32Array(x.C * OH * OW);

    for (var ch = 0; ch < x.C; ch++) {
      var kern = layer.w[ch][0];
      var biasAcc = layer.b ? layer.b[ch] : 0;
      for (var oh = 0; oh < OH; oh++) {
        var ihBase = oh * stride - pad;
        for (var ow = 0; ow < OW; ow++) {
          var iwBase = ow * stride - pad;
          var acc = biasAcc;
          for (var kh = 0; kh < k; kh++) {
            var ih = ihBase + kh;
            if (ih < 0 || ih >= x.H) continue;
            var rowBase = (ch * x.H + ih) * x.W;
            var wk = kern[kh];
            for (var kw = 0; kw < k; kw++) {
              var iw = iwBase + kw;
              if (iw < 0 || iw >= x.W) continue;
              acc += x.data[rowBase + iw] * wk[kw];
            }
          }
          out[(ch * OH + oh) * OW + ow] = acc;
        }
      }
    }
    return { data: out, C: x.C, H: OH, W: OW };
  }

  function reluIn(x) {
    var d = x.data;
    for (var i = 0; i < d.length; i++) if (d[i] < 0) d[i] = 0;
  }

  function maxpool2d(x, k, stride) {
    var OH = Math.floor((x.H - k) / stride) + 1;
    var OW = Math.floor((x.W - k) / stride) + 1;
    var out = new Float32Array(x.C * OH * OW);
    for (var c = 0; c < x.C; c++) {
      for (var oh = 0; oh < OH; oh++) {
        for (var ow = 0; ow < OW; ow++) {
          var best = -Infinity;
          for (var kh = 0; kh < k; kh++) {
            for (var kw = 0; kw < k; kw++) {
              var v = x.data[((c * x.H + oh * stride + kh) * x.W) + ow * stride + kw];
              if (v > best) best = v;
            }
          }
          out[(c * OH + oh) * OW + ow] = best;
        }
      }
    }
    return { data: out, C: x.C, H: OH, W: OW };
  }

  function gap2d(x) {
    var out = new Float32Array(x.C);
    var area = x.H * x.W;
    for (var c = 0; c < x.C; c++) {
      var acc = 0;
      var base = c * area;
      for (var i = 0; i < area; i++) acc += x.data[base + i];
      out[c] = acc / area;
    }
    return { data: out, C: x.C, H: 1, W: 1 };
  }

  function dense(x, layer) {
    var w = layer.w[0];
    var acc = layer.b ? layer.b[0] : 0;
    for (var j = 0; j < x.data.length; j++) acc += x.data[j] * w[j];
    return acc;
  }

  // ─── Forward pass ───────────────────────────────────────────────────────────
  // gray: Float32Array of length 48*96 (row-major, values normalized 0..1).
  function classify(gray) {
    if (!loaded) throw new Error("Vision model not loaded yet.");
    if (!gray || gray.length !== model.input[1] * model.input[2]) {
      throw new Error("Expected " + model.input[1] + "x" + model.input[2] + " grayscale input");
    }
    var x = { data: gray, C: 1, H: model.input[1], W: model.input[2] };
    var prob = 0;
    for (var i = 0; i < model.layers.length; i++) {
      var layer = model.layers[i];
      switch (layer.type) {
        case 'conv': x = conv2d(x, layer); break;
        case 'dwconv': x = dwconv2d(x, layer); break;
        case 'relu': reluIn(x); break;
        case 'maxpool': x = maxpool2d(x, layer.k, layer.stride); break;
        case 'gap': x = gap2d(x); break;
        case 'dense': prob = sigmoid(dense(x, layer)); break;
        default: throw new Error('Unknown vision layer type: ' + layer.type);
      }
    }
    return prob;
  }

  // ─── Model loading ──────────────────────────────────────────────────────────
  async function load() {
    if (loaded) return true;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async function () {
      try {
        var resp = await fetch(MODEL_URL);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var payload = await resp.json();
        if (!payload || !Array.isArray(payload.layers) || payload.input.length !== 3) {
          throw new Error('Malformed vision model payload');
        }
        model = payload;
        loaded = true;
        console.log('[VISION] Model loaded. Layers: ' + payload.layers.length);
        return true;
      } catch (err) {
        console.error('[VISION] Failed to load model:', err);
        loaded = false;
        loadingPromise = null;
        return false;
      }
    })();

    return loadingPromise;
  }

  function isLoaded() {
    return loaded;
  }

  // Public API
  return {
    load: load,
    isLoaded: isLoaded,
    classify: classify,
    sigmoid: sigmoid,
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.PVA_VISION = VISION;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VISION;
}