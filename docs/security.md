# Security Documentation

Privacy Vision Agent security analysis and threat model.

## Threat Model (STRIDE)

### Spoofing

| Threat | Risk | Mitigation |
|--------|------|-----------|
| Malicious page impersonates trusted domain | Medium | Trusted domain list reduces false positives; page classification provides context |
| Injected content script masquerades as PVA | Low | Extension isolation prevents content script impersonation; CSP enforces script origin |
| Fake scan results shown to user | Low | All scan results are generated internally; no external input trusted |

### Tampering

| Threat | Risk | Mitigation |
|--------|------|-----------|
| Page DOM modified after extraction | Medium | MutationObserver detects changes; re-scan available on demand |
| Model file corrupted on disk | Low | Extension integrity verified by Chrome; model loaded from bundled resources only |
| Audit log entries modified | Low | Storage is local and access-controlled by Chrome extension APIs |
| Settings tampered via storage API | Low | Settings validated on load; defaults applied for missing/invalid values |

### Repudiation

| Threat | Risk | Mitigation |
|--------|------|-----------|
| User denies scan was performed | Low | Audit log records all scan events with timestamps |
| Firewall action not recorded | Medium | All firewall actions logged with detected field details |
| No proof of data redaction | Medium | Redaction counts and methods recorded in scan results |

### Information Disclosure

| Threat | Risk | Mitigation |
|--------|------|-----------|
| PII sent to AI agent without redaction | **High** | Privacy firewall inspects all outbound payloads; redaction threshold enforced |
| Screenshot contains visible PII | **High** | Visual overlays highlight detected PII; screenshot redaction available |
| PII leaked via DOM to external scripts | **High** | CSP blocks external scripts; content script isolation prevents access |
| Audit log contains raw PII | **High** | Log data is sanitized before storage (sensitive values replaced with `[REDACTED]`) |
| OCR text sent to external service | **High** | OCR runs entirely locally via Tesseract.js; no network requests |

### Denial of Service

| Threat | Risk | Mitigation |
|--------|------|-----------|
| Heavy page slows DOM extraction | Medium | Extraction is bounded by element count; performance monitoring in place |
| Large screenshot causes OOM | Low | Screenshot limited to visible viewport; canvas operations are bounded |
| Scan cooldown prevents re-scanning | Low | 2-second cooldown between scans is configurable |

### Elevation of Privilege

| Threat | Risk | Mitigation |
|--------|------|-----------|
| Malicious page triggers agent actions | Medium | Agent actions require explicit user initiation via popup |
| Content script accesses privileged APIs | Low | Content scripts have no access to Chrome APIs beyond messaging |
| Background worker grants elevated permissions | Low | Permissions limited to `activeTab`, `storage`, `scripting`, `tabs` |

## Attack Vectors and Mitigations

### 1. PII Leakage to External AI Agent

**Attack**: A browser agent (e.g., ChatGPT extension, custom automation) requests page data, including raw PII.

**Mitigation**:
- The `SanitizedContext` replaces all detected PII with type labels (`[EMAIL_REDACTED]`, etc.)
- Form field values are stripped from `SafeFormField` objects
- The firewall blocks outbound payloads containing sensitive patterns
- Risk threshold determines minimum redaction level

**Effectiveness**: High - blocks known PII patterns; unknown patterns still risky.

### 2. Screenshot-Based PII Exposure

**Attack**: A screenshot of the page is sent to an external vision model, exposing visible PII.

**Mitigation**:
- Redaction overlays are drawn on the screenshot before transmission
- Overlay colors and positions match detected entity bounding boxes
- Multiple redaction methods available: blur, pixelate, mask, replace, tokenize

**Effectiveness**: Medium - effective for DOM-located PII; less effective for PII rendered in images or canvas elements.

### 3. DOM Scraping by Third-Party Scripts

**Attack**: A malicious script on the page reads form values or visible text containing PII.

**Mitigation**:
- Content Security Policy blocks external script execution
- Manifest V3 restricts remote code execution
- Content script runs in an isolated world (cannot be accessed by page scripts)
- Form values for password fields are never exposed to the DOM

**Effectiveness**: High - CSP + extension isolation provide strong protection.

### 4. Outbound Data Exfiltration

**Attack**: The page makes an HTTP request containing PII in headers, body, or URL parameters.

**Mitigation**:
- Background service worker monitors `chrome.webRequest.onBeforeSendHeaders`
- All request headers are scanned against 8 sensitive patterns
- Detected PII triggers a BLOCK action and audit log entry
- Blocked domains and paths are configurable

**Effectiveness**: Medium-High - header scanning is effective; body scanning is limited in Manifest V3.

### 5. Model Theft or Tampering

**Attack**: An attacker modifies the ML model file to reduce detection accuracy.

**Mitigation**:
- Model is bundled with the extension in `model/` directory
- Chrome extension integrity verification prevents post-install modification
- No auto-update mechanism for individual files (full extension updates only)
- Model loaded via `chrome.runtime.getURL()` which enforces origin checks

**Effectiveness**: High - extension integrity is maintained by Chrome.

## Data Flow Security

### Inbound Data (Page -> Extension)

```
Page DOM -----> extractDOMElements() ----> PII Detection
               |                            |
               |  Read-only access          | Pattern matching
               |  No mutation of source     | No network calls
               v                            v
         DOMElementInfo[]            DetectedEntity[]
```

**Security properties**:
- Read-only access to page DOM
- No modification of page content during extraction
- Extracted data stays in extension's isolated JavaScript context

### Internal Processing (Within Extension)

```
DetectedEntity[] --> RiskEngine --> RiskScore[]
                              |
                              v
                    RedactionEngine --> RedactionAction[]
                              |
                              v
                    PrivacyFirewall --> SanitizedContext
```

**Security properties**:
- All processing is synchronous (except OCR) and local
- No intermediate data leaves the extension
- Memory is garbage collected after processing

### Outbound Data (Extension -> Agent/Storage)

```
SanitizedContext ----> Agent Interface ----> Browser Agent
                     |
                     +----> Audit Log (local storage)
```

**Security properties**:
- `SanitizedContext` contains only redacted values
- Audit log is stored in `chrome.storage.local` (device-local only)
- No network requests for data transmission
- Firewall provides additional check before any external exposure

## Privacy Guarantees

### What We Guarantee

1. **No network calls for PII detection** - All regex, DOM, and ML processing is local
2. **No raw PII in audit logs** - Sensitive values are replaced with `[REDACTED]` before logging
3. **No raw PII in agent context** - Only sanitized/redacted data reaches the agent interface
4. **No telemetry** - The extension does not report usage data to any external server
5. **No persistent PII storage** - Detected entities are held in memory during scan only; not persisted
6. **Local-only model inference** - ML model runs in the browser; weights never leave the device

### What We Do NOT Guarantee

1. **Zero false negatives** - The ML classifier has 88% accuracy; some PII may be missed
2. **Image-based PII detection** - PII rendered in images (not DOM) requires OCR, which has limitations
3. **Real-time streaming protection** - Detection runs on-demand scan, not continuous monitoring
4. **Protection against browser-level compromise** - If Chrome itself is compromised, all bets are off
5. **Protection against user voluntarily sharing PII** - The system protects against automated leakage, not intentional sharing

## Outbound Inspection Details

### Patterns Scanned

The firewall checks outbound payloads against these patterns:

| Pattern | Label | Regex |
|---------|-------|-------|
| Email | EMAIL | `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b` |
| Credit Card | CREDIT_CARD | `\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b` |
| SSN | SSN | `\b\d{3}-?\d{2}-?\d{4}\b` |
| API Key | API_KEY | `\b[A-Za-z0-9]{32,}\b` |
| Auth Token | AUTH_TOKEN | `Bearer\s+[A-Za-z0-9_\-\.]+` |
| Password | PASSWORD | `\b(?:password\|passwd\|pwd)\s*[:=]\s*\S+` |
| JWT | JWT | `\beyJ...\b` |
| Gov ID | POSSIBLE_GOV_ID | `\b\d{12}\b` |

### Inspection Points

1. **Request Headers** - `chrome.webRequest.onBeforeSendHeaders` monitors all outgoing HTTP headers
2. **Payload Check** - Explicit `FIREWALL_CHECK` message for agent-initiated outbound data
3. **Domain Blocklist** - Configurable list of blocked domains
4. **Path Blocklist** - Regex patterns for blocked URL paths

### Actions Taken

| Action | When | Effect |
|--------|------|--------|
| `ALLOW` | No sensitive data detected | Request proceeds normally |
| `REDACT` | Sensitive fields found in payload | Logged; payload flagged for review |
| `BLOCK` | Domain/path is blocked or contains critical PII | Request blocked; logged as security event |
| `WARN` | Entities detected but not redacted | Logged as warning for user awareness |

## Known Limitations

1. **Manifest V3 webRequest restrictions**: Cannot inspect request bodies in MV3 (only headers)
2. **OCR accuracy**: Tesseract.js may misread low-resolution or stylized text
3. **Cross-frame content**: Content script runs in all frames but may miss cross-origin iframes
4. **Dynamic SPA content**: Content loaded via AJAX after initial page load requires re-scan
5. **Canvas-rendered PII**: Text rendered to `<canvas>` elements is not accessible via DOM extraction
6. **PDF content**: PDF files opened in the browser have limited DOM accessibility
7. **Performance on large pages**: Pages with 10,000+ DOM elements may slow extraction

## Security Testing Approach

### Unit Tests

- Pattern matching correctness for each PII category
- Luhn check validation for credit cards
- Risk scoring weight calculations
- Firewall pattern detection accuracy
- Log sanitization effectiveness

### Integration Tests

- Full scan pipeline end-to-end
- Message passing between content script and service worker
- Settings persistence and validation
- Audit log write/read cycle

### Security Tests

- Attempt to send raw PII through firewall (should be blocked)
- Attempt to bypass CSP (should fail)
- Attempt to access extension storage from page context (should fail)
- Attempt to inject scripts via DOM (should be blocked by CSP)
- Verify password fields are never exposed in DOM extraction
- Verify audit logs do not contain raw sensitive values
- Verify outbound payloads are scanned before transmission

### Browser Tests (Playwright)

- Extension loads correctly in Chrome
- Scan completes on test pages
- Overlays appear with correct colors and positions
- Popup displays scan results accurately
- Settings are saved and restored
- Audit log records scan events
