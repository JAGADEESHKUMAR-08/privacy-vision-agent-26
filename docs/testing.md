# Testing Documentation

Testing guide for Privacy Vision Agent.

## Test Categories

### 1. Unit Tests

**Location**: `tests/unit/`

Unit tests verify individual functions and modules in isolation.

#### What to Test

| Module | Test Cases | Priority |
|--------|-----------|----------|
| PII Detector | Pattern matching for each category, Luhn check, phone validation, confidence scoring | High |
| Risk Engine | Weight calculations, risk level thresholds, scoring components | High |
| Page Classifier | Classification for each page type, fallback behavior | Medium |
| Redaction Engine | Blur, pixelate, mask, tokenize operations; text replacement | High |
| Privacy Firewall | Pattern detection, domain blocking, action recording | High |
| DOM Extractor | Element extraction, visibility detection, CSS selector generation | Medium |
| ID Generator | Uniqueness, prefix handling | Low |

#### Example Unit Tests

```typescript
// tests/unit/pii-detector.test.ts
import { describe, it, expect } from 'vitest';
import { PIIDetector } from '../../extension/src/privacy/pii-detector';

describe('PIIDetector', () => {
  const detector = new PIIDetector();

  describe('EMAIL detection', () => {
    it('detects standard email addresses', () => {
      const entities = detector.detect('Contact user@example.com for info');
      expect(entities.some(e => e.type === 'EMAIL' && e.value === 'user@example.com')).toBe(true);
    });

    it('excludes test domains', () => {
      const entities = detector.detect('Send to admin@test.com');
      expect(entities.some(e => e.type === 'EMAIL')).toBe(false);
    });

    it('excludes common prefixes', () => {
      const entities = detector.detect('Email noreply@example.com');
      expect(entities.some(e => e.type === 'EMAIL')).toBe(false);
    });
  });

  describe('CREDIT_CARD detection', () => {
    it('detects valid credit card numbers', () => {
      const entities = detector.detect('Card: 4111 1111 1111 1111');
      expect(entities.some(e => e.type === 'CREDIT_CARD')).toBe(true);
    });

    it('rejects invalid Luhn numbers', () => {
      const entities = detector.detect('Card: 1234 5678 9012 3456');
      expect(entities.some(e => e.type === 'CREDIT_CARD')).toBe(false);
    });
  });

  describe('PHONE detection', () => {
    it('detects US phone numbers', () => {
      const entities = detector.detect('Call +1 (555) 123-4567');
      expect(entities.some(e => e.type === 'PHONE')).toBe(true);
    });

    it('rejects too-short numbers', () => {
      const entities = detector.detect('Code: 12345');
      expect(entities.some(e => e.type === 'PHONE')).toBe(false);
    });
  });
});
```

### 2. Integration Tests

**Location**: `tests/integration/`

Integration tests verify that multiple modules work together correctly.

#### What to Test

| Flow | Test Cases | Priority |
|------|-----------|----------|
| Full Scan Pipeline | DOM extraction -> PII detection -> Risk scoring -> Redaction | High |
| Message Passing | Content script <-> Service worker communication | High |
| Settings Persistence | Save/load settings from chrome.storage | Medium |
| Audit Logging | Log events, retrieve log, sanitize data | Medium |
| Firewall End-to-End | Outbound payload -> Pattern check -> Action decision | High |

#### Example Integration Tests

```typescript
// tests/integration/scan-pipeline.test.ts
describe('Scan Pipeline', () => {
  it('completes full scan and returns sanitized context', async () => {
    const orchestrator = new ScanOrchestrator();
    // Mock DOM extraction
    // Mock OCR
    const result = await orchestrator.scanPage();

    expect(result.entities).toBeDefined();
    expect(result.risks).toBeDefined();
    expect(result.sanitizedContext).toBeDefined();
    expect(result.sanitizedContext.safeText).not.toContain('user@example.com');
  });

  it('firewall blocks outbound with sensitive data', () => {
    const firewall = new PrivacyFirewall();
    const action = firewall.checkOutbound({
      type: 'api_call',
      data: { email: 'test@example.com', name: 'John' },
      timestamp: Date.now(),
      source: 'https://evil.com',
    });

    expect(action.type).toBe('REDACT');
    expect(action.detectedFields).toContain('EMAIL');
  });
});
```

### 3. Security Tests

**Location**: `tests/security/`

Security tests verify that attack scenarios are properly mitigated.

#### Attack Scenarios to Test

| Scenario | Test | Expected Result |
|----------|------|-----------------|
| PII in outbound payload | Send payload with email/phone/card | Firewall blocks or redacts |
| Raw PII in audit log | Check log entries after scan | All sensitive values are `[REDACTED]` |
| Password field exposure | Extract form fields from login page | Password values are empty string |
| CSP compliance | Check for eval(), inline scripts | None found |
| Multiple injection | Inject content script twice | Second injection blocked by flag |
| Malicious DOM manipulation | Modify DOM during scan | MutationObserver detects change |

#### Example Security Tests

```typescript
// tests/security/firewall.test.ts
describe('Firewall Security', () => {
  it('blocks outbound containing credit card numbers', () => {
    const firewall = new PrivacyFirewall();
    const action = firewall.checkOutbound({
      type: 'form_submit',
      data: { card: '4111 1111 1111 1111' },
      timestamp: Date.now(),
      source: 'https://example.com',
    });

    expect(action.type).toBe('REDACT');
    expect(action.detectedFields).toContain('CREDIT_CARD');
  });

  it('sanitizes log data before storage', () => {
    const sanitized = sanitizeLogData({
      email: 'user@test.com',
      password: 'secret123',
      normalField: 'safe value',
    });

    expect(sanitized.email).toBe('[REDACTED]');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.normalField).toBe('safe value');
  });

  it('prevents password field value extraction', () => {
    // Simulate login form with password field
    const fields = extractFormFields();
    const passwordField = fields.find(f => f.isPassword);

    if (passwordField) {
      expect(passwordField.value).toBe('');
    }
  });
});
```

### 4. Browser Tests (E2E)

**Location**: `tests/browser/`

Browser tests use Playwright to test the extension in a real Chrome environment.

#### What to Test

| Scenario | Test | Priority |
|----------|------|----------|
| Extension Load | Extension loads without errors | High |
| Basic Scan | Click scan button, verify results appear | High |
| Overlay Display | Verify colored overlays appear on detected PII | High |
| Popup UI | Verify scan results displayed correctly in popup | High |
| Settings | Toggle settings, verify they persist | Medium |
| Audit Log | Perform scan, check log entries | Medium |
| Multiple Pages | Scan different page types | Medium |

#### Example Browser Tests

```typescript
// tests/browser/scan.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Extension Scan', () => {
  test('scans a page and shows results', async ({ page }) => {
    // Navigate to test page
    await page.goto('http://localhost:3000/banking.html');

    // Wait for content script to load
    await page.waitForTimeout(1000);

    // Trigger scan via extension
    const extensionId = 'your-extension-id';
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Click scan button
    await page.click('#scan-button');

    // Wait for results
    await page.waitForSelector('.scan-result', { timeout: 10000 });

    // Verify entities found
    const entityCount = await page.textContent('.entity-count');
    expect(parseInt(entityCount)).toBeGreaterThan(0);
  });

  test('overlays appear on detected PII', async ({ page }) => {
    await page.goto('http://localhost:3000/login.html');
    await page.waitForTimeout(1000);

    // Trigger overlay
    const extensionId = 'your-extension-id';
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.click('#show-overlay-button');

    // Switch back to test page
    await page.bringToFront();

    // Verify overlays exist
    const overlays = await page.$$('.pva-overlay-box');
    expect(overlays.length).toBeGreaterThan(0);
  });
});
```

## How to Run Tests

### Prerequisites

```bash
# Install dependencies
npm install

# Install Playwright browsers (for browser tests)
npx playwright install chromium
```

### Running Unit Tests

```bash
# Run all unit tests
npm test

# Run with file pattern
npx vitest run tests/unit/pii-detector.test.ts

# Run in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

### Running Integration Tests

```bash
# Run integration tests
npx vitest run tests/integration/

# Run specific integration test
npx vitest run tests/integration/scan-pipeline.test.ts
```

### Running Security Tests

```bash
# Run security tests
npx vitest run tests/security/
```

### Running Browser Tests

```bash
# Start test server first
npm run serve:test-sites

# Run browser tests
npm run test:browser

# Run all E2E tests
npm run test:e2e

# Run with UI
npx playwright test --ui
```

### Running All Tests

```bash
# Run everything
npx vitest run && npx playwright test
```

## Test Coverage Goals

| Module | Target Coverage | Current |
|--------|----------------|---------|
| PII Detector | 90% | ~85% |
| Risk Engine | 85% | ~80% |
| Page Classifier | 80% | ~75% |
| Redaction Engine | 85% | ~80% |
| Privacy Firewall | 90% | ~85% |
| Content Script | 70% | ~65% |
| Background Script | 60% | ~55% |
| **Overall** | **80%** | ~75% |

### Coverage Commands

```bash
# Generate coverage report
npm run test:coverage

# View HTML coverage report
open coverage/index.html
```

## Browser Test Setup

### Manual Setup

1. Load the extension in Chrome (`chrome://extensions/` -> Load unpacked -> `extension/`)
2. Note the extension ID from the extensions page
3. Update the extension ID in test files if needed
4. Start the test server: `npm run serve:test-sites`
5. Run Playwright tests: `npm run test:browser`

### Automated Setup (CI)

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx vitest run
      - run: npx playwright install chromium
      - run: npx playwright test
```

### Test Pages

The `test-sites/` directory contains pre-built HTML pages for testing:

| Page | URL | PII Present |
|------|-----|-------------|
| Banking | `/banking.html` | Account numbers, routing numbers, names |
| Login | `/login.html` | Email, password |
| Healthcare | `/healthcare.html` | Medical IDs, patient names, DOB |
| Government | `/government.html` | SSN, Aadhaar, passport numbers |
| E-commerce | `/ecommerce.html` | Credit cards, addresses, emails |
| Profile | `/profile.html` | Name, email, phone, address |

### Test Data

The `ml/data_generation/pii_test.json` file contains 475 labeled test samples across 15 categories. This dataset is used for both ML evaluation and benchmark testing.
