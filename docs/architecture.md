# Architecture

Detailed system architecture for Privacy Vision Agent.

## System Components

```
+-----------------------------------------------------------------------+
|                        Chrome Extension (MV3)                         |
+-----------------------------------------------------------------------+
|                                                                       |
|  +------------------+    +-------------------+    +----------------+  |
|  |   background.js  |    |    content.js     |    |   popup.js     |  |
|  |   (Service       |    |    (Content       |    |   (Popup UI)   |  |
|  |    Worker)       |    |     Script)       |    |                |  |
|  +------------------+    +-------------------+    +----------------+  |
|          |                      |                       |              |
|          |    chrome.runtime    |    DOM access         |  storage    |
|          +<-------------------->+<--------------------->+              |
|                                                                       |
+-----------------------------------------------------------------------+
```

### Component Responsibilities

| Component | File | Responsibility |
|-----------|------|---------------|
| Service Worker | `background.js` | Screenshot capture, settings management, audit logging, outbound firewall, message routing |
| Content Script | `content.js` | DOM extraction, PII detection, risk scoring, redaction overlays, agent actions |
| Popup UI | `popup.js` | Display scan results, trigger scans, show audit log, manage settings |
| ML Engine | `ml-engine.js` | Load and run the ONNX classifier model |
| Redaction Engine | `redaction-engine.ts` | Apply blur/pixelate/mask/tokenize to screenshots and DOM |
| Privacy Firewall | `privacy-firewall.ts` | Inspect outbound payloads, block/reduct sensitive data |
| Risk Engine | `risk-engine.ts` | Multi-signal risk scoring for detected entities |
| Page Classifier | `page-classifier.ts` | Classify page type from URL, DOM, and text signals |
| Scan Orchestrator | `scan-orchestrator.ts` | Coordinate the full scan pipeline (TypeScript source) |
| PII Detector | `pii-detector.ts` | Core detection logic with regex + DOM + ML (TypeScript source) |

## Data Flow

### 1. Page Scan Flow

```
User clicks "Scan Page"
         |
         v
[Content Script] <-- message: SCAN_PAGE
         |
         v
+-- extractPageContext() ----------------+
|  - extractDOMElements()                |
|  - extractFormFields()                 |
|  - getVisibleText()                    |
|  - classifyPageType()                  |
+----------------------------------------+
         |
         v
+-- detectPII(visibleText, domHints) ---+
|  - Regex pattern matching              |
|  - DOM context enhancement             |
|  - Confidence scoring                  |
+----------------------------------------+
         |
         v
+-- scoreEntities(entities, pageType) ---+
|  - Entity sensitivity weighting        |
|  - Model confidence factor             |
|  - DOM context score                   |
|  - Page type sensitivity               |
|  - Semantic context analysis           |
+----------------------------------------+
         |
         v
+-- createOverlayForEntities() ----------+
|  - Color-coded bounding boxes          |
|  - Risk level labels                   |
|  - Injected into page DOM              |
+----------------------------------------+
         |
         v
[Content Script] --> message: LOG_EVENT --> [Service Worker]
         |
         v
    ScanResult returned to popup
```

### 2. Screenshot + OCR Flow

```
[Service Worker] <-- message: CAPTURE_SCREENSHOT
         |
         v
chrome.tabs.captureVisibleTab()
         |
         v
+-- runOCR(imageDataUrl) ---------------+
|  - Tesseract.js recognize()           |
|  - Extract text + word bounding boxes |
+----------------------------------------+
         |
         v
+-- detectPII(ocrText) -----------------+
|  - Same regex pipeline                |
|  - Map bounding boxes to entities     |
+----------------------------------------+
         |
         v
[Service Worker] --> message: RUN_OCR --> sendResponse(result)
```

### 3. Outbound Firewall Flow

```
Agent/Script sends outbound request
         |
         v
[Service Worker] <-- message: FIREWALL_CHECK
         |
         v
+-- firewallCheck(payload) -------------+
|  - Serialize payload to JSON           |
|  - Scan against 8 sensitive patterns   |
|  - Check blocked domain list           |
|  - Check blocked path patterns         |
+----------------------------------------+
         |
         +-- SAFE --> ALLOW --> Forward request
         |
         +-- UNSAFE --> BLOCK + logEvent('block', ...)
```

## API Interfaces

### Content Script Messages

| Message Type | Direction | Payload | Response |
|-------------|-----------|---------|----------|
| `SCAN_PAGE` | Popup -> Content | none | `ScanResult` |
| `GET_PAGE_CONTEXT` | Background -> Content | none | `{ url, title, pageType, domElementCount, formFieldCount, visibleTextLength }` |
| `GET_ELEMENTS` | Any -> Content | none | `{ elements: DOMElementInfo[], count }` |
| `GET_PAGE_TEXT` | Any -> Content | none | `{ text: string }` |
| `EXECUTE_ACTION` | Background -> Content | `{ action, target, value }` | `{ success: boolean }` |
| `SHOW_DETECTION_OVERLAY` | Popup -> Content | none | `{ overlayCount: number }` |
| `HIDE_DETECTION_OVERLAY` | Popup -> Content | none | `{ success: true }` |
| `TOGGLE_OVERLAY` | Popup -> Content | none | `{ visible: boolean, overlayCount? }` |
| `GET_LAST_SCAN` | Popup -> Content | none | `ScanResult` |

### Background Script Messages

| Message Type | Direction | Payload | Response |
|-------------|-----------|---------|----------|
| `CAPTURE_SCREENSHOT` | Content -> Background | none | `{ dataUrl: string }` |
| `RUN_OCR` | Any -> Background | `{ imageData: string }` | `{ text, confidence, words }` |
| `SAVE_SETTINGS` | Popup -> Background | `{ settings }` | `{ success: boolean }` |
| `GET_SETTINGS` | Any -> Background | none | `{ settings, redactionMethods }` |
| `FIREWALL_CHECK` | Any -> Background | `{ payload: OutboundPayload }` | `{ safe, reason, detectedFields }` |
| `LOG_EVENT` | Content -> Background | `{ level, message, data? }` | `{ success }` |
| `GET_AUDIT_LOG` | Popup -> Background | none | `{ log: LogEntry[] }` |
| `GET_SCAN_COUNT` | Any -> Background | none | `{ count: number }` |
| `INCREMENT_SCAN_COUNT` | Any -> Background | none | `{ count: number }` |
| `AGENT_ACTION` | Any -> Background | `{ action, target, value }` | varies by action |

### Key Data Structures

#### PageContext
```typescript
{
  url: string;                    // Current page URL
  title: string;                  // Page title
  timestamp: number;              // Extraction time
  pageType: PageType;             // Classified page type
  viewportWidth: number;
  viewportHeight: number;
  scrollHeight: number;
  domElements: DOMElementInfo[];  // All interactive elements
  formFields: FormFieldInfo[];    // Form input fields
  visibleText: string;            // All visible text
}
```

#### DetectedEntity
```typescript
{
  id: string;                     // Unique entity ID
  type: PIICategory;              // 15 PII categories
  value: string;                  // Detected value
  bbox: BoundingBox;              // Position on page
  confidence: number;             // 0.0 - 1.0
  risk: RiskLevel;                // LOW/MEDIUM/HIGH/CRITICAL
  source: DetectionSource;        // REGEX/DOM/OCR/CLASSIFIER/HYBRID
  timestamp: number;
  context?: string;               // Surrounding text
  domSelector?: string;           // CSS selector if DOM-linked
}
```

#### RiskScore
```typescript
{
  entityId: string;
  overall: number;                // 0.0 - 1.0 composite score
  entitySensitivity: number;      // 0.30 weight
  modelConfidence: number;        // 0.25 weight
  domContext: number;             // 0.20 weight
  pageContext: number;            // 0.15 weight
  semanticContext: number;        // 0.10 weight
  level: RiskLevel;
}
```

#### SanitizedContext
```typescript
{
  url: string;
  title: string;
  pageType: PageType;
  safeElements: SafeElement[];    // Elements without PII
  safeText: string;               // Text with PII replaced
  safeFormFields: SafeFormField[];// Form fields (no values)
  redactedScreenshot?: string;    // Screenshot with overlays
  entityCount: number;
  redactedCount: number;
  riskLevel: RiskLevel;
  metadata: {
    processingTime: number;
    detectionSources: DetectionSource[];
    modelVersion: string;
  };
}
```

## Message Passing Protocol

All communication between extension components uses Chrome's `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage` APIs.

### Flow Guarantee

1. Content script is injected via `manifest.json` `content_scripts` at `document_idle`
2. Service worker starts on install and stays alive as long as the extension is active
3. Messages are JSON-serializable (no functions, no DOM references)
4. Long-running operations (OCR, scan) return `true` from the listener to keep the message channel open

### Error Handling

- All message handlers wrap operations in try/catch
- Failed messages return `{ success: false, error: string }`
- The content script guards against multiple injections (`window.__PVA_CONTENT_LOADED__`)

## Security Boundaries

### Extension Isolation

- Content scripts run in the page's DOM but in an isolated JavaScript context
- Service worker has no direct DOM access
- `chrome.storage.local` is used for all persistent state (no network storage)

### Data Flow Constraints

1. **Inbound**: Page DOM and screenshots are read-only inputs
2. **Internal**: Detection, scoring, and redaction happen entirely within the extension
3. **Outbound**: The firewall inspects all data before it leaves the extension boundary
4. **Storage**: Audit logs are stored locally and never synced to external services

### Content Security Policy

```
script-src 'self'; object-src 'self';
```

- Only extension-bundled scripts can execute
- No inline scripts, no eval, no external script loading
- Web-accessible resources limited to `model/*` and `icons/*`
