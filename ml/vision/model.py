"""
Phase 5b: MobileNet-style binary vision classifier in pure numpy.

A compact depthwise-separable CNN ("MobileNet-style") trained from scratch to
tell apart UI-region crops that contain sensitive PII (credit cards, SSNs,
emails, ...) from benign UI text. No external ML library: every op here is
implemented directly so the JS port is a 1:1 match.

Architecture (input 48x96 grayscale):
  stem    : Conv3x3 1->16    ReLU  MaxPool2x2
  ds1     : DWConv3x3 16     ReLU  Pointwise 16->32  ReLU      (stride 1)
  ds2     : DWConv3x3 32 s2  ReLU  Pointwise 32->48  ReLU      (stride 2)
  head    : GAP -> Dense 48->1 -> Sigmoid

All weights use the same layout as the JSON export:
  conv   w : [out, in, k, k]
  dwconv w : [ch, 1, k, k]
  dense  w : [out, in]
"""

import json
import os

import numpy as np

SEED = 0
np.random.seed(SEED)


def conv_out(h, k, pad, stride):
    return (h + 2 * pad - k) // stride + 1


def _im2col(x, k, pad, stride):
    """x: [B,C,H,W] -> cols [B, C, k*k, OH*OW] (vectorized via as_strided)."""
    B, C, H, W = x.shape
    OH = conv_out(H, k, pad, stride)
    OW = conv_out(W, k, pad, stride)
    xp = np.pad(x, ((0, 0), (0, 0), (pad, pad), (pad, pad)))
    sB, sC, sH, sW = xp.strides
    col5 = np.lib.stride_tricks.as_strided(
        xp, shape=(B, C, OH, OW, k, k),
        strides=(sB, sC, sH * stride, sW * stride, sH, sW))
    return np.ascontiguousarray(col5.transpose(0, 1, 4, 5, 2, 3)).reshape(B, C, k * k, OH * OW)


def _col2im(cols, B, C, H, W, k, pad, stride):
    """cols [B,C,k*k,OH*OW] -> gradient tensor, accumulating overlapping patches.

    For each of the k*k kernel offsets, the columns reshape to a
    [B,C,OH,OW] plane that lands on the padded base at (di, dj) with the
    given stride -- exactly k*k vectorized slice-adds.
    """
    OH = conv_out(H, k, pad, stride)
    OW = conv_out(W, k, pad, stride)
    Hp, Wp = H + 2 * pad, W + 2 * pad
    xp = np.zeros((B, C, Hp, Wp), dtype=np.float64)
    plane = cols.reshape(B, C, k, k, OH, OW)
    for di in range(k):
        for dj in range(k):
            xp[:, :, di:di + OH * stride:stride, dj:dj + OW * stride:stride] += \
                plane[:, :, di, dj]
    return xp[:, :, pad:pad + H, pad:pad + W]


class Layer:
    def forward(self, x):  # pragma: no cover - interface
        raise NotImplementedError

    def backward(self, dout):  # pragma: no cover - interface
        raise NotImplementedError

    def params(self):
        return []

    def zero_grad(self):
        pass

    def step(self, lr, beta1, beta2, t, lam):
        pass


class Conv2D(Layer):
    def __init__(self, cin, cout, k, pad, stride, bias=True):
        self.cin, self.cout, self.k, self.pad, self.stride = cin, cout, k, pad, stride
        bound = np.sqrt(6.0 / (cin * k * k + cout))
        self.w = np.random.uniform(-bound, bound, (cout, cin, k, k))
        self.b = np.zeros(cout) if bias else None
        self.gw = np.zeros_like(self.w)
        self.gb = np.zeros_like(self.b) if bias else None
        self.mw = np.zeros_like(self.w)
        self.vw = np.zeros_like(self.w)
        self.mb = np.zeros_like(self.b) if bias else None
        self.vb = np.zeros_like(self.b) if bias else None

    def forward(self, x):
        self.x = x
        B, C, H, W = x.shape
        self.cols = _im2col(x, self.k, self.pad, self.stride)
        w4 = self.w.reshape(self.cout, C, self.k * self.k)
        out = np.einsum("bckp,fck->bfp", self.cols, w4)  # b,f,(c*k) summed
        out = out.reshape(B, self.cout,
                          conv_out(H, self.k, self.pad, self.stride),
                          conv_out(W, self.k, self.pad, self.stride))
        if self.b is not None:
            out += self.b.reshape(1, self.cout, 1, 1)
        return out

    def backward(self, dout):
        B, C, H, W = self.x.shape
        OH, OW = dout.shape[2], dout.shape[3]
        dflat = dout.reshape(B, self.cout, OH * OW)
        self.gw = np.einsum("bfp,bckp->fck", dflat, self.cols).reshape(self.cout, C, self.k, self.k) / B
        if self.b is not None:
            self.gb = dflat.sum(axis=(0, 2)) / B
        w4 = self.w.reshape(self.cout, C, self.k * self.k)
        dcols = np.einsum("bfp,fck->bckp", dflat, w4)
        return _col2im(dcols, B, C, H, W, self.k, self.pad, self.stride)

    def params(self):
        p = [("w", self.w, self.gw, self.mw, self.vw)]
        if self.b is not None:
            p.append(("b", self.b, self.gb, self.mb, self.vb))
        return p


class DepthwiseConv2D(Layer):
    def __init__(self, ch, k, pad, stride, bias=True):
        self.ch, self.k, self.pad, self.stride = ch, k, pad, stride
        bound = np.sqrt(2.0 / (k * k))
        self.w = np.random.uniform(-bound, bound, (ch, 1, k, k))
        self.b = np.zeros(ch) if bias else None
        self.gw = np.zeros_like(self.w)
        self.gb = np.zeros_like(self.b) if bias else None
        self.mw, self.vw = np.zeros_like(self.w), np.zeros_like(self.w)
        self.mb, self.vb = (np.zeros_like(self.b), np.zeros_like(self.b)) if bias else (None, None)

    def forward(self, x):
        self.x = x
        B, C, H, W = x.shape
        cols = _im2col(x, self.k, self.pad, self.stride)  # [B,C,kk,OH*OW]
        wf = self.w[:, 0, :, :].reshape(C, self.k * self.k)  # [C,kk]
        out = np.einsum("bckp,ck->bcp", cols, wf)
        out = out.reshape(B, C, conv_out(H, self.k, self.pad, self.stride),
                          conv_out(W, self.k, self.pad, self.stride))
        if self.b is not None:
            out += self.b.reshape(1, C, 1, 1)
        self.cols = cols
        return out

    def backward(self, dout):
        B, C, H, W = self.x.shape
        OH, OW = dout.shape[2], dout.shape[3]
        wf = self.w[:, 0, :, :].reshape(C, self.k * self.k)
        self.gw = np.zeros_like(self.w)
        self.gw[:, 0, :, :] = (np.einsum("bckp,bcp->ck", self.cols, dout.reshape(B, C, OH * OW)) / B).reshape(C, self.k, self.k)
        if self.b is not None:
            self.gb = dout.sum(axis=(0, 2, 3)) / B
        dcols = np.einsum("bcp,ck->bckp", dout.reshape(B, C, OH * OW), wf)
        return _col2im(dcols, B, C, H, W, self.k, self.pad, self.stride)

    def params(self):
        p = [("w", self.w, self.gw, self.mw, self.vw)]
        if self.b is not None:
            p.append(("b", self.b, self.gb, self.mb, self.vb))
        return p


class ReLU(Layer):
    def forward(self, x):
        self.mask = x > 0
        return np.where(self.mask, x, 0.0)

    def backward(self, dout):
        return np.where(self.mask, dout, 0.0)


class MaxPool2D(Layer):
    def __init__(self, k=2, stride=2):
        self.k, self.stride = k, stride

    def forward(self, x):
        self.x = x
        B, C, H, W = x.shape
        OH, OW = H // self.k, W // self.k
        # axes order: (B, C, OH, OW, k, k) via transpose of the blocked view
        xr = x.reshape(B, C, OH, self.k, OW, self.k).transpose(0, 1, 2, 4, 3, 5)
        flat = xr.reshape(B, C, OH, OW, self.k * self.k)
        xm = flat.max(axis=4)
        self.idx = flat.argmax(axis=4)
        self.OH, self.OW = OH, OW
        return xm

    def backward(self, dout):
        B, C, H, W = self.x.shape
        flat = np.zeros((B, C, self.OH, self.OW, self.k * self.k), dtype=np.float64)
        np.put_along_axis(flat, self.idx[..., None], dout.reshape(B, C, self.OH, self.OW, 1), axis=4)
        return flat.reshape(B, C, self.OH, self.OW, self.k, self.k).transpose(0, 1, 2, 4, 3, 5)\
            .reshape(B, C, H, W)


class GAP(Layer):
    def forward(self, x):
        self.input = x
        return x.mean(axis=(2, 3))

    def backward(self, dout):
        return np.broadcast_to(dout[:, :, None, None] / (self.input.shape[2] * self.input.shape[3]),
                               self.input.shape)


class Dense(Layer):
    def __init__(self, cin, cout, bias=True):
        bound = np.sqrt(2.0 / cin)
        self.w = np.random.uniform(-bound, bound, (cout, cin))
        self.b = np.zeros(cout) if bias else None
        self.gw = np.zeros_like(self.w)
        self.gb = np.zeros_like(self.b) if bias else None
        self.mw, self.vw = np.zeros_like(self.w), np.zeros_like(self.w)
        self.mb, self.vb = (np.zeros_like(self.b), np.zeros_like(self.b)) if bias else (None, None)

    def forward(self, x):
        self.x = x
        out = x @ self.w.T
        if self.b is not None:
            out += self.b
        return out

    def backward(self, dout):
        self.gw = dout.T @ self.x / self.x.shape[0]
        if self.b is not None:
            self.gb = dout.mean(axis=0)
        return dout @ self.w

    def params(self):
        p = [("w", self.w, self.gw, self.mw, self.vw)]
        if self.b is not None:
            p.append(("b", self.b, self.gb, self.mb, self.vb))
        return p


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))


class VisionNet(Layer):
    """Sequential container matching the JSON export layout."""

    def __init__(self):
        self.layers = [
            Conv2D(1, 16, k=3, pad=1, stride=1),
            ReLU(),
            MaxPool2D(2, 2),
            DepthwiseConv2D(16, k=3, pad=1, stride=1),
            ReLU(),
            Conv2D(16, 32, k=1, pad=0, stride=1),
            ReLU(),
            DepthwiseConv2D(32, k=3, pad=1, stride=2),
            ReLU(),
            Conv2D(32, 48, k=1, pad=0, stride=1),
            ReLU(),
            MaxPool2D(2, 2),
            GAP(),
            Dense(48, 1),
        ]
        self.step_t = 0

    def forward(self, x):
        self.acts = [x]
        a = x
        for layer in self.layers:
            a = layer.forward(a)
            self.acts.append(a)
        self.logit = a
        return sigmoid(a).reshape(-1)

    def backward(self, y):
        # dL/dlogit = p - y for BCE+sigmoid; layers normalize by batch size.
        p = sigmoid(self.logit).reshape(-1)
        dlogit = p - y
        dout = dlogit.reshape(-1, 1)
        for layer in reversed(self.layers):
            dout = layer.backward(dout)
        return dout

    def loss(self, logit, y):
        p = sigmoid(logit).reshape(-1)
        eps = 1e-9
        return -np.mean(y * np.log(p + eps) + (1 - y) * np.log(1 - p + eps))

    def params(self):
        out = []
        for layer in self.layers:
            out.extend(layer.params())
        return out

    def zero_grad(self):
        for layer in self.layers:
            layer.zero_grad()

    def step(self, lr, beta1=0.9, beta2=0.999, lam=0.0):
        self.step_t += 1
        t = self.step_t
        for name, w, gw, m, v in self.params():
            gw = gw + lam * w / max(self.batch, 1)
            m[:] = beta1 * m + (1 - beta1) * gw
            v[:] = beta2 * v + (1 - beta2) * gw * gw
            mhat = m / (1 - beta1 ** t)
            vhat = v / (1 - beta2 ** t)
            w -= lr * mhat / (np.sqrt(vhat) + 1e-8)

    def set_batch_size(self, b):
        self.batch = max(b, 1)

    def export(self):
        """Serializable dict mirrored exactly by the JS engine."""
        arch = []
        for layer in self.layers:
            if isinstance(layer, Conv2D):
                arch.append({"type": "conv", "out": layer.cout, "in": layer.cin,
                             "k": layer.k, "pad": layer.pad, "stride": layer.stride,
                             "w": layer.w.tolist(), "b": layer.b.tolist()})
            elif isinstance(layer, DepthwiseConv2D):
                arch.append({"type": "dwconv", "ch": layer.ch, "k": layer.k,
                             "pad": layer.pad, "stride": layer.stride,
                             "w": layer.w.tolist(), "b": layer.b.tolist()})
            elif isinstance(layer, ReLU):
                arch.append({"type": "relu"})
            elif isinstance(layer, MaxPool2D):
                arch.append({"type": "maxpool", "k": layer.k, "stride": layer.stride})
            elif isinstance(layer, GAP):
                arch.append({"type": "gap"})
            elif isinstance(layer, Dense):
                arch.append({"type": "dense", "out": layer.w.shape[0], "in": layer.w.shape[1],
                             "w": layer.w.tolist(), "b": layer.b.tolist()})
            else:  # pragma: no cover
                raise TypeError(type(layer).__name__)
        return {
            "version": 1,
            "input": [1, 48, 96],
            "task": "sensitive_ui_region_binary",
            "layers": arch,
        }