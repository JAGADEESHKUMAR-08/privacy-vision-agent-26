import {
  PageContext,
  PageType,
  DOMElementInfo,
  FormFieldInfo,
  DetectedEntity,
  RiskScore,
  RedactionAction,
  BoundingBox,
  PIICategory,
  RiskLevel,
  DetectionSource,
} from '../../extension/src/types/index';

export function boundingBox(x = 0, y = 0, width = 0, height = 0): BoundingBox {
  return { x, y, width, height };
}

export interface PageContextOverrides {
  url?: string;
  title?: string;
  pageType?: PageType;
  domElements?: DOMElementInfo[];
  formFields?: FormFieldInfo[];
  visibleText?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  scrollHeight?: number;
}

export function createPageContext(overrides: PageContextOverrides = {}): PageContext {
  return {
    url: overrides.url ?? 'https://example.com/',
    title: overrides.title ?? 'Example Page',
    timestamp: Date.now(),
    pageType: overrides.pageType ?? 'unknown',
    viewportWidth: overrides.viewportWidth ?? 1920,
    viewportHeight: overrides.viewportHeight ?? 1080,
    scrollHeight: overrides.scrollHeight ?? 2000,
    domElements: overrides.domElements ?? [],
    formFields: overrides.formFields ?? [],
    visibleText: overrides.visibleText ?? '',
  };
}

export function formField(overrides: Partial<FormFieldInfo> = {}): FormFieldInfo {
  return {
    selector: overrides.selector ?? 'input#field',
    name: overrides.name ?? '',
    type: overrides.type ?? 'text',
    placeholder: overrides.placeholder ?? '',
    value: overrides.value ?? '',
    label: overrides.label,
    autocomplete: overrides.autocomplete,
    isPassword: overrides.isPassword ?? false,
    rect: overrides.rect ?? boundingBox(),
  };
}

export function domElement(overrides: Partial<DOMElementInfo> = {}): DOMElementInfo {
  return {
    tagName: overrides.tagName ?? 'input',
    text: overrides.text ?? '',
    type: overrides.type,
    name: overrides.name,
    placeholder: overrides.placeholder,
    value: overrides.value,
    id: overrides.id,
    className: overrides.className,
    selector: overrides.selector ?? 'input#field',
    rect: overrides.rect ?? boundingBox(),
    isVisible: overrides.isVisible ?? true,
    isInput: overrides.isInput ?? true,
    isButton: overrides.isButton ?? false,
    isLink: overrides.isLink ?? false,
    autocomplete: overrides.autocomplete,
    ariaLabel: overrides.ariaLabel,
    inputType: overrides.inputType,
  };
}

export function entity(overrides: Partial<DetectedEntity> = {}): DetectedEntity {
  return {
    id: overrides.id ?? 'ent-1',
    type: overrides.type ?? 'EMAIL',
    value: overrides.value ?? 'john@example.com',
    bbox: overrides.bbox ?? boundingBox(),
    confidence: overrides.confidence ?? 0.9,
    risk: overrides.risk ?? 'HIGH',
    source: overrides.source ?? 'REGEX',
    timestamp: overrides.timestamp ?? Date.now(),
    context: overrides.context,
    domSelector: overrides.domSelector,
  };
}

export function riskScore(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    entityId: overrides.entityId ?? 'ent-1',
    overall: overrides.overall ?? 0.5,
    entitySensitivity: overrides.entitySensitivity ?? 0.5,
    modelConfidence: overrides.modelConfidence ?? 0.5,
    domContext: overrides.domContext ?? 0.5,
    pageContext: overrides.pageContext ?? 0.5,
    semanticContext: overrides.semanticContext ?? 0.5,
    level: overrides.level ?? 'MEDIUM',
  };
}

export function redaction(overrides: Partial<RedactionAction> = {}): RedactionAction {
  return {
    entityId: overrides.entityId ?? 'ent-1',
    method: overrides.method ?? 'mask',
    originalValue: overrides.originalValue ?? 'john@example.com',
    redactedValue: overrides.redactedValue ?? '[EMAIL_REDACTED]',
    bbox: overrides.bbox ?? boundingBox(),
  };
}

export const ALL_CATEGORIES: PIICategory[] = [
  'EMAIL', 'PHONE', 'NAME', 'ADDRESS', 'PASSWORD', 'USERNAME',
  'CREDIT_CARD', 'BANK_ACCOUNT', 'API_KEY', 'AUTH_TOKEN',
  'DATE_OF_BIRTH', 'GOVERNMENT_ID', 'MEDICAL_ID', 'FINANCIAL_DATA',
  'PRIVATE_DOCUMENT_CONTENT',
];

export const ALL_SOURCES: DetectionSource[] = ['OCR', 'DOM', 'VISION', 'REGEX', 'CLASSIFIER', 'HYBRID'];
export const ALL_RISK_LEVELS: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export const luhnCards = {
  visa: '4111111111111111',
  mastercard: '5500000000000004',
  amex: '378282246310005',
  discover: '6011111111111117',
  maestroLike: '5555555555554444',
};

export const luhnInvalidCards = [
  '4111111111111112',
  '1234567890123456',
  '4111111111111234',
];
