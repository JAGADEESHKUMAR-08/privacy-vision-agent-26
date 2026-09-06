# Demo Script - SIH 2026

Complete walkthrough for presenting Privacy Vision Agent at Smart India Hackathon.

## Prerequisites

### Software Requirements

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Google Chrome | 110+ | Run the extension |
| Node.js | 18+ | Run test server |
| npm | 9+ | Install dependencies |

### Setup Checklist

- [ ] Extension loaded in Chrome (`extension/` directory)
- [ ] Test server running (`npm run serve:test-sites`)
- [ ] Test pages accessible at `http://localhost:3000/`
- [ ] Extension icon visible in Chrome toolbar
- [ ] No other extensions conflicting (disable others if needed)
- [ ] Screen sharing / projector connected
- [ ] Chrome DevTools ready (F12)
- [ ] Benchmark results generated (`npm run benchmark`)

### Pre-Demo Verification

```bash
# 1. Install dependencies (if not already done)
npm install

# 2. Start test server
npm run serve:test-sites

# 3. Open Chrome and load extension
# chrome://extensions/ -> Developer mode -> Load unpacked -> extension/

# 4. Verify extension loads (check console for [PVA Background] log)

# 5. Run benchmark to have fresh results
npm run benchmark
```

## Demo Flow

### Part 1: Introduction (1 minute)

**What to say:**
> "Privacy Vision Agent is an on-device PII detection system for browser agents. It ensures that AI agents can understand web pages without ever seeing raw personal data. All detection, classification, and redaction happen locally in the browser."

**What to show:**
1. Open Chrome with a blank tab
2. Click the Privacy Vision Agent extension icon
3. Show the popup UI (clean state, no scan yet)
4. Point out the "Scan Page" button and settings

**Key points to mention:**
- Built for Smart India Hackathon 2026
- Chrome Extension with Manifest V3
- Pure NumPy ML model (no TensorFlow/PyTorch dependency)
- 15 PII categories detected
- All processing on-device

---

### Part 2: Banking Page Demo (2 minutes)

**Navigate to:** `http://localhost:3000/banking.html`

**What to say:**
> "Let me show you how the system works on a banking page. This page contains account numbers, routing numbers, and customer names."

**Step-by-step:**

1. **Show the page first** (before scanning)
   - "Notice this looks like a normal banking dashboard"
   - "There are account numbers, routing numbers, and names visible"

2. **Click "Scan Page"**
   - Wait for scan to complete (should be under 100ms for DOM-only)
   - "The scan just completed. Let me show you what was detected."

3. **Show the popup results**
   - Point out the entity list with types and confidence scores
   - "We detected 3 bank account numbers, 2 routing numbers, and 4 names"
   - "Each entity has a confidence score and risk level"

4. **Show the overlay**
   - Click "Show Overlay" in the popup
   - Switch back to the banking page
   - "Notice the color-coded highlights on the page"
   - "Red = CRITICAL risk, Orange = HIGH risk, Yellow = MEDIUM"
   - "Each overlay shows the PII type and confidence percentage"

5. **Explain the risk scoring**
   - "The banking page type boosts risk scores because financial data is inherently sensitive"
   - "Our multi-signal risk engine weighs: entity type (30%), detection confidence (25%), DOM context (20%), page type (15%), and semantic context (10%)"

6. **Show sanitized context**
   - In the popup, show the "Safe Text" section
   - "The original text had account numbers. The safe text has them replaced with [BANK_ACCOUNT]"

**Key metrics to mention:**
- Scan time: ~50-80ms (DOM only)
- Entities detected: ~9
- Page type: banking (auto-classified)

---

### Part 3: Login Page Demo (1.5 minutes)

**Navigate to:** `http://localhost:3000/login.html`

**What to say:**
> "Now let's look at a login page. This is where passwords and email addresses are entered."

**Step-by-step:**

1. **Show the page**
   - "This is a typical login form with email and password fields"

2. **Fill in some test data** (if form is empty)
   - Enter a test email: `john@example.com`
   - Enter a test password: `MySecurePass123!`
   - "I'm entering some test credentials"

3. **Click "Scan Page"**
   - "Now let's scan this page"

4. **Show results**
   - "The email was detected with 90% confidence"
   - "The password field was detected as CRITICAL risk"
   - "Notice the DOM context boosted the password confidence to 95% because we detected a `type='password'` field"

5. **Show the overlay on password field**
   - The password field should have a red CRITICAL overlay
   - "This red overlay indicates a CRITICAL risk credential"

6. **Explain DOM context enhancement**
   - "Without DOM context, passwords are hard to detect from text alone"
   - "But because we see a `type='password'` input field, we boost the confidence significantly"
   - "This is the power of our hybrid detection approach"

**Key point:** DOM context is crucial for password detection.

---

### Part 4: Healthcare Page Demo (1.5 minutes)

**Navigate to:** `http://localhost:3000/healthcare.html`

**What to say:**
> "Healthcare data is protected under HIPAA regulations. Let's see how our system handles medical records."

**Step-by-step:**

1. **Show the page**
   - "This page shows patient information including medical record numbers, dates of birth, and diagnoses"

2. **Click "Scan Page"**

3. **Show results**
   - "We detected medical record numbers (MRN) with 88% confidence"
   - "Patient names are detected as MEDIUM risk"
   - "Dates of birth are detected as MEDIUM risk"
   - "The healthcare page type boosted medical field confidence"

4. **Explain medical ID detection**
   - "Medical IDs follow patterns like MRN-XXXXXXX or HC-XXXXXXX"
   - "Our regex patterns catch these formats"
   - "The DOM context (medical field labels) adds 10% confidence boost"

5. **Mention HIPAA compliance**
   - "In a real deployment, this data would be redacted before any AI agent sees it"
   - "The sanitized context would replace all medical IDs with [MEDICAL_ID_REDACTED]"

---

### Part 5: Architecture Overview (1 minute)

**What to show:** Display the architecture diagram (from README or slides)

**What to say:**
> "Let me walk you through the architecture."

**Key points:**

1. **Input Layer**
   - DOM Parser extracts form fields, buttons, links, and visible text
   - Screenshot Capture gets the visual representation
   - OCR Engine (Tesseract.js) extracts text from screenshots

2. **Perception Layer**
   - PII Text Detector uses 50+ regex patterns for 15 categories
   - ML Classifier (NumPy, 88% accuracy) catches edge cases
   - Page Classifier determines context (banking, healthcare, etc.)

3. **Risk Layer**
   - Multi-signal scoring with 5 weighted components
   - Entity sensitivity, detection confidence, DOM context, page type, semantic analysis

4. **Protection Layer**
   - Redaction Engine applies appropriate methods per category
   - Privacy Firewall inspects all outbound data
   - Sanitized Context is the only output available to agents

5. **Key differentiator**
   - Everything runs on-device
   - No data leaves the browser
   - Zero network calls for PII detection

---

### Part 6: Benchmark Results (1 minute)

**What to show:** The benchmark comparison table

**What to say:**
> "We benchmarked three detection approaches on 475 test samples."

**Key results to highlight:**

| Metric | Regex-Only | DOM-Enhanced | Full Pipeline |
|--------|-----------|--------------|---------------|
| Accuracy | ~72% | ~82% | ~89% |
| F1 Score | ~69% | ~79% | ~88% |

**Analysis points:**
1. "Regex alone misses context-dependent PII like passwords and usernames"
2. "DOM context boosts accuracy by ~10% for context-sensitive categories"
3. "The ML classifier catches another ~7% of edge cases"
4. "All methods run in under 5 microseconds per sample"
5. "The full pipeline achieves near-production accuracy with zero cloud dependency"

---

### Part 7: Q&A Preparation

#### Anticipated Questions and Answers

**Q: How does this compare to cloud-based PII detection?**
> "Cloud services like Google DLP or AWS Comprehend can detect PII, but they require sending data to external servers. Our system achieves 89% accuracy entirely on-device, with zero data leaving the browser. For privacy-sensitive applications, this is a fundamental advantage."

**Q: What about false positives?**
> "Our regex patterns are conservative by design. For example, we validate credit cards with the Luhn algorithm, and we exclude common email domains like test.com. The ML classifier adds another layer of validation. In our benchmarks, precision is around 89%, meaning 89% of detected entities are actual PII."

**Q: Can this be bypassed?**
> "The extension uses Chrome's Manifest V3 security model, which enforces Content Security Policy, limits host permissions, and prevents remote code execution. A compromised webpage cannot disable or bypass the extension's detection. However, if Chrome itself is compromised, all browser security guarantees are void."

**Q: What about international PII formats?**
> "Current patterns cover US formats (SSN, phone, addresses) and common international formats (emails, credit cards). We plan to add support for Indian formats (Aadhaar, PAN) and other international standards in future iterations."

**Q: How much does it slow down the browser?**
> "DOM-only scanning takes 50-100ms, which is imperceptible to users. The OCR step (Tesseract.js) takes 2-5 seconds on first load, but subsequent scans are faster. The ML classifier adds only 1-2ms per sample."

**Q: Is this production-ready?**
> "This is a prototype for SIH 2026. The architecture is production-grade, but we'd need additional work on edge cases, multi-language support, and performance optimization for a production deployment."

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Extension icon not showing | Reload extension from `chrome://extensions/` |
| "Service worker" not starting | Check background.js console for errors |
| Test server not responding | Run `npm run serve:test-sites` and check port 3000 |
| Scan returns 0 entities | Ensure the page has loaded completely; check DOM extraction |
| Overlay not appearing | Click "Show Overlay" after scanning; check for z-index conflicts |
| Benchmark fails | Ensure Node.js 18+ is installed; check `ml/data_generation/pii_test.json` exists |

### Console Logs to Check

```
[PVA Background] Extension installed. Version: 1.0.0
[PVA Background] Service worker v1.0.0 initialized.
[Privacy Vision Agent] Content script v1.0.0 loaded on localhost
```

If you see these logs, the extension is working correctly.

### Performance Tips for Demo

1. Close unnecessary Chrome tabs before demo
2. Use a fresh Chrome profile to avoid extension conflicts
3. Pre-warm the test server before presenting
4. Run the benchmark once before the demo to ensure results are fresh
5. Have the architecture diagram open in a separate tab for quick reference

## Demo Checklist (Day-Of)

- [ ] Laptop charged / power connected
- [ ] Chrome open with extension loaded
- [ ] Test server running on port 3000
- [ ] All 6 test pages bookmarked
- [ ] Architecture diagram ready
- [ ] Benchmark results file ready
- [ ] Slide deck (if applicable) loaded
- [ ] Timer set for 10-minute presentation
- [ ] Backup USB with project files
- [ ] Water bottle (staying hydrated matters)
