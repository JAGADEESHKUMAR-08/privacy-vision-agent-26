"""Exports reference VisionNet predictions + cropped pixels for the JS parity check.

Reads sample crops from ml/vision/data/dataset.npz, runs the pure-NumPy
VisionNet forward pass (ml/vision/model.py) on them, and writes a compact JSON
consumed by scripts/verify-vision-js.js so the JS port can be checked for 1:1
numeric agreement.

Usage: python ml/vision/export_reference.py
Output: scripts/vision_python_predictions.json
"""

import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "ml", "vision"))

from model import VisionNet  # noqa: E402

SAMPLE_COUNT = 24
OUT = os.path.join(ROOT, "scripts", "vision_python_predictions.json")


def main():
    npz = os.path.join(ROOT, "ml", "vision", "data", "dataset.npz")
    with np.load(npz, allow_pickle=False) as data:
        images = data["images"]          # (8000, 48, 96) float32, normalized 0..1
        labels = data["labels"].astype(np.int64)

    rng = np.random.RandomState(42)
    pos = rng.choice(np.where(labels == 1)[0], size=SAMPLE_COUNT // 2, replace=False)
    neg = rng.choice(np.where(labels == 0)[0], size=SAMPLE_COUNT // 2, replace=False)
    idx = np.concatenate([pos, neg])

    # Load the *exported* weights (the exact JSON the JS engine consumes) so the
    # reference matches the artifact rather than an in-memory model.
    with open(os.path.join(ROOT, "extension", "model", "vision_model.json")) as f:
        exported = json.load(f)

    # Rebuild from export weights with the same init code path (weights are
    # overwritten below), matching VisionNet.export()/load conventions.
    net = VisionNet()

    def set_param(layer, target):
        net.layers[layer].w[:] = np.asarray(target["w"], dtype=np.float32)
        net.layers[layer].b[:] = np.asarray(target["b"], dtype=np.float32)

    export_layers = exported["layers"]
    li = 0
    for layer in export_layers:
        if layer["type"] == "conv":
            set_param(li, layer)
        if layer["type"] == "dwconv":
            set_param(li, layer)
        if layer["type"] == "dense":
            set_param(li, layer)
        li += 1

    batch = images[idx][:, None, :, :].astype(np.float32)  # (S,1,48,96)
    probs = net.forward(batch).astype(np.float64)

    records = []
    for i, crop in enumerate(images[idx]):
        records.append({
            "idx": int(idx[i]),
            "label": int(labels[idx[i]]),
            "prob": float(probs[i]),
            "gray": [round(float(v), 4) for v in crop.ravel()],
        })

    with open(OUT, "w") as f:
        json.dump(records, f)

    acc = int(((probs > 0.5) == labels[idx]).sum())
    print(f"Wrote {len(records)} samples to {os.path.relpath(OUT, ROOT)}")
    print(f"Reference model: {acc}/{len(records)} threshold-correct "
          f"(prob range {probs.min():.4f}..{probs.max():.4f})")


if __name__ == "__main__":
    main()