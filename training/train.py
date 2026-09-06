import json
import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

from data_gen import generate_dataset
from model import NumpyClassifier, LABELS, MAX_LEN


EXTENSION_MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "extension", "model")


def build_vocab(texts, vocab_size=5000):
    word_freq = {}
    for text in texts:
        for word in text.split():
            word_freq[word] = word_freq.get(word, 0) + 1

    sorted_words = sorted(word_freq.items(), key=lambda x: -x[1])
    word_index = {"<PAD>": 0, "<UNK>": 1}
    for i, (word, _) in enumerate(sorted_words[:vocab_size - 2]):
        word_index[word] = i + 2
    return word_index


def texts_to_sequences(texts, word_index, max_len):
    sequences = []
    for text in texts:
        words = text.split()
        seq = [word_index.get(w, 1) for w in words]
        if len(seq) >= max_len:
            seq = seq[:max_len]
        else:
            seq = seq + [0] * (max_len - len(seq))
        sequences.append(seq)
    return np.array(sequences, dtype=np.int32)


def encode_labels(labels):
    label_to_idx = {label: i for i, label in enumerate(LABELS)}
    return np.array([label_to_idx[l] for l in labels])


def shuffle_data(X, y):
    indices = np.random.permutation(len(X))
    return X[indices], y[indices]


def main():
    print("=" * 60)
    print("Privacy Vision Agent - Model Training (Pure NumPy)")
    print("=" * 60)

    # 1. Generate data
    print("\n[1/5] Generating synthetic training data...")
    data = generate_dataset(samples_per_class=350)
    texts = [item["task"] for item in data]
    labels = [item["label"] for item in data]
    print(f"  Total samples: {len(texts)}")

    label_counts = {}
    for l in labels:
        label_counts[l] = label_counts.get(l, 0) + 1
    for label, count in sorted(label_counts.items()):
        print(f"    {label}: {count}")

    # 2. Build vocab
    print("\n[2/5] Building vocabulary...")
    word_index = build_vocab(texts)
    print(f"  Vocabulary size: {len(word_index)}")

    # 3. Prepare data
    print("\n[3/5] Preparing data...")
    X = texts_to_sequences(texts, word_index, MAX_LEN)
    y = encode_labels(labels)
    X, y = shuffle_data(X, y)

    split = int(len(X) * 0.8)
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]
    print(f"  Train: {len(X_train)}, Val: {len(X_val)}")

    # 4. Train
    print("\n[4/5] Training model...")
    clf = NumpyClassifier(vocab_size=len(word_index))

    epochs = 50
    batch_size = 32
    best_val_acc = 0
    patience = 15
    no_improve = 0
    best_weights = None

    for epoch in range(epochs):
        X_train, y_train = shuffle_data(X_train, y_train)

        epoch_loss = 0
        num_batches = 0

        for i in range(0, len(X_train), batch_size):
            X_batch = X_train[i:i+batch_size]
            y_batch = y_train[i:i+batch_size]

            probs = clf.forward(X_batch)
            loss = cross_entropy(probs, y_batch)
            clf.backward(y_batch)
            clf.update()

            epoch_loss += loss
            num_batches += 1

        avg_loss = epoch_loss / num_batches
        train_acc = clf.accuracy(X_train, y_train)
        val_acc = clf.accuracy(X_val, y_val)

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            no_improve = 0
            best_weights = clf.get_weights()
        else:
            no_improve += 1

        if (epoch + 1) % 5 == 0 or epoch == 0:
            print(f"  Epoch {epoch+1:3d}/{epochs} | Loss: {avg_loss:.4f} | "
                  f"Train Acc: {train_acc:.4f} | Val Acc: {val_acc:.4f}")

        if no_improve >= patience:
            print(f"  Early stopping at epoch {epoch+1}")
            break

    # Restore best weights
    if best_weights:
        clf.embedding = best_weights["embedding"]
        clf.W1 = best_weights["W1"]
        clf.b1 = best_weights["b1"]
        clf.W2 = best_weights["W2"]
        clf.b2 = best_weights["b2"]
        clf.params = {
            "W1": clf.W1, "b1": clf.b1,
            "W2": clf.W2, "b2": clf.b2,
            "embedding": clf.embedding,
        }

    print(f"\n  Best val accuracy: {best_val_acc:.4f}")

    # 5. Save
    print("\n[5/5] Exporting model...")
    os.makedirs(EXTENSION_MODEL_DIR, exist_ok=True)

    weights_path = os.path.join(EXTENSION_MODEL_DIR, "weights.json")
    clf.save_weights(weights_path)

    vocab_path = os.path.join(EXTENSION_MODEL_DIR, "vocab.json")
    json_safe_vocab = {k: int(v) for k, v in word_index.items()}
    with open(vocab_path, "w") as f:
        json.dump(json_safe_vocab, f)
    print(f"  Vocabulary: {vocab_path}")

    labels_path = os.path.join(EXTENSION_MODEL_DIR, "labels.json")
    with open(labels_path, "w") as f:
        json.dump(LABELS, f, indent=2)
    print(f"  Labels: {labels_path}")

    config = {
        "max_len": MAX_LEN,
        "embed_dim": clf.embed_dim,
        "hidden_dim": clf.hidden_dim,
        "num_classes": clf.num_classes,
        "vocab_size": len(word_index),
        "labels": LABELS,
    }
    config_path = os.path.join(EXTENSION_MODEL_DIR, "config.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"  Config: {config_path}")

    # Test predictions
    print("\n" + "=" * 60)
    print("Test Predictions")
    print("=" * 60)
    test_tasks = [
        "click the search button",
        "open my profile",
        "fill in the email field",
        "scroll to the bottom",
        "find pending applications",
        "what time is it",
        "please click on settings",
        "i want to see my account",
        "search for documents",
        "type in the password",
    ]

    for task in test_tasks:
        seq = texts_to_sequences([task], word_index, MAX_LEN)
        probs = clf.predict_probs(seq)[0]
        pred_idx = int(np.argmax(probs))
        confidence = float(probs[pred_idx])
        print(f"  '{task}'")
        print(f"    -> {LABELS[pred_idx]} ({confidence:.2%})")

    print("\nDone! Model files exported to:", EXTENSION_MODEL_DIR)


def cross_entropy(y_pred, y_true):
    m = y_true.shape[0]
    log_probs = -np.log(y_pred[np.arange(m), y_true] + 1e-8)
    return np.mean(log_probs)


if __name__ == "__main__":
    main()
