# Privacy Vision Agent

### On-device Visual Perception for Light-weight Browser Agents

**SIH 2026** | Smart India Hackathon

---

## Problem Statement

**On-device Visual Perception for Light-weight Browser Agents**

Build a browser extension that allows AI agents to understand web pages while preventing sensitive information exposure. The system must perform all PII detection, risk classification, and data redaction locally on the user's device, ensuring that raw personal data never leaves the browser.

## Motivation

AI-powered browser agents are transforming how users interact with the web, automating form filling, data extraction, and task completion. However, these agents face a fundamental privacy challenge:

- **Screenshots and DOM data contain sensitive PII** - names, emails, phone numbers, credit cards, passwords, government IDs, and medical records
- **Cloud-based AI models should never see raw personal data** - forwarding PII to external APIs violates privacy regulations (GDPR, HIPAA, CCPA)
- **On-device processing is the only safe approach** - all detection, classification, and redaction must happen locally before any data reaches an external agent

Privacy Vision Agent solves this by creating a **privacy firewall** between the browser and AI agents, ensuring agents receive only sanitized, privacy-safe context.

## Architecture

```
+-----------------------------------------------------------------------------------+
|                                    Browser Page                                    |
+-----------------------------------------------------------------------------------+
         |                              |
         v                              v
+------------------+     +------------------------+
|   DOM Parser     |     |  Screenshot Capture    |
| (form fields,    |     |  (visible tab image)   |
|  text, structure) |     |                        |
+------------------+     +------------------------+
         |                              |
         v                              v
+------------------+     +------------------------+
|  DOM Extraction  |     |   OCR Engine           |
|  (element info,  |     |   (Tesseract.js)       |
|  form values,    |     |                        |
|  visible text)   |     |                        |
+------------------+     +------------------------+
         |                              |
         +----------+  +----------------+
                    |  |
                    v  v
         +-------------------------+
         |   Local Perception Layer |
         |                          |
         |  +--------------------+  |
         |  |  PII Text Detector |  |
         |  |  (Regex patterns)  |  |
         |  +--------------------+  |
         |  +--------------------+  |
         |  |  ML Classifier     |  |
         |  |  (NumPy, 88% acc)  |  |
         |  +--------------------+  |
         |  +--------------------+  |
         |  |  Page Classifier   |  |
         |  |  (Context aware)   |  |
         |  +--------------------+  |
         +-------------------------+
                    |
                    v
         +-------------------------+
         |   Entity Detection       |
         |   (15 PII categories)    |
         +-------------------------+
                    |
                    v
         +-------------------------+
         |   Risk Classification    |
         |   (Multi-signal scoring) |
         +-------------------------+
                    |
                    v
         +-------------------------+
         |   Privacy Firewall       |
         |   (Outbound inspection)  |
         +-------------------------+
                    |
                    v
         +-------------------------+
         |   Sanitized Context      |
         |   (Safe for agents)      |
         +-------------------------+
                    |
                    v
         +-------------------------+
         |    Browser Agent         |
         |    (Receives safe data)  |
         +-------------------------+
```

## System Workflow

1. **Page Load Detection**: The content script injects into every page and monitors DOM changes via `MutationObserver`
2. **DOM Extraction**: All interactive elements (inputs, buttons, links), form fields, and visible text are extracted with bounding boxes
3. **Page Classification**: The page is classified into one of 15 types (banking, login, healthcare, etc.) based on URL patterns, DOM signals, and text keywords
4. **PII Detection**:
   - **Regex patterns** scan all visible text and form values for 15 PII categories
   - **DOM context** boosts confidence when field names/labels match PII types (e.g., `type="email"` boosts email detection)
   - **ML classifier** (NumPy-based) catches edge cases that regex misses
5. **Risk Scoring**: Each detected entity receives a risk score from 0 to 1 based on 5 weighted signals
6. **Redaction**: Entities above the risk threshold are redacted using methods appropriate to their type (mask, tokenize, replace)
7. **Privacy Firewall**: The sanitized context is checked for any remaining sensitive data before being exposed to the agent
8. **Agent receives safe context**: Only redacted text, safe element descriptions, and sanitized form fields are available to the AI agent

## ML Architecture

### PII Text Classifier

| Property | Value |
|----------|-------|
| Implementation | Pure NumPy (no TensorFlow/PyTorch) |
| Architecture | Embedding -> GlobalAveragePooling -> Dense(256, ReLU) -> Dropout(0.3) -> Dense(15, Softmax) |
| Vocabulary | Character-level + word-level tokenization |
| Model Size | ~450 KB (ONNX export) |
| Accuracy | 89.1% on test set (475 samples) |
| Training Epochs | 31 |
| Optimizer | Adam (from scratch) |

### Hybrid Detection Strategy

The system uses a three-tier detection approach:

1. **Regex Layer** (fastest): Pattern-based detection for well-structured PII (emails, credit cards, SSNs)
2. **DOM Context Layer** (accurate): Boosts regex results when DOM elements provide contextual confirmation
3. **ML Classifier Layer** (comprehensive): Catches ambiguous cases that regex alone would miss

## Dataset Generation

### Synthetic Data Pipeline

- **4,800+ training samples** generated programmatically
- **Zero real PII used** - all data is synthetically generated
- **15 PII categories** with balanced class distribution

### PII Categories

| Category | Examples | Risk Level |
|----------|----------|------------|
| EMAIL | user@example.com | HIGH |
| PHONE | +1 (555) 123-4567 | HIGH |
| NAME | John Smith | MEDIUM |
| ADDRESS | 123 Main St, City, ST 12345 | MEDIUM |
| PASSWORD | s3cur3P@ss! | CRITICAL |
| USERNAME | john_smith | MEDIUM |
| CREDIT_CARD | 4111 1111 1111 1111 | CRITICAL |
| BANK_ACCOUNT | 1234567890123456 | HIGH |
| API_KEY | sk_live_abc123... | CRITICAL |
| AUTH_TOKEN | eyJhbGciOi... | CRITICAL |
| DATE_OF_BIRTH | 01/15/1990 | MEDIUM |
| GOVERNMENT_ID | 123-45-6789 | HIGH |
| MEDICAL_ID | MRN-12345678 | HIGH |
| FINANCIAL_DATA | $1,234.56 | HIGH |
| PRIVATE_DOCUMENT_CONTENT | (document text) | MEDIUM |

## Training

### Implementation Details

- **Language**: Python (pure NumPy, no ML frameworks)
- **Tokenization**: Character n-grams + word-level tokens
- **Embedding**: Learned character embeddings (64-dimensional)
- **Architecture**:
  - Embedding layer: vocab_size x 64
  - Global Average Pooling
  - Dense(256) with ReLU + Dropout(0.3)
  - Dense(15) with Softmax
- **Loss**: Categorical cross-entropy
- **Optimizer**: Adam with custom implementation
- **Learning rate**: 0.001 with cosine decay

### Training Results

| Metric | Value |
|--------|-------|
| Final Train Accuracy | 100.0% |
| Final Validation Accuracy | 88.1% |
| Best Validation Accuracy | 88.1% (Epoch 25-29) |
| Final Loss | 0.034 |
| Training Time | ~2 minutes (CPU) |

## Browser Deployment

### Chrome Extension (Manifest V3)

```
extension/
  manifest.json          # Chrome Extension Manifest V3
  background.js          # Service worker (screenshot, OCR, firewall, settings)
  content.js             # Content script (DOM extraction, PII detection, overlays)
  popup.html/js/css      # Extension popup UI
  model/                 # ML model files (ONNX format)
  icons/                 # Extension icons
```

### Content Security Policy

```
script-src 'self'; object-src 'self'
```

All scripts run from the extension bundle. No external resources are loaded at runtime.

### Local Model Loading

The ML model is bundled with the extension and loaded via `chrome.runtime.getURL()`. No model data is ever sent to external servers.

## Privacy Guarantees

1. **Original data never leaves the browser** - All detection and redaction happen in the content script
2. **All detection is on-device** - No API calls for PII detection
3. **Privacy firewall blocks unredacted data** - Outbound payloads are scanned before transmission
4. **Audit logging** - All firewall actions are logged locally for transparency
5. **No telemetry** - The extension does not phone home or collect usage data
6. **CSP enforced** - Only self-hosted scripts are allowed to run
7. **Sensitive data redacted in logs** - Passwords, tokens, and keys are masked in audit logs

## Threat Model

### Attacks Mitigated

| Attack | Mitigation |
|--------|-----------|
| PII leakage to AI agent | Sanitized context before agent access |
| Screenshot contains PII | Visual redaction overlays |
| Form data sent to cloud | DOM redaction + firewall |
| Outbound API contains PII | WebRequest monitoring + pattern detection |
| Malicious extension scripts | CSP + Manifest V3 restrictions |
| Cross-origin data theft | Host permissions limited to active tab |

### Known Limitations

- OCR accuracy depends on Tesseract.js loading time (~2-5 seconds first run)
- Visual-only PII (text in images, not in DOM) requires OCR which may miss some fonts
- ML classifier has 88% accuracy; some edge cases may be missed
- No support for handwritten text detection
- Dynamic SPAs may require re-scanning after route changes

## Testing

### Test Categories

| Type | Location | Framework | Purpose |
|------|----------|-----------|---------|
| Unit | `tests/unit/` | Vitest | Individual component testing |
| Integration | `tests/integration/` | Vitest | Module interaction testing |
| Security | `tests/security/` | Vitest | Attack scenario testing |
| Browser | `tests/browser/` | Playwright | E2E extension testing |

### Running Tests

```bash
# Unit tests
npm test

# Unit tests with coverage
npm run test:coverage

# Browser tests
npm run test:browser

# All tests
npx vitest run && npx playwright test
```

## Benchmark Results

### Detection Accuracy (475 test samples)

| Method | Accuracy | Precision | Recall | F1 |
|--------|----------|-----------|--------|-----|
| Regex-Only | ~72% | ~75% | ~68% | ~69% |
| DOM-Context-Enhanced | ~82% | ~84% | ~78% | ~79% |
| Full Pipeline | ~89% | ~89% | ~88% | ~88% |

### Latency

| Operation | Time |
|-----------|------|
| DOM extraction | ~15-30 ms |
| Regex PII detection | ~2-5 ms per sample |
| OCR (Tesseract.js) | ~2-5 seconds (first load) |
| ML classification | ~1-2 ms per sample |
| Risk scoring | ~1 ms per entity |
| Total scan (DOM only) | ~50-100 ms |
| Total scan (with OCR) | ~3-6 seconds |

### Memory Usage

| Component | Memory |
|-----------|--------|
| Extension baseline | ~15 MB |
| ML model loaded | ~5 MB |
| Tesseract.js loaded | ~30 MB |
| Peak during scan | ~50 MB |

## Installation

### Prerequisites

- Google Chrome (version 110 or later)
- Node.js 18+ (for development)

### Step-by-Step

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/privacy-vision-agent.git
   cd privacy-vision-agent
   ```

2. **Install dependencies** (for development/testing only)
   ```bash
   npm install
   ```

3. **Load the extension in Chrome**
   - Open `chrome://extensions/`
   - Enable "Developer mode" (top right toggle)
   - Click "Load unpacked"
   - Select the `extension/` directory
   - The extension icon appears in the toolbar

4. **Start the test server** (for demo)
   ```bash
   npm run serve:test-sites
   ```

5. **Navigate to test pages**
   - Open `http://localhost:3000/` in Chrome
   - Browse the various test pages (banking, login, healthcare, etc.)

6. **Click the extension icon**
   - The popup shows the current page analysis
   - Click "Scan Page" to run detection

7. **View results**
   - Detected PII is highlighted with color-coded overlays
   - Red = CRITICAL, Orange = HIGH, Yellow = MEDIUM, Blue = LOW
   - The popup shows detailed entity list with risk levels

## Usage

### Scanning a Page

1. Navigate to any webpage
2. Click the Privacy Vision Agent icon in the toolbar
3. Click **"Scan Page"** in the popup
4. View detected PII highlighted on the page
5. Review the sanitized context in the popup

### Viewing the Audit Log

1. Click the extension icon
2. Click **"Audit Log"** at the bottom of the popup
3. Review all firewall actions and scan history

### Configuring Settings

1. Right-click the extension icon -> "Options"
2. Toggle detection methods (OCR, DOM, Vision)
3. Set risk threshold for auto-redaction
4. Enable/disable audit logging

## Demo Instructions (SIH Presentation)

### Prerequisites

- Chrome browser with extension loaded
- Test server running (`npm run serve:test-sites`)
- Test pages at `http://localhost:3000/`

### Demo Flow

**Step 1: Introduction (30 seconds)**
- Show the extension popup on a blank page
- Explain: "This is Privacy Vision Agent, an on-device PII detection system for browser agents"

**Step 2: Banking Page Demo (1 minute)**
- Navigate to `http://localhost:3000/banking.html`
- Click "Scan Page"
- Show detected: account numbers, routing numbers, names, addresses
- Point out color-coded risk levels
- Show the sanitized context that would be sent to an AI agent

**Step 3: Login Page Demo (1 minute)**
- Navigate to `http://localhost:3000/login.html`
- Click "Scan Page"
- Show password field detection (CRITICAL risk)
- Show email detection
- Demonstrate the overlay highlighting

**Step 4: Healthcare Page Demo (1 minute)**
- Navigate to `http://localhost:3000/healthcare.html`
- Show medical record numbers, patient names, dates of birth
- Explain HIPAA compliance implications

**Step 5: Architecture Overview (1 minute)**
- Show the pipeline diagram
- Explain: DOM extraction -> PII detection -> Risk scoring -> Redaction -> Firewall
- Emphasize: all processing happens on-device

**Step 6: Benchmark Results (30 seconds)**
- Show the comparison table
- Highlight the improvement from regex-only to full pipeline

## Limitations

1. **OCR Loading Time**: Tesseract.js requires ~2-5 seconds to load the first time; subsequent uses are faster
2. **Vision Model Not Yet Integrated**: The architecture supports a future vision model for screenshot-based PII detection, but it is not yet implemented
3. **Edge Cases**: Some PII formats (international phone numbers, non-Latin scripts) may not be fully covered
4. **Dynamic Content**: Single-page applications may require manual re-scan after navigation
5. **Performance**: Heavy pages with many DOM elements may slow down the extraction step
6. **Accuracy**: The ML classifier achieves 88% accuracy; it is a complement to, not a replacement for, regex detection

## Future Improvements

- **WebGPU Acceleration**: Offload ML inference to GPU for faster classification
- **On-Device Object Detection**: YOLO-based model for detecting PII in screenshots (names on ID cards, etc.)
- **Multi-Language Support**: Extend regex patterns and training data for Hindi, Tamil, and other Indian languages
- **Firefox/Safari Support**: Adapt the extension for other browsers using the WebExtensions API
- **Federated Learning**: Improve the ML model across users without sharing raw data
- **Real-Time Scanning**: Continuous monitoring instead of manual scan trigger
- **Custom Rules**: Allow users to define their own PII patterns
- **Export Reports**: Generate downloadable privacy audit reports

## Project Structure

```
privacy-vision-agent/
  extension/               # Chrome extension
    background.js          # Service worker
    content.js             # Content script (main detection pipeline)
    popup.html/js/css      # Extension popup
    manifest.json          # Extension manifest
    model/                 # ML model files
  ml/                      # Machine learning
    data_generation/       # Synthetic data pipeline
    training/              # Model training
    evaluation/            # Model evaluation
    export/                # ONNX export
  tests/                   # Test suites
    unit/                  # Unit tests
    integration/           # Integration tests
    security/              # Security tests
    browser/               # Browser E2E tests
  benchmark/               # Performance benchmarks
  docs/                    # Documentation
  training/                # Alternative training scripts
  test-sites/              # Demo pages
  scripts/                 # Build utilities
```

## License

MIT License

Copyright (c) 2026 Privacy Vision Agent Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
