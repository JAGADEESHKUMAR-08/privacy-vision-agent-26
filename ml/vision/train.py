"""
Phase 5c: Train the MobileNet-style sensitive-UI binary classifier.

Loads ml/vision/data/dataset.npz, trains with Adam + BCE in pure numpy,
then exports the trained weights to extension/model/vision_model.json in the
exact format consumed by extension/vision-inference.js.
"""

import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import VisionNet  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data", "dataset.npz")


def load_data(path):
    d = np.load(path)
    return d["images"], d["labels"]


def train(epochs=8, batch=64, lr=2e-3, val_frac=0.1, seed=7, quick=False):
    np.random.seed(seed)
    images, labels = load_data(DATA)
    n = images.shape[0]
    perm = np.random.permutation(n)
    images, labels = images[perm], labels[perm]
    nval = int(n * val_frac)
    xval, yval = images[:nval], labels[:nval]
    xtr, ytr = images[nval:], labels[nval:]

    net = VisionNet()
    net.set_batch_size(batch)
    print(f"train={xtr.shape[0]}  val={nval}  params~2665")

    steps = 0
    best = -1.0
    for ep in range(epochs):
        t0 = time.time()
        order = np.random.permutation(xtr.shape[0])
        losses = []
        for s in range(0, xtr.shape[0], batch):
            idx = order[s:s + batch]
            xb = xtr[idx][:, None, :, :]
            yb = ytr[idx].astype(np.float64)
            logit = net.forward(xb)
            loss = float(net.loss(logit, yb))
            losses.append(loss)
            net.backward(yb)
            net.step(lr)
            steps += 1
        acc, _ = evaluate(net, xval, yval)
        if acc > best:
            best = acc
            best_net = net_from_arch(net.export())
        dt = time.time() - t0
        print(f"epoch {ep + 1}/{epochs}  loss={np.mean(losses):.4f}  val_acc={acc:.3f}  ({dt:.1f}s)")
        if quick and ep >= 1:
            break

    # Full validation report on best snapshot.
    if best_net is None:
        best_net = net_from_arch(net.export())
    acc, cm = evaluate(best_net, xval, yval)
    print(f"BEST val acc={acc:.3f}  confusion (rows=actual: [benign, sensitive])={cm.tolist()}")
    out_dir = os.path.join(HERE, "..", "..", "extension", "model")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "vision_model.json")
    with open(out, "w") as f:
        json.dump(best_net.export(), f)
    sz = os.path.getsize(out)
    print(f"exported {out} ({sz / 1024:.1f} KB)")


def net_from_arch(arch):
    """Rebuild a VisionNet geometry and load serialized weights back in."""
    net = VisionNet()
    for i, spec in enumerate(arch["layers"]):
        target = net.layers[i]
        if "w" in spec:
            target.w = np.array(spec["w"], dtype=np.float64)
        if "b" in spec:
            target.b = np.array(spec["b"], dtype=np.float64)
    return net


def evaluate(net, x, y):
    preds = []
    bs = 128
    for s in range(0, x.shape[0], bs):
        xb = x[s:s + bs][:, None, :, :]
        p = net.forward(xb)
        preds.append(p)
    p = np.concatenate(preds)
    acc = float(np.mean((p >= 0.5) == (y == 1)))
    cm = np.zeros((2, 2), dtype=int)
    for t in range(2):
        for pr in range(2):
            m = (y == t) & ((p >= 0.5) == (pr == 1))
            cm[t, pr] = int(m.sum())
    return acc, cm


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    train(a.epochs, a.batch, a.lr, quick=a.quick)