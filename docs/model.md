# ML Model Documentation

Technical documentation for the PII Text Classifier used in Privacy Vision Agent.

## Model Architecture

### Overview

The PII classifier is a lightweight neural network implemented in pure NumPy, designed to run in-browser without requiring TensorFlow.js or PyTorch. It classifies text snippets into one of 15 PII categories (or NONE for non-PII text).

### Architecture Diagram

```
Input Text
    |
    v
[Character Tokenizer]
    |  Converts text to character index sequences
    |  Pads/truncates to fixed length (128 chars)
    v
[Embedding Layer]  (vocab_size x 64)
    |  Learned character embeddings
    |  Output: (128 x 64)
    v
[Global Average Pooling]
    |  Averages across sequence dimension
    |  Output: (64,)
    v
[Dense Layer 1]  (64 -> 256)
    |  weights: (64, 256)
    |  bias: (256,)
    |  Activation: ReLU
    v
[Dropout]  (rate=0.3)
    |  Randomly zeros 30% of activations during training
    v
[Dense Layer 2]  (256 -> 15)
    |  weights: (256, 15)
    |  bias: (15,)
    |  Activation: Softmax
    v
Output Probabilities  (15,)
    |
    v
Predicted Category
```

### Layer Details

| Layer | Input Shape | Output Shape | Parameters |
|-------|-------------|-------------|------------|
| Embedding | (batch, 128) | (batch, 128, 64) | vocab_size x 64 |
| GlobalAvgPool | (batch, 128, 64) | (batch, 64) | 0 |
| Dense + ReLU | (batch, 64) | (batch, 256) | 64 x 256 + 256 = 16,640 |
| Dropout | (batch, 256) | (batch, 256) | 0 |
| Dense + Softmax | (batch, 256) | (batch, 15) | 256 x 15 + 15 = 3,855 |

**Total Parameters**: ~20,500 (excluding embedding)
**Model File Size**: ~450 KB (ONNX format)

## Tokenization

### Character-Level Tokenizer

- Vocabulary: all printable ASCII characters + special tokens
- Max sequence length: 128 characters
- Unknown characters mapped to token index 1 (UNK)
- Padding character: index 0

### Word-Level Features (used in parallel)

- Word frequency features extracted from text
- Bigram features for short text classification
- These features augment the character embeddings in the full pipeline

## Training Data Generation

### Synthetic Data Pipeline

The training data is generated programmatically to avoid using any real PII.

#### Generation Process

1. **Template Selection**: Choose from 15+ sentence templates per category
2. **Value Generation**: Generate realistic-looking values:
   - Emails: random usernames + fake domains
   - Phones: random digits in valid formats
   - Names: random first/last name combinations from public name lists
   - Addresses: random street numbers + street names + cities + ZIP codes
   - Credit cards: random digits validated with Luhn algorithm
   - API keys: random strings with known prefixes (sk_, pk_, ghp_, etc.)
   - SSNs: random 9-digit numbers in XXX-XX-XXXX format
   - etc.
3. **Context Injection**: Wrap PII values in sentence templates
4. **Negative Samples**: Generate sentences without PII using common web text

#### Dataset Statistics

| Metric | Value |
|--------|-------|
| Total Training Samples | 4,800+ |
| Validation Samples | 475 |
| Categories | 15 (14 PII + NONE) |
| Samples per Category | ~300-350 |
| Avg Text Length | ~45 characters |
| Max Text Length | ~128 characters |

#### Category Distribution

| Category | Train Samples | Validation Samples |
|----------|--------------|-------------------|
| EMAIL | ~320 | 41 |
| PHONE | ~300 | 32 |
| NAME | ~280 | 28 |
| ADDRESS | ~310 | 36 |
| PASSWORD | ~300 | 33 |
| USERNAME | ~290 | 27 |
| CREDIT_CARD | ~310 | 34 |
| BANK_ACCOUNT | ~280 | 24 |
| API_KEY | ~300 | 31 |
| AUTH_TOKEN | ~300 | 29 |
| DATE_OF_BIRTH | ~310 | 38 |
| GOVERNMENT_ID | ~300 | 26 |
| MEDICAL_ID | ~300 | 35 |
| FINANCIAL_DATA | ~300 | 34 |
| NONE | ~310 | 27 |

## Training Process

### Optimizer: Adam (Custom Implementation)

```python
class Adam:
    def __init__(self, lr=0.001, beta1=0.9, beta2=0.999, eps=1e-8):
        self.lr = lr
        self.beta1 = beta1
        self.beta2 = beta2
        self.eps = eps
        self.m = {}  # First moment
        self.v = {}  # Second moment
        self.t = 0   # Timestep

    def update(self, params, grads):
        self.t += 1
        for key in params:
            self.m[key] = self.beta1 * self.m.get(key, 0) + (1 - self.beta1) * grads[key]
            self.v[key] = self.beta2 * self.v.get(key, 0) + (1 - self.beta2) * grads[key]**2
            m_hat = self.m[key] / (1 - self.beta1**self.t)
            v_hat = self.v[key] / (1 - self.beta2**self.t)
            params[key] -= self.lr * m_hat / (np.sqrt(v_hat) + self.eps)
```

### Training Configuration

| Parameter | Value |
|-----------|-------|
| Optimizer | Adam |
| Learning Rate | 0.001 (with cosine decay) |
| Batch Size | 32 |
| Epochs | 31 |
| Loss Function | Categorical Cross-Entropy |
| Weight Initialization | Xavier/Glorot uniform |
| Dropout Rate | 0.3 |

### Training Results

#### Epoch-by-Epoch Progress

| Epoch | Train Loss | Train Acc | Val Acc | LR |
|-------|-----------|-----------|---------|-----|
| 1 | 2.596 | 22.2% | 18.5% | 0.00100 |
| 5 | 0.990 | 79.2% | 70.9% | 0.00099 |
| 10 | 0.449 | 92.2% | 82.7% | 0.00097 |
| 15 | 0.215 | 98.5% | 85.7% | 0.00094 |
| 20 | 0.115 | 99.8% | 87.3% | 0.00090 |
| 25 | 0.065 | 100.0% | 88.1% | 0.00085 |
| 31 | 0.034 | 100.0% | 87.7% | 0.00077 |

#### Key Observations

- Training accuracy reaches 100% by epoch 25 (model memorizes training data)
- Validation accuracy plateaus around 88% (generalization gap)
- No severe overfitting due to dropout regularization
- Cosine decay smoothly reduces learning rate

## Evaluation Results

### Overall Metrics

| Metric | Value |
|--------|-------|
| Test Samples | 475 |
| Overall Accuracy | 89.1% |
| Macro Precision | 89.5% |
| Macro Recall | 88.4% |
| Macro F1 | 88.5% |
| Weighted F1 | 89.2% |

### Per-Class Results

| Category | Precision | Recall | F1 | Support | Notes |
|----------|-----------|--------|-----|---------|-------|
| EMAIL | 97.6% | 97.6% | 97.6% | 41 | Excellent - clear patterns |
| PHONE | 100.0% | 65.6% | 79.2% | 32 | High precision, lower recall |
| NAME | 96.4% | 96.4% | 96.4% | 28 | Excellent - distinct format |
| ADDRESS | 97.2% | 97.2% | 97.2% | 36 | Excellent - street+zip pattern |
| PASSWORD | 85.3% | 87.9% | 86.6% | 33 | Good - context-dependent |
| USERNAME | 95.8% | 85.2% | 90.2% | 27 | Good precision |
| CREDIT_CARD | 73.0% | 79.4% | 76.1% | 34 | Moderate - some false positives |
| BANK_ACCOUNT | 75.0% | 75.0% | 75.0% | 24 | Moderate - similar to phone numbers |
| API_KEY | 81.6% | 100.0% | 89.9% | 31 | Perfect recall |
| AUTH_TOKEN | 100.0% | 100.0% | 100.0% | 29 | Perfect - distinctive patterns |
| GOVERNMENT_ID | 48.5% | 61.5% | 54.2% | 26 | Weakest - overlaps with phone/account |
| MEDICAL_ID | 100.0% | 80.0% | 88.9% | 35 | Perfect precision |
| FINANCIAL_DATA | 100.0% | 100.0% | 100.0% | 34 | Perfect - currency format is clear |
| DATE_OF_BIRTH | 95.0% | 100.0% | 97.4% | 38 | Excellent - date format |
| NONE | 96.4% | 100.0% | 98.2% | 27 | Excellent - catches non-PII |

### Confusion Analysis

The main confusion pairs are:
- **SSN <-> Phone/Account numbers**: 9-digit numbers are ambiguous
- **Credit Card <-> Bank Account**: Similar numeric formats
- **Medical ID <-> Generic IDs**: Overlapping prefix patterns

### Model Strengths

1. Perfect detection for AUTH_TOKEN, FINANCIAL_DATA
2. Near-perfect for EMAIL, NAME, ADDRESS, DATE_OF_BIRTH
3. High precision for MEDICAL_ID (no false positives)
4. Fast inference (~1-2 ms per sample)

### Model Weaknesses

1. GOVERNMENT_ID has low precision (48.5%) due to overlap with phone/account numbers
2. Phone detection recall is only 65.6% (some formats missed)
3. Credit card false positives from similar numeric patterns
4. Struggles with short, ambiguous text

## Model Size and Performance

### File Sizes

| File | Format | Size |
|------|--------|------|
| model weights | NumPy (.npz) | ~450 KB |
| ONNX export | ONNX | ~450 KB |
| Tokenizer vocab | JSON | ~2 KB |
| Total | - | ~452 KB |

### Inference Performance

| Platform | Time per Sample | Throughput |
|----------|----------------|------------|
| Chrome (Desktop) | ~1.2 ms | ~830 samples/sec |
| Chrome (Mobile) | ~3.5 ms | ~285 samples/sec |
| Node.js | ~0.8 ms | ~1,250 samples/sec |

### Memory Footprint

| Component | Memory |
|-----------|--------|
| Model weights | ~1.8 MB (in memory) |
| Tokenizer | ~50 KB |
| Input buffer | ~8 KB |
| Total | ~1.9 MB |

## Integration with Browser

### Loading the Model

```javascript
// In ml-engine.js
async function loadModel() {
  const modelUrl = chrome.runtime.getURL('model/pii_classifier.onnx');
  const response = await fetch(modelUrl);
  const buffer = await response.arrayBuffer();
  // Load weights into NumPy-style arrays
  return deserializeModel(buffer);
}
```

### Classification Flow

```
Input Text
    |
    v
Tokenize -> [128, 0, 0, ...]  (character indices)
    |
    v
Embedding Lookup -> [[0.12, -0.34, ...], ...]  (128 x 64)
    |
    v
Global Average Pooling -> [0.05, -0.02, ...]  (64,)
    |
    v
Dense(64->256) + ReLU -> [0.0, 1.2, 0.0, ...]  (256,)
    |
    v
Dropout (inference: no-op)
    |
    v
Dense(256->15) + Softmax -> [0.01, 0.89, 0.02, ...]  (15,)
    |
    v
argmax -> Predicted Category (e.g., EMAIL)
```

### Fallback Strategy

The ML classifier is used as a fallback when regex detection does not find a match:

1. Run regex detection on input text
2. If regex finds entities -> use those
3. If regex finds nothing -> run ML classifier
4. If ML classifier has confidence > 0.7 -> add as detected entity
5. Combine regex + ML results for final output

This hybrid approach achieves 89.1% accuracy vs ~72% for regex-only, while keeping the performance overhead minimal since ML is only invoked when needed.
