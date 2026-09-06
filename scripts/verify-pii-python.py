"""
Verification harness: runs the trained PII classifier (Python reference) over
the test set and dumps per-sample predicted labels to a JSON file for
comparison against the JS inference engine (pii-inference.js).

Usage: python scripts/verify-pii-python.py
Output: scripts/pii_python_predictions.json
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ml"))

from model import PiiClassifier, texts_to_sequences

ROOT = os.path.join(os.path.dirname(__file__), "..")
MODEL_PATH = os.path.join(ROOT, "extension", "model", "pii_model.json")
TEST_PATH = os.path.join(ROOT, "ml", "data_generation", "pii_test.json")
OUT_PATH = os.path.join(os.path.dirname(__file__), "pii_python_predictions.json")


def main():
    with open(MODEL_PATH, "r") as f:
        payload = json.load(f)

    cfg = payload["config"]
    vocab = {str(k): int(v) for k, v in payload["vocab"].items()}
    labels = payload["labels"]

    clf = PiiClassifier(
        vocab_size=cfg["vocab_size"],
        embed_dim=cfg["embed_dim"],
        hidden_dim=cfg["hidden_dim"],
        num_classes=cfg["num_classes"],
        max_len=cfg["max_len"],
        dropout=cfg.get("dropout", 0.2),
    )
    clf.set_training(False)
    # Convert nested JSON lists to float32 numpy arrays (required for indexing).
    def to_f32(arr):
        return np.array(arr, dtype=np.float32)

    clf.set_weights({
        "embedding": to_f32(payload["weights"]["embedding"]),
        "W1": to_f32(payload["weights"]["W1"]),
        "b1": to_f32(payload["weights"]["b1"]),
        "W2": to_f32(payload["weights"]["W2"]),
        "b2": to_f32(payload["weights"]["b2"]),
    })

    with open(TEST_PATH, "r") as f:
        test_data = json.load(f)

    texts = [d["text"] for d in test_data]
    X = texts_to_sequences(texts, vocab, cfg["max_len"])
    probs = clf.predict_probs(X)
    preds = [int(argmax(p)) for p in probs]

    results = []
    for i, d in enumerate(test_data):
        results.append({
            "text": d["text"],
            "truth": d["label"],
            "pred": labels[preds[i]],
            "prob": round(float(probs[i][preds[i]]), 6),
        })

    with open(OUT_PATH, "w") as f:
        json.dump(results, f, indent=1)

    correct = sum(1 for r in results if r["pred"] == r["truth"])
    total = len(results)
    print(f"Python reference accuracy: {correct}/{total} = {correct / total:.3%}")
    print(f"Wrote {len(results)} predictions -> {OUT_PATH}")


def argmax(arr):
    best = 0
    for i in range(1, len(arr)):
        if arr[i] > arr[best]:
            best = i
    return best


if __name__ == "__main__":
    main()
