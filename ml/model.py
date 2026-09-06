"""
Pure NumPy PII classification model - shared between training/evaluation/export.

No PyTorch, no TensorFlow. Implements a small character+word level neural
network with embedding, global average pooling, one hidden layer and softmax.
"""

import json
import numpy as np


def relu(x):
    return np.maximum(0, x)


def relu_grad(x):
    return (x > 0).astype(np.float32)


def softmax(x):
    e = np.exp(x - np.max(x, axis=1, keepdims=True))
    return e / (np.sum(e, axis=1, keepdims=True) + 1e-8)


def cross_entropy(y_pred, y_true):
    m = y_true.shape[0]
    log_probs = -np.log(y_pred[np.arange(m), y_true] + 1e-8)
    return np.mean(log_probs)


class AdamOptimizer:
    def __init__(self, lr=0.001, beta1=0.9, beta2=0.999, eps=1e-8):
        self.lr = lr
        self.beta1 = beta1
        self.beta2 = beta2
        self.eps = eps
        self.m = {}
        self.v = {}
        self.t = 0

    def step(self, params, grads):
        self.t += 1
        for name in params:
            if name not in self.m:
                self.m[name] = np.zeros_like(params[name])
                self.v[name] = np.zeros_like(params[name])
            g = grads[name]
            self.m[name] = self.beta1 * self.m[name] + (1 - self.beta1) * g
            self.v[name] = self.beta2 * self.v[name] + (1 - self.beta2) * (g ** 2)
            m_hat = self.m[name] / (1 - self.beta1 ** self.t)
            v_hat = self.v[name] / (1 - self.beta2 ** self.t)
            params[name] -= self.lr * m_hat / (np.sqrt(v_hat) + self.eps)


class PiiClassifier:
    def __init__(self, vocab_size, embed_dim=128, hidden_dim=128,
                 num_classes=15, max_len=64, dropout=0.2, seed=42):
        self.vocab_size = vocab_size
        self.embed_dim = embed_dim
        self.hidden_dim = hidden_dim
        self.num_classes = num_classes
        self.max_len = max_len
        self.dropout = dropout
        self.training = True

        rng = np.random.default_rng(seed)
        scale1 = np.sqrt(2.0 / vocab_size)
        self.embedding = rng.standard_normal((vocab_size, embed_dim), dtype=np.float32) * scale1
        scale2 = np.sqrt(2.0 / embed_dim)
        self.W1 = rng.standard_normal((embed_dim, hidden_dim), dtype=np.float32) * scale2
        self.b1 = np.zeros(hidden_dim, dtype=np.float32)
        scale3 = np.sqrt(2.0 / hidden_dim)
        self.W2 = rng.standard_normal((hidden_dim, num_classes), dtype=np.float32) * scale3
        self.b2 = np.zeros(num_classes, dtype=np.float32)

        self.optimizer = AdamOptimizer(lr=0.001)
        self.params = {
            "embedding": self.embedding,
            "W1": self.W1,
            "b1": self.b1,
            "W2": self.W2,
            "b2": self.b2,
        }
        self.grads = {k: np.zeros_like(v) for k, v in self.params.items()}

    def set_training(self, mode):
        self.training = mode

    def forward(self, X):
        self.X = X
        batch_size = X.shape[0]

        embedded = self.embedding[X]
        # Mask out padding positions (token index 0) from pooling
        mask = (X > 0).astype(np.float32)[:, :, None]
        masked = embedded * mask
        denom = np.maximum(np.sum(mask, axis=1), 1.0)
        self.pooled = np.sum(masked, axis=1) / denom

        self.z1 = self.pooled @ self.W1 + self.b1
        self.a1 = relu(self.z1)

        if self.training:
            self.dropout_mask = (np.random.rand(*self.a1.shape) > self.dropout).astype(np.float32)
            self.a1 = self.a1 * self.dropout_mask / (1.0 - self.dropout)

        self.z2 = self.a1 @ self.W2 + self.b2
        self.a2 = softmax(self.z2)
        return self.a2

    def backward(self, y_true):
        m = y_true.shape[0]
        dz2 = self.a2.copy()
        dz2[np.arange(m), y_true] -= 1
        dz2 /= m

        self.grads["W2"] = self.a1.T @ dz2
        self.grads["b2"] = np.sum(dz2, axis=0)

        da1 = dz2 @ self.W2.T
        if self.training:
            da1 = da1 * self.dropout_mask / (1.0 - self.dropout)
        dz1 = da1 * relu_grad(self.z1)

        self.grads["W1"] = self.pooled.T @ dz1
        self.grads["b1"] = np.sum(dz1, axis=0)

        # Gradient through pooling
        dpooled = dz1 @ self.W1.T
        mask_sum = np.maximum(np.sum((self.X > 0).astype(np.float32), axis=1, keepdims=True), 1.0)
        dembed = np.zeros_like(self.embedding)
        grad_per_token = (dpooled / mask_sum)[:, None, :]  # (m, 1, embed)
        mask3 = (self.X > 0).astype(np.float32)[:, :, None]
        grad_per_token = grad_per_token * mask3
        for i in range(m):
            positions = self.X[i]
            np.add.at(dembed, positions, grad_per_token[i])
        self.grads["embedding"] = dembed

    def update(self):
        self.optimizer.step(self.params, self.grads)
        self.embedding = self.params["embedding"]
        self.W1 = self.params["W1"]
        self.b1 = self.params["b1"]
        self.W2 = self.params["W2"]
        self.b2 = self.params["b2"]

    def predict_probs(self, X):
        was_training = self.training
        self.set_training(False)
        probs = self.forward(X)
        self.set_training(was_training)
        return probs

    def predict(self, X):
        probs = self.predict_probs(X)
        return np.argmax(probs, axis=1)

    def accuracy(self, X, y):
        preds = self.predict(X)
        return float(np.mean(preds == y))

    def get_weights(self):
        return {
            "embedding": self.embedding.copy(),
            "W1": self.W1.copy(),
            "b1": self.b1.copy(),
            "W2": self.W2.copy(),
            "b2": self.b2.copy(),
        }

    def set_weights(self, weights):
        self.embedding = weights["embedding"]
        self.W1 = weights["W1"]
        self.b1 = weights["b1"]
        self.W2 = weights["W2"]
        self.b2 = weights["b2"]
        self.params = {
            "embedding": self.embedding, "W1": self.W1, "b1": self.b1,
            "W2": self.W2, "b2": self.b2,
        }


def build_vocab(texts, max_vocab=10000):
    """Character + word level vocabulary."""
    freq = {}
    for text in texts:
        tokens = tokenize(text)
        for tok in tokens:
            freq[tok] = freq.get(tok, 0) + 1
    sorted_tokens = sorted(freq.items(), key=lambda x: -x[1])
    vocab = {"<PAD>": 0, "<UNK>": 1}
    for tok, _ in sorted_tokens[:max_vocab - 2]:
        if tok not in vocab:
            vocab[tok] = len(vocab)
    return vocab


def tokenize(text):
    """Char + word tokenization. Produces a token stream."""
    tokens = []
    words = text.split()
    for w in words:
        # word token
        tokens.append(w)
        # character-level tokens for the word (prefix with '#' to disambiguate)
        for ch in w:
            tokens.append("#" + ch)
    return tokens


def texts_to_sequences(texts, vocab, max_len):
    sequences = []
    for text in texts:
        tokens = tokenize(text)
        seq = [vocab.get(tok, vocab["<UNK>"]) for tok in tokens]
        if len(seq) >= max_len:
            seq = seq[:max_len]
        else:
            seq = seq + [0] * (max_len - len(seq))
        sequences.append(seq)
    return np.array(sequences, dtype=np.int32)


def save_model_json(clf, vocab, labels, path):
    weights = clf.get_weights()
    weights_serializable = {
        "embedding": weights["embedding"].tolist(),
        "W1": weights["W1"].tolist(),
        "b1": weights["b1"].tolist(),
        "W2": weights["W2"].tolist(),
        "b2": weights["b2"].tolist(),
    }
    payload = {
        "config": {
            "max_len": clf.max_len,
            "embed_dim": clf.embed_dim,
            "hidden_dim": clf.hidden_dim,
            "num_classes": clf.num_classes,
            "vocab_size": clf.vocab_size,
        },
        "labels": labels,
        "vocab": {str(k): int(v) for k, v in vocab.items()},
        "weights": weights_serializable,
    }
    with open(path, "w") as f:
        json.dump(payload, f)
    return payload
