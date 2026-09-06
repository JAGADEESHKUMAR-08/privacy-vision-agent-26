import {
  DetectedEntity,
  DetectionSource,
  FormFieldInfo,
  PageContext,
  PageType,
  PIICategory,
  RiskLevel,
} from '../types/index';
import { generateId } from '../utils/id-generator';

export interface PIIClassifier {
  classify(text: string): Promise<PIICategory | null>;
  isAvailable(): boolean;
}

type MatchContext = {
  surroundingText: string;
  pageType: PageType;
  domElements: Array<Pick<
    FormFieldInfo,
    'name' | 'placeholder' | 'label' | 'autocomplete' | 'type' | 'isPassword'
  >>;
};

const INTERNAL_CATEGORIES: PIICategory[] = [
  'EMAIL', 'PHONE', 'NAME', 'ADDRESS', 'PASSWORD', 'USERNAME',
  'CREDIT_CARD', 'BANK_ACCOUNT', 'API_KEY', 'AUTH_TOKEN',
  'DATE_OF_BIRTH', 'GOVERNMENT_ID', 'MEDICAL_ID', 'FINANCIAL_DATA',
  'PRIVATE_DOCUMENT_CONTENT',
];

const BASE_RISK: Record<PIICategory, RiskLevel> = {
  PASSWORD: 'CRITICAL',
  API_KEY: 'CRITICAL',
  AUTH_TOKEN: 'CRITICAL',
  CREDIT_CARD: 'CRITICAL',
  EMAIL: 'HIGH',
  PHONE: 'HIGH',
  BANK_ACCOUNT: 'HIGH',
  GOVERNMENT_ID: 'HIGH',
  MEDICAL_ID: 'HIGH',
  FINANCIAL_DATA: 'HIGH',
  USERNAME: 'MEDIUM',
  NAME: 'MEDIUM',
  ADDRESS: 'MEDIUM',
  DATE_OF_BIRTH: 'MEDIUM',
  PRIVATE_DOCUMENT_CONTENT: 'MEDIUM',
};

const TRUSTED_DOMAINS = new Set([
  'google.com', 'microsoft.com', 'apple.com', 'github.com',
  'mozilla.org', 'w3.org', 'schema.org', 'cloudflare.com',
  'amazonaws.com', 'gstatic.com', 'googleapis.com',
]);

const EMAIL_EXCLUSIONS = new Set([
  'example.com', 'test.com', 'localhost', 'domain.com',
  'email.com', 'mail.com', 'sentry.io', 'wixpress.com',
]);

const EMAIL_FILTER = /^(?:test|admin|info|noreply|no-reply|support|hello)@/i;

const PHONE_PATTERNS: RegExp[] = [
  /\+?\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g,
  /\(\d{3}\)\s?\d{3}[\s.-]\d{4}/g,
  /\d{3}[\s.-]\d{3}[\s.-]\d{4}/g,
  /\d{5}\s\d{6}/g,
  /\d{10,12}/g,
];

const CREDIT_CARD_PATTERNS: RegExp[] = [
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  /\b\d{4}[\s-]?\d{6}[\s-]?\d{4}\b/g,
  /\b\d{4}[\s-]?\d{5}[\s-]?\d{5}\b/g,
];

function luhnCheck(num: string): boolean {
  const digits = num.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (isNaN(n)) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function isValidPhone(value: string): boolean {
  const stripped = value.replace(/[\s()+.\-]/g, '');
  if (stripped.length < 7 || stripped.length > 15) return false;
  if (/^\d{7,8}$/.test(stripped)) return false;
  const digitCount = stripped.replace(/\D/g, '').length;
  return digitCount >= 7 && digitCount <= 15;
}

function normalizePhone(raw: string): string {
  return raw.replace(/[\s()+.\-]/g, '');
}

function computePhoneConfidence(value: string, ctx?: MatchContext): number {
  let conf = 0.85;
  const stripped = normalizePhone(value);
  if (stripped.startsWith('+')) conf += 0.05;
  if (/^\+1?\d{10}$/.test(stripped)) conf += 0.03;
  if (ctx?.domElements.some((el) =>
    el.type === 'tel' || el.name?.includes('phone') || el.placeholder?.includes('phone')
  )) {
    conf += 0.1;
  }
  return Math.min(conf, 1);
}

function computeEmailConfidence(value: string, ctx?: MatchContext): number {
  let conf = 0.9;
  const domain = value.split('@')[1]?.toLowerCase() || '';
  if (TRUSTED_DOMAINS.has(domain)) conf -= 0.2;
  if (EMAIL_EXCLUSIONS.has(domain)) conf -= 0.5;
  if (ctx?.domElements.some((el) =>
    el.type === 'email' || el.name?.includes('email') || el.placeholder?.includes('email')
  )) {
    conf += 0.08;
  }
  return Math.max(0.1, Math.min(conf, 1));
}

function detectSensitiveContextHints(ctx?: MatchContext): {
  hasPasswordField: boolean;
  hasFinancialField: boolean;
  hasMedicalField: boolean;
  hasGovernmentField: boolean;
} {
  const labels = (ctx?.domElements || []).map((el) =>
    [el.name, el.placeholder, el.label, el.autocomplete, el.type]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  );
  const allLabels = labels.join(' ');
  return {
    hasPasswordField: allLabels.includes('password') || allLabels.includes('passwd') || allLabels.includes('secret'),
    hasFinancialField: allLabels.includes('credit') || allLabels.includes('card') || allLabels.includes('account') || allLabels.includes('routing') || allLabels.includes('payment') || allLabels.includes('bank'),
    hasMedicalField: allLabels.includes('medical') || allLabels.includes('health') || allLabels.includes('patient') || allLabels.includes('diagnosis') || allLabels.includes('mrn'),
    hasGovernmentField: allLabels.includes('ssn') || allLabels.includes('social security') || allLabels.includes('aadhaar') || allLabels.includes('pan') || allLabels.includes('passport') || allLabels.includes('national id'),
  };
}

function detectGovId(value: string): { type: PIICategory; confidence: number } | null {
  const stripped = value.replace(/[\s-]/g, '');
  if (/^\d{3}-?\d{2}-?\d{4}$/.test(stripped)) return { type: 'GOVERNMENT_ID', confidence: 0.92 };
  if (/^\d{4}\s?\d{4}\s?\d{4}$/.test(stripped)) return { type: 'GOVERNMENT_ID', confidence: 0.88 };
  if (/^[A-Z]{5}\d{4}[A-Z]$/i.test(stripped)) return { type: 'GOVERNMENT_ID', confidence: 0.9 };
  if (/^[A-Z]\d{7,8}$/i.test(stripped)) return { type: 'GOVERNMENT_ID', confidence: 0.85 };
  if (/^\d{12}$/.test(stripped)) return { type: 'GOVERNMENT_ID', confidence: 0.8 };
  if (/^[A-Z]{1,2}\d{6,7}[A-Z\d]$/i.test(stripped)) return { type: 'GOVERNMENT_ID', confidence: 0.82 };
  return null;
}

function detectMedicalId(value: string): { type: PIICategory; confidence: number } | null {
  const stripped = value.replace(/[\s-]/g, '');
  if (/^MRN[\s.-]?\d{6,10}$/i.test(stripped)) return { type: 'MEDICAL_ID', confidence: 0.88 };
  if (/^[A-Z]{3}\d{7,9}$/i.test(stripped)) return { type: 'MEDICAL_ID', confidence: 0.75 };
  if (/^\d{6,10}$/.test(stripped)) return { type: 'MEDICAL_ID', confidence: 0.6 };
  return null;
}

function detectPasswordInContext(text: string, ctx?: MatchContext): { value: string; confidence: number } | null {
  if (ctx?.domElements.some((el) => el.isPassword)) {
    if (text.length >= 4 && text.length <= 128) {
      return { value: text, confidence: 0.95 };
    }
  }
  return null;
}

function detectApiKey(value: string): { confidence: number } | null {
  const patterns: Array<{ re: RegExp; conf: number }> = [
    { re: /\bsk[_-](?:live[_-]|test[_-]|prod[_-])?[A-Za-z0-9]{16,64}\b/, conf: 0.95 },
    { re: /\bpk[_-](?:live[_-]|test[_-]|prod[_-])?[A-Za-z0-9]{16,64}\b/, conf: 0.95 },
    { re: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/, conf: 0.98 },
    { re: /\b(?:xox[baprs])-[A-Za-z0-9-]{10,48}\b/, conf: 0.97 },
    { re: /\b(?:AIza)[A-Za-z0-9_-]{35}\b/, conf: 0.96 },
  ];
  for (const { re, conf } of patterns) {
    if (re.test(value)) return { confidence: conf };
  }
  if (/^[A-Za-z0-9_\-]{32,}$/.test(value)) return { confidence: 0.4 };
  return null;
}

function detectAuthToken(value: string): { confidence: number } | null {
  const parts = value.split('.');
  if (parts.length === 3 && parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) {
    try {
      const header = JSON.parse(atob(parts[0]));
      if (header.alg && header.typ) return { confidence: 0.97 };
    } catch {
      return { confidence: 0.7 };
    }
  }
  if (/^Bearer\s+[A-Za-z0-9_\-\.]+$/i.test(value)) return { confidence: 0.95 };
  if (/^(?:sess|sid|token|jwt)[_-]?[A-Za-z0-9_\-]{20,}$/i.test(value)) return { confidence: 0.85 };
  return null;
}

function detectAddress(value: string): { confidence: number } | null {
  const streetRe = /\d+\s+[A-Za-z0-9\s]+(?:st|nd|rd|th|ave|blvd|dr|ln|way|ct|pl|cir|hwy|terr|trail|pkwy)\b/i;
  const zipRe = /\b\d{5}(?:-\d{4})?\b/;
  const poBoxRe = /\b(?:P\.?O\.?\s*Box|Post\s*Office\s*Box)\s+\d+/i;
  const hasStreet = streetRe.test(value);
  const hasZip = zipRe.test(value);
  const hasPoBox = poBoxRe.test(value);
  if (hasStreet && hasZip) return { confidence: 0.88 };
  if (hasStreet) return { confidence: 0.75 };
  if (hasPoBox) return { confidence: 0.82 };
  if (hasZip && value.length > 10 && value.length < 200) return { confidence: 0.55 };
  return null;
}

function detectFinancialData(value: string): { confidence: number } | null {
  const currencyRe = /^[\$€£¥]\s?\d{1,3}(?:[,.]\d{3})*(?:\.\d{2})?$/;
  const currencyAltRe = /^\d{1,3}(?:[,.]\d{3})*(?:\.\d{2})?\s?(?:USD|EUR|GBP|INR|JPY|CAD|AUD)$/i;
  if (currencyRe.test(value) || currencyAltRe.test(value)) {
    const numStr = value.replace(/[^0-9.]/g, '');
    const amount = parseFloat(numStr);
    if (!isNaN(amount) && amount > 0) {
      if (amount > 100000) return { confidence: 0.65 };
      if (amount > 10000) return { confidence: 0.55 };
      return { confidence: 0.45 };
    }
  }
  return null;
}

function detectDateOfBirth(value: string, ctx?: MatchContext): { confidence: number } | null {
  const dateFormats = [
    /\b(?:0[1-9]|1[0-2])[\/\-.](?:0[1-9]|[12]\d|3[01])[\/\-.](?:19|20)\d{2}\b/,
    /\b(?:0[1-9]|[12]\d|3[01])[\/\-.](?:0[1-9]|1[0-2])[\/\-.](?:19|20)\d{2}\b/,
    /\b(?:19|20)\d{2}[\/\-.](?:0[1-9]|1[0-2])[\/\-.](?:0[1-9]|[12]\d|3[01])\b/,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+(?:19|20)\d{2}\b/i,
    /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:19|20)\d{2}\b/i,
  ];
  let matched = false;
  for (const re of dateFormats) {
    if (re.test(value)) { matched = true; break; }
  }
  if (!matched) return null;
  let conf = 0.4;
  if (ctx?.domElements.some((el) => {
    const s = [el.name, el.placeholder, el.label, el.autocomplete].filter(Boolean).join(' ').toLowerCase();
    return s.includes('birth') || s.includes('dob') || s.includes('date of birth');
  })) {
    conf = 0.85;
  }
  const yearMatch = value.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[0], 10);
    const currentYear = new Date().getFullYear();
    const age = currentYear - year;
    if (age >= 0 && age <= 120) {
      if (age >= 18 && age <= 80) conf += 0.15;
      else if (age >= 13 && age <= 100) conf += 0.1;
    }
  }
  return { confidence: Math.min(conf, 0.9) };
}

function detectUsername(value: string, ctx?: MatchContext): { confidence: number } | null {
  if (value.length < 3 || value.length > 30) return null;
  if (!/^[A-Za-z0-9_\-\.]+$/.test(value)) return null;
  let conf = 0.35;
  if (ctx?.domElements.some((el) => {
    const s = [el.name, el.placeholder, el.label, el.autocomplete].filter(Boolean).join(' ').toLowerCase();
    return s.includes('username') || s.includes('user name') || s.includes('login') || s.includes('handle');
  })) {
    conf = 0.75;
  }
  if (ctx?.pageType === 'login' || ctx?.pageType === 'registration') conf += 0.15;
  return { confidence: Math.min(conf, 0.85) };
}

function detectBankAccount(value: string, ctx?: MatchContext): { confidence: number } | null {
  const stripped = value.replace(/[\s-]/g, '');
  if (/^\d{8,17}$/.test(stripped)) {
    let conf = 0.5;
    if (ctx?.domElements.some((el) => {
      const s = [el.name, el.placeholder, el.label, el.autocomplete].filter(Boolean).join(' ').toLowerCase();
      return s.includes('account') || s.includes('routing') || s.includes('bank');
    })) {
      conf = 0.85;
    }
    return { confidence: conf };
  }
  return null;
}

export class PIIDetector {
  private classifier: PIIClassifier | null = null;
  private enabledCategories: Set<PIICategory>;
  private domCache: Map<string, FormFieldInfo[]> = new Map();

  constructor(options?: {
    classifier?: PIIClassifier;
    enabledCategories?: PIICategory[];
  }) {
    this.classifier = options?.classifier ?? null;
    this.enabledCategories = new Set(options?.enabledCategories ?? INTERNAL_CATEGORIES);
  }

  setClassifier(classifier: PIIClassifier): void {
    this.classifier = classifier;
  }

  setEnabledCategories(categories: PIICategory[]): void {
    this.enabledCategories = new Set(categories);
  }

  clearDomCache(): void {
    this.domCache.clear();
  }

  cacheDomElements(pageUrl: string, elements: FormFieldInfo[]): void {
    this.domCache.set(pageUrl, elements);
  }

  async classifyWithModel(text: string): Promise<PIICategory | null> {
    if (!this.classifier || !this.classifier.isAvailable()) return null;
    try {
      return await this.classifier.classify(text);
    } catch {
      return null;
    }
  }

  detect(text: string, pageContext?: PageContext): DetectedEntity[] {
    if (!text || text.trim().length === 0) return [];
    const entities: DetectedEntity[] = [];
    const matchContext: MatchContext | undefined = pageContext
      ? {
          surroundingText: pageContext.visibleText,
          pageType: pageContext.pageType,
          domElements: pageContext.formFields,
        }
      : undefined;
    const sensitiveHints = detectSensitiveContextHints(matchContext);

    if (this.enabledCategories.has('PASSWORD')) {
      const pwResult = detectPasswordInContext(text, matchContext);
      if (pwResult) {
        entities.push(this.createEntity('PASSWORD', pwResult.value, pwResult.confidence, 'REGEX', matchContext));
      }
    }

    if (this.enabledCategories.has('EMAIL')) {
      const emails = this.findMatches(text, /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g);
      for (const email of emails) {
        const domain = email.split('@')[1]?.toLowerCase() || '';
        if (EMAIL_EXCLUSIONS.has(domain)) continue;
        if (EMAIL_FILTER.test(email)) continue;
        const conf = computeEmailConfidence(email, matchContext);
        if (conf > 0.2) {
          entities.push(this.createEntity('EMAIL', email, conf, 'REGEX', matchContext));
        }
      }
    }

    if (this.enabledCategories.has('PHONE')) {
      for (const re of PHONE_PATTERNS) {
        const matches = this.findMatches(text, re);
        for (const match of matches) {
          if (isValidPhone(match)) {
            const conf = computePhoneConfidence(match, matchContext);
            const normalized = normalizePhone(match);
            if (!entities.some((e) => e.type === 'PHONE' && normalizePhone(e.value) === normalized)) {
              entities.push(this.createEntity('PHONE', match, conf, 'REGEX', matchContext));
            }
          }
        }
      }
    }

    if (this.enabledCategories.has('CREDIT_CARD')) {
      for (const re of CREDIT_CARD_PATTERNS) {
        const matches = this.findMatches(text, re);
        for (const match of matches) {
          if (luhnCheck(match)) {
            const digits = match.replace(/\D/g, '');
            if (!entities.some((e) => e.type === 'CREDIT_CARD' && e.value.replace(/\D/g, '') === digits)) {
              entities.push(this.createEntity('CREDIT_CARD', match, 0.95, 'REGEX', matchContext));
            }
          }
        }
      }
    }

    if (this.enabledCategories.has('API_KEY')) {
      const keywordRe = /(?:api[_\-]?key|apikey|secret[_\-]?key|access[_\-]?key)\s*[:=]\s*['"]?([A-Za-z0-9_\-]{20,})['"]?/i;
      const keywordMatch = text.match(keywordRe);
      if (keywordMatch) {
        const keyResult = detectApiKey(keywordMatch[1]);
        if (keyResult && keyResult.confidence > 0.5) {
          entities.push(this.createEntity('API_KEY', keywordMatch[1], keyResult.confidence, 'REGEX', matchContext));
        }
      }
      const prefixPatterns = [/(?:sk|pk|ak|rk|ghp|gho|AIza)[A-Za-z0-9_\-]{16,}/g];
      for (const re of prefixPatterns) {
        const matches = this.findMatches(text, re);
        for (const match of matches) {
          const keyResult = detectApiKey(match);
          if (keyResult) {
            entities.push(this.createEntity('API_KEY', match, keyResult.confidence, 'REGEX', matchContext));
          }
        }
      }
    }

    if (this.enabledCategories.has('AUTH_TOKEN')) {
      const tokenPatterns = [
        /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
        /Bearer\s+[A-Za-z0-9_\-\.]{20,}/gi,
        /\b(?:sess|sid|token|jwt)[_-]?[A-Za-z0-9_\-]{20,}\b/gi,
      ];
      for (const re of tokenPatterns) {
        const matches = this.findMatches(text, re);
        for (const match of matches) {
          const tokenResult = detectAuthToken(match);
          if (tokenResult) {
            entities.push(this.createEntity('AUTH_TOKEN', match, tokenResult.confidence, 'REGEX', matchContext));
          }
        }
      }
    }

    if (this.enabledCategories.has('GOVERNMENT_ID')) {
      const govPatterns = [
        /\b\d{3}-?\d{2}-?\d{4}\b/g,
        /\b[A-Z]{5}\d{4}[A-Z]\b/g,
        /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
        /\b\d{12}\b/g,
        /\b[A-Z]{1,2}\d{6,7}[A-Z\d]\b/g,
      ];
      for (const re of govPatterns) {
        const matches = this.findMatches(text, re);
        for (const match of matches) {
          const govResult = detectGovId(match);
          if (govResult) {
            let conf = govResult.confidence;
            if (sensitiveHints.hasGovernmentField) conf = Math.min(conf + 0.1, 0.98);
            entities.push(this.createEntity('GOVERNMENT_ID', match, conf, 'REGEX', matchContext));
          }
        }
      }
    }

    if (this.enabledCategories.has('MEDICAL_ID')) {
      const medPatterns = [/\b(?:MRN|mrn)[\s.-]?\d{6,10}\b/gi, /\b[A-Z]{3}\d{7,9}\b/g];
      for (const re of medPatterns) {
        const matches = this.findMatches(text, re);
        for (const match of matches) {
          const medResult = detectMedicalId(match);
          if (medResult) {
            let conf = medResult.confidence;
            if (sensitiveHints.hasMedicalField) conf = Math.min(conf + 0.1, 0.95);
            entities.push(this.createEntity('MEDICAL_ID', match, conf, 'REGEX', matchContext));
          }
        }
      }
    }

    if (this.enabledCategories.has('BANK_ACCOUNT')) {
      if (sensitiveHints.hasFinancialField) {
        const acctPatterns = [
          /\b(?:account|acct)[\s.#:_-]*(?:number|#|no\.?)?[\s:#_]*(\d{8,17})\b/gi,
          /\b(?:routing|rtn|aba)[\s.#:_-]*(?:number|#|no\.?)?[\s:#_]*(\d{9})\b/gi,
        ];
        for (const re of acctPatterns) {
          const matches = this.findMatches(text, re);
          for (const match of matches) {
            if (!entities.some((e) => e.type === 'BANK_ACCOUNT' && e.value === match)) {
              entities.push(this.createEntity('BANK_ACCOUNT', match, 0.82, 'REGEX', matchContext));
            }
          }
        }
      }
      const routingMatch = text.match(/\b\d{9}\b/g);
      if (routingMatch && sensitiveHints.hasFinancialField) {
        for (const match of routingMatch) {
          if (!entities.some((e) => e.type === 'BANK_ACCOUNT' && e.value === match)) {
            entities.push(this.createEntity('BANK_ACCOUNT', match, 0.8, 'REGEX', matchContext));
          }
        }
      }
    }

    if (this.enabledCategories.has('ADDRESS')) {
      const addressParts = text.split(/[;|\n]/);
      for (const part of addressParts) {
        const trimmed = part.trim();
        if (trimmed.length > 5 && trimmed.length < 200) {
          const addrResult = detectAddress(trimmed);
          if (addrResult) {
            entities.push(this.createEntity('ADDRESS', trimmed, addrResult.confidence, 'REGEX', matchContext));
          }
        }
      }
      const fullAddrResult = detectAddress(text);
      if (fullAddrResult && !entities.some((e) => e.type === 'ADDRESS')) {
        entities.push(this.createEntity('ADDRESS', text, fullAddrResult.confidence, 'REGEX', matchContext));
      }
    }

    if (this.enabledCategories.has('FINANCIAL_DATA')) {
      const finResult = detectFinancialData(text);
      if (finResult) {
        let conf = finResult.confidence;
        if (sensitiveHints.hasFinancialField) conf = Math.min(conf + 0.15, 0.85);
        entities.push(this.createEntity('FINANCIAL_DATA', text.trim(), conf, 'REGEX', matchContext));
      }
    }

    if (this.enabledCategories.has('DATE_OF_BIRTH')) {
      const dobResult = detectDateOfBirth(text, matchContext);
      if (dobResult && dobResult.confidence > 0.4) {
        entities.push(this.createEntity('DATE_OF_BIRTH', text.trim(), dobResult.confidence, 'REGEX', matchContext));
      }
    }

    if (this.enabledCategories.has('USERNAME')) {
      const usernameResult = detectUsername(text, matchContext);
      if (usernameResult) {
        entities.push(this.createEntity('USERNAME', text.trim(), usernameResult.confidence, 'REGEX', matchContext));
      }
    }

    return entities;
  }

  async detectWithClassifier(text: string, pageContext?: PageContext): Promise<DetectedEntity[]> {
    const regexEntities = this.detect(text, pageContext);
    const category = await this.classifyWithModel(text);
    if (category && this.enabledCategories.has(category)) {
      const alreadyDetected = regexEntities.some((e) => e.type === category);
      if (!alreadyDetected) {
        const matchContext: MatchContext | undefined = pageContext
          ? { surroundingText: pageContext.visibleText, pageType: pageContext.pageType, domElements: pageContext.formFields }
          : undefined;
        regexEntities.push(this.createEntity(category, text, 0.8, 'CLASSIFIER', matchContext));
      }
    }
    return regexEntities;
  }

  async scanPage(pageContext: PageContext): Promise<DetectedEntity[]> {
    const allEntities: DetectedEntity[] = [];
    const seen = new Set<string>();
    const formValues = pageContext.formFields
      .filter((f) => f.value && f.value.trim().length > 0)
      .map((f) => f.value);

    for (const value of formValues) {
      const entities = await this.detectWithClassifier(value, pageContext);
      for (const entity of entities) {
        const key = entity.type + ':' + entity.value;
        if (!seen.has(key)) { seen.add(key); allEntities.push(entity); }
      }
    }

    const textChunks = this.extractTextChunks(pageContext.visibleText);
    for (const chunk of textChunks) {
      if (chunk.length < 2) continue;
      const entities = await this.detectWithClassifier(chunk, pageContext);
      for (const entity of entities) {
        const key = entity.type + ':' + entity.value;
        if (!seen.has(key)) { seen.add(key); allEntities.push(entity); }
      }
    }

    return allEntities;
  }

  extractEntities(text: string, pageContext?: PageContext): DetectedEntity[] {
    return this.detect(text, pageContext);
  }

  private createEntity(
    type: PIICategory,
    value: string,
    confidence: number,
    source: DetectionSource,
    ctx?: MatchContext,
  ): DetectedEntity {
    const surrounding = this.extractSurrounding(value, ctx?.surroundingText || '');
    return {
      id: generateId('ent'),
      type,
      value,
      bbox: { x: 0, y: 0, width: 0, height: 0 },
      confidence: Math.round(confidence * 1000) / 1000,
      risk: BASE_RISK[type] || 'LOW',
      source,
      timestamp: Date.now(),
      context: surrounding || undefined,
    };
  }

  private findMatches(text: string, pattern: RegExp): string[] {
    const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
    const re = new RegExp(pattern.source, flags);
    const results: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      results.push(match[0]);
    }
    return results;
  }

  private extractSurrounding(target: string, text: string): string {
    const idx = text.indexOf(target);
    if (idx === -1) return '';
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + target.length + 60);
    return text.substring(start, end).trim();
  }

  private extractTextChunks(text: string): string[] {
    if (!text) return [];
    const sentences = text.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);
    const chunks: string[] = [];
    for (const sentence of sentences) {
      chunks.push(sentence.trim());
      const words = sentence.split(/\s+/);
      for (let i = 0; i < words.length - 1; i++) {
        const bigram = words.slice(i, i + 2).join(' ');
        if (bigram.length > 5) chunks.push(bigram);
      }
    }
    return chunks;
  }
}
