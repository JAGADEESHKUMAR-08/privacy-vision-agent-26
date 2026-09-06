export type PIICategory =
  | 'EMAIL'
  | 'PHONE'
  | 'NAME'
  | 'ADDRESS'
  | 'PASSWORD'
  | 'USERNAME'
  | 'CREDIT_CARD'
  | 'BANK_ACCOUNT'
  | 'API_KEY'
  | 'AUTH_TOKEN'
  | 'DATE_OF_BIRTH'
  | 'GOVERNMENT_ID'
  | 'MEDICAL_ID'
  | 'FINANCIAL_DATA'
  | 'PRIVATE_DOCUMENT_CONTENT';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type DetectionSource = 'OCR' | 'DOM' | 'VISION' | 'REGEX' | 'CLASSIFIER' | 'HYBRID';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedEntity {
  id: string;
  type: PIICategory;
  value: string;
  bbox: BoundingBox;
  confidence: number;
  risk: RiskLevel;
  source: DetectionSource;
  timestamp: number;
  context?: string;
  domSelector?: string;
}

export interface RiskScore {
  entityId: string;
  overall: number;
  entitySensitivity: number;
  modelConfidence: number;
  domContext: number;
  pageContext: number;
  semanticContext: number;
  level: RiskLevel;
}

export interface RedactionAction {
  entityId: string;
  method: 'blur' | 'pixelate' | 'mask' | 'replace' | 'tokenize';
  originalValue: string;
  redactedValue: string;
  bbox: BoundingBox;
}

export interface PageContext {
  url: string;
  title: string;
  timestamp: number;
  pageType: PageType;
  viewportWidth: number;
  viewportHeight: number;
  scrollHeight: number;
  domElements: DOMElementInfo[];
  formFields: FormFieldInfo[];
  visibleText: string;
}

export type PageType =
  | 'banking'
  | 'ecommerce'
  | 'social_media'
  | 'login'
  | 'registration'
  | 'profile'
  | 'healthcare'
  | 'government'
  | 'job_portal'
  | 'admin_dashboard'
  | 'email'
  | 'payment'
  | 'settings'
  | 'saas_dashboard'
  | 'unknown';

export interface DOMElementInfo {
  tagName: string;
  text: string;
  type?: string;
  name?: string;
  placeholder?: string;
  value?: string;
  id?: string;
  className?: string;
  selector: string;
  rect: BoundingBox;
  isVisible: boolean;
  isInput: boolean;
  isButton: boolean;
  isLink: boolean;
  autocomplete?: string;
  ariaLabel?: string;
  inputType?: string;
}

export interface FormFieldInfo {
  selector: string;
  name: string;
  type: string;
  placeholder: string;
  value: string;
  label?: string;
  autocomplete?: string;
  isPassword: boolean;
  rect: BoundingBox;
}

export interface SanitizedContext {
  url: string;
  title: string;
  pageType: PageType;
  safeElements: SafeElement[];
  safeText: string;
  safeFormFields: SafeFormField[];
  redactedScreenshot?: string;
  entityCount: number;
  redactedCount: number;
  riskLevel: RiskLevel;
  metadata: {
    processingTime: number;
    detectionSources: DetectionSource[];
    modelVersion: string;
  };
}

export interface SafeElement {
  tag: string;
  role: string;
  label: string;
  selector: string;
  rect: BoundingBox;
  isVisible: boolean;
  isInteractive: boolean;
  sensitiveFields: string[];
}

export interface SafeFormField {
  selector: string;
  label: string;
  type: string;
  required: boolean;
  rect: BoundingBox;
}

export interface PrivacyReport {
  timestamp: number;
  url: string;
  totalEntities: number;
  entitiesByType: Record<PIICategory, number>;
  entitiesByRisk: Record<RiskLevel, number>;
  entitiesBySource: Record<DetectionSource, number>;
  redactionSummary: {
    total: number;
    byMethod: Record<string, number>;
  };
  firewallActions: FirewallAction[];
  overallRisk: RiskLevel;
  isSafeToTransmit: boolean;
}

export interface FirewallAction {
  timestamp: number;
  type: 'BLOCK' | 'ALLOW' | 'REDACT' | 'WARN';
  reason: string;
  payload?: string;
  detectedFields?: string[];
}

export interface OutboundPayload {
  type: string;
  data: unknown;
  timestamp: number;
  source: string;
}

export interface ScanResult {
  entities: DetectedEntity[];
  risks: RiskScore[];
  redactions: RedactionAction[];
  sanitizedContext: SanitizedContext;
  privacyReport: PrivacyReport;
  screenshot?: string;
  processingTime: {
    total: number;
    ocr: number;
    dom: number;
    detection: number;
    riskScoring: number;
    redaction: number;
  };
}

export interface AgentRequest {
  action: 'scan' | 'get_context' | 'click' | 'type' | 'scroll' | 'screenshot';
  target?: string;
  value?: string;
  options?: Record<string, unknown>;
}

export interface AgentResponse {
  success: boolean;
  context?: SanitizedContext;
  action?: string;
  error?: string;
  screenshot?: string;
}

export interface ExtensionSettings {
  enabled: boolean;
  autoScan: boolean;
  scanInterval: number;
  riskThreshold: RiskLevel;
  redactionMethods: Record<PIICategory, string>;
  enableOCR: boolean;
  enableDOM: boolean;
  enableVision: boolean;
  enableFirewall: boolean;
  enableLogging: boolean;
  maxLogEntries: number;
  theme: 'light' | 'dark' | 'system';
}

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'block';
  message: string;
  data?: Record<string, unknown>;
}

export interface PerformanceMetrics {
  modelLoadTime: number;
  screenshotTime: number;
  ocrTime: number;
  detectionTime: number;
  riskScoringTime: number;
  redactionTime: number;
  totalTime: number;
  memoryUsage: number;
}
