import {
  DetectedEntity,
  PageContext,
  PIICategory,
  RiskLevel,
  RiskScore,
} from '../types/index';

const defaultWeights = {
  entitySensitivity: 0.30,
  modelConfidence: 0.25,
  domContext: 0.20,
  pageContext: 0.15,
  semanticContext: 0.10,
};

type RiskWeights = typeof defaultWeights;

const SENSITIVITY_MAP: Record<PIICategory, number> = {
  PASSWORD: 1.0,
  API_KEY: 1.0,
  AUTH_TOKEN: 1.0,
  CREDIT_CARD: 1.0,
  EMAIL: 0.8,
  PHONE: 0.8,
  BANK_ACCOUNT: 0.8,
  GOVERNMENT_ID: 0.8,
  MEDICAL_ID: 0.8,
  FINANCIAL_DATA: 0.8,
  USERNAME: 0.5,
  NAME: 0.5,
  ADDRESS: 0.5,
  DATE_OF_BIRTH: 0.5,
  PRIVATE_DOCUMENT_CONTENT: 0.5,
};

const DOM_CONTEXT_KEYWORDS: Array<{ patterns: RegExp[]; score: number }> = [
  { patterns: [/password/i, /passwd/i, /pass-?word/i], score: 1.0 },
  { patterns: [/email/i, /e-?mail/i, /electronic.?mail/i], score: 0.9 },
  { patterns: [/login/i, /sign-?in/i, /log-?on/i, /authenticate/i], score: 0.85 },
  { patterns: [/table/i, /grid/i, /record/i, /row/i], score: 0.7 },
];

const PAGE_TYPE_SENSITIVITY: Record<string, number> = {
  banking: 0.95,
  healthcare: 0.9,
  payment: 0.9,
  login: 0.85,
  ecommerce: 0.8,
  admin_dashboard: 0.75,
  saas_dashboard: 0.75,
  social_media: 0.6,
  profile: 0.6,
  registration: 0.55,
  settings: 0.5,
  email: 0.5,
  job_portal: 0.45,
  government: 0.9,
  unknown: 0.3,
};

const HIGH_RISK_SEMANTIC_TERMS = [
  'password', 'secret', 'private', 'confidential', 'sensitive',
  'credential', 'pin', 'ssn', 'social security', 'aadhaar',
  'pan', 'passport', 'bank account', 'credit card', 'debit card',
  'otp', 'one time password', 'mfa', 'two factor',
];

const LOW_RISK_SEMANTIC_TERMS = [
  'public', 'share', 'publicly visible', 'published',
  'open', 'community', 'forum', 'guest', 'visitor',
  'anyone can see', 'public profile',
];

function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 0.8) return 'CRITICAL';
  if (score >= 0.6) return 'HIGH';
  if (score >= 0.35) return 'MEDIUM';
  return 'LOW';
}

export class RiskEngine {
  private weights: RiskWeights = { ...defaultWeights };

  configureWeights(weights: Partial<RiskWeights>): void {
    this.weights = { ...this.weights, ...weights };

    const total = Object.values(this.weights).reduce((sum, w) => sum + w, 0);
    if (Math.abs(total - 1.0) > 0.001) {
      console.warn(
        `[RiskEngine] Weight sum is ${total.toFixed(3)}, expected ~1.0. Normalizing.`,
      );
      const factor = 1 / total;
      for (const key of Object.keys(this.weights) as Array<keyof RiskWeights>) {
        this.weights[key] *= factor;
      }
    }
  }

  scoreEntity(
    entity: DetectedEntity,
    pageContext: PageContext,
    surroundingText?: string,
  ): RiskScore {
    const entitySensitivity = this.computeEntitySensitivity(entity.type);
    const modelConfidence = this.computeModelConfidence(entity.confidence);
    const domContext = this.computeDomContext(entity, pageContext.domElements);
    const pageCtx = this.computePageContext(pageContext.pageType);
    const semanticCtx = surroundingText
      ? this.computeSemanticContext(surroundingText)
      : this.computeSemanticContext(entity.context ?? pageContext.visibleText.slice(0, 500));

    const overall =
      this.weights.entitySensitivity * entitySensitivity +
      this.weights.modelConfidence * modelConfidence +
      this.weights.domContext * domContext +
      this.weights.pageContext * pageCtx +
      this.weights.semanticContext * semanticCtx;

    const clamped = Math.max(0, Math.min(1, overall));

    return {
      entityId: entity.id,
      overall: clamped,
      entitySensitivity,
      modelConfidence,
      domContext,
      pageContext: pageCtx,
      semanticContext: semanticCtx,
      level: riskLevelFromScore(clamped),
    };
  }

  scoreEntities(
    entities: DetectedEntity[],
    pageContext: PageContext,
  ): RiskScore[] {
    return entities.map((entity) =>
      this.scoreEntity(entity, pageContext, entity.context),
    );
  }

  getOverallRisk(scores: RiskScore[]): RiskLevel {
    if (scores.length === 0) return 'LOW';

    let weightedSum = 0;
    let totalWeight = 0;

    for (const score of scores) {
      const sensitivityWeight = score.entitySensitivity;
      weightedSum += score.overall * sensitivityWeight;
      totalWeight += sensitivityWeight;
    }

    if (totalWeight === 0) return 'LOW';

    const avg = weightedSum / totalWeight;
    return riskLevelFromScore(avg);
  }

  private computeEntitySensitivity(type: PIICategory): number {
    return SENSITIVITY_MAP[type] ?? 0.5;
  }

  private computeModelConfidence(confidence: number): number {
    return Math.max(0, Math.min(1, confidence));
  }

  private computeDomContext(
    entity: DetectedEntity,
    domElements: DOMElementInfo[],
  ): number {
    if (entity.domSelector) {
      const matched = domElements.find(
        (el) => el.selector === entity.domSelector,
      );
      if (matched) {
        const score = this.scoreDomElement(matched);
        if (score !== null) return score;
      }
    }

    const entityBbox = entity.bbox;
    for (const el of domElements) {
      if (el.rect.x <= entityBbox.x &&
          el.rect.y <= entityBbox.y &&
          el.rect.x + el.rect.width >= entityBbox.x + entityBbox.width &&
          el.rect.y + el.rect.height >= entityBbox.y + entityBbox.height) {
        const score = this.scoreDomElement(el);
        if (score !== null) return score;
      }
    }

    return 0.4;
  }

  private scoreDomElement(el: DOMElementInfo): number | null {
    if (el.isInput && el.inputType === 'password') return 1.0;

    const label = [
      el.placeholder,
      el.ariaLabel,
      el.name,
      el.id,
      el.className,
      el.text,
    ]
      .filter(Boolean)
      .join(' ');

    for (const { patterns, score } of DOM_CONTEXT_KEYWORDS) {
      if (patterns.some((p) => p.test(label))) return score;
    }

    if (el.autocomplete) {
      const ac = el.autocomplete.toLowerCase();
      if (ac.includes('password')) return 1.0;
      if (ac.includes('email')) return 0.9;
      if (ac.includes('tel')) return 0.85;
      if (ac.includes('cc-')) return 1.0;
    }

    return null;
  }

  private computePageContext(pageType: string): number {
    return PAGE_TYPE_SENSITIVITY[pageType] ?? 0.3;
  }

  private computeSemanticContext(text: string): number {
    const lower = text.toLowerCase();

    let highHits = 0;
    for (const term of HIGH_RISK_SEMANTIC_TERMS) {
      if (lower.includes(term)) highHits++;
    }

    let lowHits = 0;
    for (const term of LOW_RISK_SEMANTIC_TERMS) {
      if (lower.includes(term)) lowHits++;
    }

    if (highHits === 0 && lowHits === 0) return 0.5;

    const signal = highHits - lowHits;
    const normalized = Math.tanh(signal / 3);
    return Math.max(0, Math.min(1, 0.5 + normalized * 0.5));
  }
}

interface DOMElementInfo {
  tagName: string;
  text: string;
  type?: string;
  name?: string;
  placeholder?: string;
  value?: string;
  id?: string;
  className?: string;
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isInput: boolean;
  isButton: boolean;
  isLink: boolean;
  autocomplete?: string;
  ariaLabel?: string;
  inputType?: string;
}
