import json
import os
import numpy as np


LABELS = ["click_button", "click_link", "fill_input", "scroll", "search", "unknown"]
MAX_LEN = 32
EMBED_DIM = 64
HIDDEN_DIM = 64


def relu(x):
    return np.maximum(0, x)


def relu_grad(x):
    return (x > 0).astype(np.float32)


def softmax(x):
    e = np.exp(x - np.max(x, axis=1, keepdims=True))
    return e / np.sum(e, axis=1, keepdims=True)


def cross_entropy_loss(y_pred, y_true):
    m = y_true.shape[0]
    log_probs = -np.log(y_pred[np.arange(m), y_true] + 1e-8)
    return np.mean(log_probs)


class AdamOptimizer:
    def __init__(self, lr=0.003, beta1=0.9, beta2=0.999, eps=1e-8):
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


class NumpyClassifier:
    def __init__(self, vocab_size, embed_dim=EMBED_DIM, hidden_dim=HIDDEN_DIM,
                 num_classes=len(LABELS), max_len=MAX_LEN):
        self.vocab_size = vocab_size
        self.embed_dim = embed_dim
        self.hidden_dim = hidden_dim
        self.num_classes = num_classes
        self.max_len = max_len

        scale1 = np.sqrt(2.0 / vocab_size)
        self.embedding = np.random.randn(vocab_size, embed_dim).astype(np.float32) * scale1

        scale2 = np.sqrt(2.0 / embed_dim)
        self.W1 = np.random.randn(embed_dim, hidden_dim).astype(np.float32) * scale2
        self.b1 = np.zeros(hidden_dim, dtype=np.float32)

        scale3 = np.sqrt(2.0 / hidden_dim)
        self.W2 = np.random.randn(hidden_dim, num_classes).astype(np.float32) * scale3
        self.b2 = np.zeros(num_classes, dtype=np.float32)

        self.optimizer = AdamOptimizer()

        self.grads = {
            "W1": np.zeros_like(self.W1),
            "b1": np.zeros_like(self.b1),
            "W2": np.zeros_like(self.W2),
            "b2": np.zeros_like(self.b2),
            "embedding": np.zeros_like(self.embedding),
        }
        self.params = {
            "W1": self.W1,
            "b1": self.b1,
            "W2": self.W2,
            "b2": self.b2,
            "embedding": self.embedding,
        }

    def forward(self, X):
        self.X = X
        batch_size = X.shape[0]

        embedded = self.embedding[X]
        self.pooled = np.mean(embedded, axis=1)

        self.z1 = self.pooled @ self.W1 + self.b1
        self.a1 = relu(self.z1)

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
        dz1 = da1 * relu_grad(self.z1)

        self.grads["W1"] = self.pooled.T @ dz1
        self.grads["b1"] = np.sum(dz1, axis=0)

        dembed = np.zeros_like(self.embedding)
        mask = (self.X > 0).astype(np.float32)
        denom = np.maximum(np.sum(mask, axis=1, keepdims=True), 1.0)
        grad_pooled = dz1
        for i in range(m):
            seq_len = int(denom[i, 0])
            positions = self.X[i, :seq_len]
            contrib = grad_pooled[i] / seq_len
            np.add.at(dembed, positions, contrib)
        self.grads["embedding"] = dembed

        return self.grads

    def update(self):
        self.optimizer.step(self.params, self.grads)
        self.W1, self.b1, self.W2, self.b2, self.embedding = (
            self.params["W1"], self.params["b1"],
            self.params["W2"], self.params["b2"],
            self.params["embedding"],
        )

    def predict_probs(self, X):
        return self.forward(X)

    def predict(self, X):
        probs = self.predict_probs(X)
        return np.argmax(probs, axis=1)

    def accuracy(self, X, y):
        preds = self.predict(X)
        return np.mean(preds == y)

    def get_weights(self):
        return {
            "embedding": self.embedding.copy(),
            "W1": self.W1.copy(),
            "b1": self.b1.copy(),
            "W2": self.W2.copy(),
            "b2": self.b2.copy(),
        }

    def save_weights(self, path):
        weights = self.get_weights()
        weights = {
            k: (v.tolist() if isinstance(v, np.ndarray) else v)
            for k, v in weights.items()
        }
        weights["config"] = {
            "vocab_size": self.vocab_size,
            "embed_dim": self.embed_dim,
            "hidden_dim": self.hidden_dim,
            "num_classes": self.num_classes,
            "max_len": self.max_len,
        }
        with open(path, "w") as f:
            json.dump(weights, f)
        print(f"Weights saved to {path}")

    @classmethod
    def load_weights(cls, path):
        with open(path, "r") as f:
            weights = json.load(f)

        config = weights["config"]
        clf = cls(
            vocab_size=config["vocab_size"],
            embed_dim=config["embed_dim"],
            hidden_dim=config["hidden_dim"],
            num_classes=config["num_classes"],
            max_len=config["max_len"],
        )
        clf.embedding = np.array(weights["embedding"], dtype=np.float32)
        clf.W1 = np.array(weights["W1"], dtype=np.float32)
        clf.b1 = np.array(weights["b1"], dtype=np.float32)
        clf.W2 = np.array(weights["W2"], dtype=np.float32)
        clf.b2 = np.array(weights["b2"], dtype=np.float32)
        clf.params = {
            "W1": clf.W1, "b1": clf.b1,
            "W2": clf.W2, "b2": clf.b2,
            "embedding": clf.embedding,
        }
        return clf
