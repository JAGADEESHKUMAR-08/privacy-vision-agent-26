"""
PII Type Classifier - Pure NumPy Training Pipeline.

Trains a character+word level neural network to classify text snippets into
PII categories. Uses only numpy (no PyTorch/TensorFlow).

Run:
    python ml/training/train_pii.py
"""

import json
import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from model import (PiiClassifier, build_vocab, texts_to_sequences,
                   cross_entropy, save_model_json)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data_generation")
EXTENSION_MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                   "..", "extension", "model")

# Hyperparameters
MAX_LEN = 64
EMBED_DIM = 128
HIDDEN_DIM = 128
DROPOUT = 0.2
BATCH_SIZE = 64
LEARNING_RATE = 0.001
EPOCHS = 100
PATIENCE = 10

LABELS = [
    "EMAIL", "PHONE", "CREDIT_CARD", "NAME", "ADDRESS", "PASSWORD",
    "USERNAME", "API_KEY", "AUTH_TOKEN", "SSN", "MEDICAL_ID",
    "BANK_ACCOUNT", "FINANCIAL_DATA", "DATE_OF_BIRTH", "NONE",
]

LABEL_TO_IDX = {l: i for i, l in enumerate(LABELS)}


def load_json(path):
    with open(path, "r") as f:
        return json.load(f)


def encode_labels(labels_list):
    return np.array([LABEL_TO_IDX[l] for l in labels_list], dtype=np.int32)


def shuffle_data(X, y, seed=None):
    if seed is not None:
        rng = np.random.default_rng(seed)
        indices = rng.permutation(len(X))
    else:
        indices = np.random.permutation(len(X))
    return X[indices], y[indices]


def cosine_decay_lr(base_lr, t, total_steps):
    """Cosine annealing schedule."""
    if total_steps == 0:
        return base_lr
    return base_lr * (0.5 * (1.0 + np.cos(np.pi * t / total_steps)))


def main():
    print("=" * 64)
    print("PII Type Classifier - Training (Pure NumPy)")
    print("=" * 64)

    # 1. Load data
    print("\n[1/5] Loading training/validation data...")
    train_data = load_json(os.path.join(DATA_DIR, "pii_train.json"))
    val_data = load_json(os.path.join(DATA_DIR, "pii_val.json"))
    train_texts = [d["text"] for d in train_data]
    train_labels = [d["label"] for d in train_data]
    val_texts = [d["text"] for d in val_data]
    val_labels = [d["label"] for d in val_data]
    print(f"  Train: {len(train_texts)} samples")
    print(f"  Val:   {len(val_texts)} samples")

    # 2. Build vocabulary
    print("\n[2/5] Building vocabulary...")
    vocab = build_vocab(train_texts)
    vocab_size = len(vocab)
    print(f"  Vocabulary size: {vocab_size}")

    # 3. Prepare tensors
    print("\n[3/5] Preparing data...")
    X_train = texts_to_sequences(train_texts, vocab, MAX_LEN)
    y_train = encode_labels(train_labels)
    X_val = texts_to_sequences(val_texts, vocab, MAX_LEN)
    y_val = encode_labels(val_labels)

    print(f"  X_train shape: {X_train.shape}")
    print(f"  X_val shape:   {X_val.shape}")

    # 4. Train
    print("\n[4/5] Training model...")
    clf = PiiClassifier(
        vocab_size=vocab_size,
        embed_dim=EMBED_DIM,
        hidden_dim=HIDDEN_DIM,
        num_classes=len(LABELS),
        max_len=MAX_LEN,
        dropout=DROPOUT,
    )
    clf.optimizer.lr = LEARNING_RATE

    total_steps = (len(X_train) // BATCH_SIZE) * EPOCHS
    step_count = 0

    best_val_acc = 0.0
    best_weights = None
    best_epoch = 0
    no_improve = 0
    history = []

    for epoch in range(1, EPOCHS + 1):
        clf.set_training(True)
        X_train, y_train = shuffle_data(X_train, y_train)

        epoch_loss = 0.0
        num_batches = 0

        for i in range(0, len(X_train), BATCH_SIZE):
            X_batch = X_train[i:i + BATCH_SIZE]
            y_batch = y_train[i:i + BATCH_SIZE]

            # Cosine decay learning rate
            lr = cosine_decay_lr(LEARNING_RATE, step_count, total_steps)
            clf.optimizer.lr = lr
            step_count += 1

            probs = clf.forward(X_batch)
            loss = cross_entropy(probs, y_batch)
            clf.backward(y_batch)
            clf.update()

            epoch_loss += loss
            num_batches += 1

        avg_loss = epoch_loss / max(num_batches, 1)
        train_acc = clf.accuracy(X_train, y_train)
        val_acc = clf.accuracy(X_val, y_val)

        history.append({
            "epoch": epoch,
            "loss": float(avg_loss),
            "train_acc": train_acc,
            "val_acc": val_acc,
            "lr": lr,
        })

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_epoch = epoch
            best_weights = clf.get_weights()
            no_improve = 0
        else:
            no_improve += 1

        if epoch == 1 or epoch % 5 == 0 or no_improve == PATIENCE:
            print(f"  Epoch {epoch:3d}/{EPOCHS} | Loss: {avg_loss:.4f} | "
                  f"Train Acc: {train_acc:.4f} | Val Acc: {val_acc:.4f} | "
                  f"LR: {lr:.6f}")

        if no_improve >= PATIENCE:
            print(f"  Early stopping at epoch {epoch} (no improvement for {PATIENCE} epochs)")
            break

    print(f"\n  Best validation accuracy: {best_val_acc:.4f} (epoch {best_epoch})")

    # Restore best weights
    if best_weights is not None:
        clf.set_weights(best_weights)

    # 5. Export
    print("\n[5/5] Exporting model...")
    os.makedirs(EXTENSION_MODEL_DIR, exist_ok=True)

    weights_path = os.path.join(EXTENSION_MODEL_DIR, "pii_weights.json")
    payload = save_model_json(clf, vocab, LABELS, weights_path)
    print(f"  Saved weights to {weights_path}")

    # Also save pii_model.json (full model) for the export step / JS use
    model_path = os.path.join(EXTENSION_MODEL_DIR, "pii_model.json")
    with open(model_path, "w") as f:
        json.dump(payload, f)
    print(f"  Saved full model to {model_path}")

    # Save training history
    hist_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "training_history.json")
    with open(hist_path, "w") as f:
        json.dump(history, f, indent=2)
    print(f"  Saved training history to {hist_path}")

    # Test predictions
    print("\n" + "-" * 64)
    print("Sample Predictions")
    print("-" * 64)
    test_samples = [
        "john.doe@example.com",
        "Contact us at support@company.com for help",
        "+1 (555) 123-4567",
        "My phone number is 555-867-5309",
        "4532 0151 1283 0669",
        "Enter your card number: 4111 1111 1111 1111",
        "Aarav Patel",
        "123 Maple St, Springfield, CA 93801",
        "sk-94jf03mckf031jdkf0392kdjfi02kdjf",
        "s3cure.P@ssw0rd!42",
        "933-42-5512",
        "MRN-4829137",
        "Account: 4829137412, Routing: 092293402",
        "$1,250.00",
        "12/08/1995",
        "Welcome to our platform",
        "Learn more about our products",
        "Add to cart",
    ]

    for sample in test_samples:
        seq = texts_to_sequences([sample], vocab, MAX_LEN)
        probs = clf.predict_probs(seq)[0]
        pred_idx = int(np.argmax(probs))
        confidence = float(probs[pred_idx])
        print(f"  '{sample}'")
        print(f"    -> {LABELS[pred_idx]} ({confidence:.2%})")

    print("\n" + "=" * 64)
    print(f"Done! Best val acc: {best_val_acc:.4f}")
    print("Model exported to:", EXTENSION_MODEL_DIR)
    print("=" * 64)


if __name__ == "__main__":
    main()
