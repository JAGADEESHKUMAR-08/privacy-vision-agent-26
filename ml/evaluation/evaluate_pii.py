"""
PII Type Classifier - Evaluation.

Loads the trained model, evaluates on the held-out test set, computes
per-class precision/recall/F1, overall metrics, and a confusion matrix.

Run:
    python ml/evaluation/evaluate_pii.py
"""

import json
import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from model import (PiiClassifier, build_vocab, texts_to_sequences)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data_generation")
TRAIN_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "training")
EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
EXTENSION_MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                   "..", "extension", "model")

LABELS = [
    "EMAIL", "PHONE", "CREDIT_CARD", "NAME", "ADDRESS", "PASSWORD",
    "USERNAME", "API_KEY", "AUTH_TOKEN", "SSN", "MEDICAL_ID",
    "BANK_ACCOUNT", "FINANCIAL_DATA", "DATE_OF_BIRTH", "NONE",
]
LABEL_TO_IDX = {l: i for i, l in enumerate(LABELS)}


def load_json(path):
    with open(path, "r") as f:
        return json.load(f)


def load_model_clf():
    """Load the trained PiiClassifier from extension/model/pii_weights.json."""
    weights_path = os.path.join(EXTENSION_MODEL_DIR, "pii_weights.json")
    payload = load_json(weights_path)
    config = payload["config"]
    clf = PiiClassifier(
        vocab_size=config["vocab_size"],
        embed_dim=config["embed_dim"],
        hidden_dim=config["hidden_dim"],
        num_classes=config["num_classes"],
        max_len=config["max_len"],
    )
    w = payload["weights"]
    clf.set_weights({
        "embedding": np.array(w["embedding"], dtype=np.float32),
        "W1": np.array(w["W1"], dtype=np.float32),
        "b1": np.array(w["b1"], dtype=np.float32),
        "W2": np.array(w["W2"], dtype=np.float32),
        "b2": np.array(w["b2"], dtype=np.float32),
    })
    return clf, payload


def compute_metrics(y_true, y_pred, num_classes):
    """Per class precision, recall, f1. Overall metrics."""
    conf = np.zeros((num_classes, num_classes), dtype=np.int64)
    for t, p in zip(y_true, y_pred):
        conf[t, p] += 1

    per_class = {}
    for c in range(num_classes):
        tp = conf[c, c]
        fp = conf[:, c].sum() - tp
        fn = conf[c, :].sum() - tp
        tn = conf.sum() - tp - fp - fn
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
        per_class[LABELS[c]] = {
            "tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn),
            "precision": precision, "recall": recall, "f1": f1,
            "support": int(tp + fn),
        }

    # Macro / weighted
    macro_p = np.mean([v["precision"] for v in per_class.values()])
    macro_r = np.mean([v["recall"] for v in per_class.values()])
    macro_f1 = np.mean([v["f1"] for v in per_class.values()])

    supports = np.array([v["support"] for v in per_class.values()])
    total = supports.sum()
    weighted_f1 = np.sum(np.array([v["f1"] for v in per_class.values()]) * supports) / total if total > 0 else 0.0
    weighted_p = np.sum(np.array([v["precision"] for v in per_class.values()]) * supports) / total if total > 0 else 0.0
    weighted_r = np.sum(np.array([v["recall"] for v in per_class.values()]) * supports) / total if total > 0 else 0.0
    accuracy = np.mean(y_pred == y_true)

    return conf, per_class, {
        "accuracy": accuracy,
        "macro_precision": macro_p,
        "macro_recall": macro_r,
        "macro_f1": macro_f1,
        "weighted_precision": weighted_p,
        "weighted_recall": weighted_r,
        "weighted_f1": weighted_f1,
    }


def format_table(per_class, overall):
    """Render metrics as aligned text table."""
    header = f"{'Label':<18}{'Prec':>8}{'Rec':>8}{'F1':>8}{'Support':>8}"
    sep = "-" * len(header)
    lines = [header, sep]
    for label in LABELS:
        v = per_class[label]
        lines.append(f"{label:<18}{v['precision']:>8.4f}{v['recall']:>8.4f}"
                     f"{v['f1']:>8.4f}{v['support']:>8d}")
    lines.append(sep)
    lines.append(f"{'Macro':<18}{overall['macro_precision']:>8.4f}"
                 f"{overall['macro_recall']:>8.4f}{overall['macro_f1']:>8.4f}"
                 f"{'':>8}")
    lines.append(f"{'Weighted':<18}{overall['weighted_precision']:>8.4f}"
                 f"{overall['weighted_recall']:>8.4f}{overall['weighted_f1']:>8.4f}"
                 f"{'':>8}")
    return "\n".join(lines)


def format_confusion(conf):
    """Render confusion matrix as text."""
    labels_abbrev = [l[:6] for l in LABELS]
    width = 8
    header = "".join(f"{a:>{width}}" for a in ["", *labels_abbrev])
    fmt = "".join(f"{a:>{width}}" for a in labels_abbrev)
    lines = [header]
    for i, label in enumerate(LABELS):
        row = [f"{label[:6]:>{width}}"]
        row += [f"{conf[i, j]:>{width - 1}d}" for j in range(len(LABELS))]
        lines.append("".join(row))
    return "\n".join(lines)


def main():
    print("=" * 64)
    print("PII Type Classifier - Evaluation")
    print("=" * 64)

    # Load test split
    test_data = load_json(os.path.join(DATA_DIR, "pii_test.json"))
    test_texts = [d["text"] for d in test_data]
    test_labels = [d["label"] for d in test_data]
    y_true = np.array([LABEL_TO_IDX[l] for l in test_labels], dtype=np.int64)
    print(f"Test samples: {len(test_texts)}")

    # Load model
    clf, payload = load_model_clf()
    print(f"Loaded model: vocab_size={clf.vocab_size}, "
          f"embed_dim={clf.embed_dim}, hidden_dim={clf.hidden_dim}")

    # Build vocab from model payload (use training vocab that was saved)
    vocab = {str(k): int(v) for k, v in payload["vocab"].items()}
    new_vocab = {k: v for k, v in vocab.items()}

    # Rebuild vocab (same tokenizer) - need the vocab that was used at training.
    # The saved vocab is already keyed by token strings.
    X_test = texts_to_sequences(test_texts, new_vocab, clf.max_len)
    y_pred = clf.predict(X_test)

    # Metrics
    conf, per_class, overall = compute_metrics(y_true, y_pred, len(LABELS))

    print("\nPer-class Metrics")
    print("-" * 64)
    print(format_table(per_class, overall))
    print(f"\nOverall Accuracy: {overall['accuracy']:.4f}")
    print(f"Macro F1:         {overall['macro_f1']:.4f}")
    print(f"Weighted F1:      {overall['weighted_f1']:.4f}")

    print("\nConfusion Matrix (rows=true, cols=predicted)")
    print("-" * 64)
    print(format_confusion(conf))

    # Save results
    results = {
        "test_samples": len(test_texts),
        "overall": {k: float(v) if isinstance(v, (int, float)) else v
                    for k, v in overall.items()},
        "per_class": {k: {kk: (float(vv) if isinstance(vv, (int, float)) else vv)
                          for kk, vv in v.items()}
                      for k, v in per_class.items()},
        "confusion_matrix": conf.tolist(),
        "labels": LABELS,
        "evaluated_at": "2026-09-06",
    }
    out_path = os.path.join(EVAL_DIR, "pii_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to {out_path}")

    # Sanity threshold check
    if overall["accuracy"] >= 0.85:
        print(f"\nPASS: Accuracy {overall['accuracy']:.4f} >= 0.85")
    else:
        print(f"\nWARNING: Accuracy {overall['accuracy']:.4f} < 0.85 target")


if __name__ == "__main__":
    main()
