import {
  PageContext,
  DetectedEntity,
  RiskScore,
  RedactionAction,
  SanitizedContext,
  SafeElement,
  SafeFormField,
  FirewallAction,
  OutboundPayload,
  PIICategory,
  RiskLevel,
  DetectionSource,
  BoundingBox,
  DOMElementInfo,
  FormFieldInfo,
} from '../types/index';

const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function higherRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

function bboxOverlap(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  const intersection = (x2 - x1) * (y2 - y1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

export class PrivacyFirewall {
  private actions: FirewallAction[] = [];
  private blockedDomains: Set<string> = new Set();
  private blockedPaths: RegExp[] = [];

  constructor() {
    this.actions = [];
  }

  createSanitizedContext(
    pageContext: PageContext,
    entities: DetectedEntity[],
    risks: RiskScore[],
    redactions: RedactionAction[],
    processingTime: number,
  ): SanitizedContext {
    const safeElements = this.buildSafeElements(pageContext.domElements, entities);
    const safeFormFields = this.buildSafeFormFields(pageContext.formFields, entities);
    const safeText = this.buildSafeText(pageContext.visibleText, entities);

    const overallRisk = this.computeOverallRisk(risks);
    const detectionSources = [...new Set(entities.map((e) => e.source))];

    for (const redaction of redactions) {
      this.recordAction('REDACT', `Redacted ${redaction.method} on entity ${redaction.entityId}`, redaction.originalValue, [redaction.entityId]);
    }

    if (entities.length > 0 && redactions.length === 0) {
      this.recordAction('WARN', `${entities.length} entities detected but none redacted`, undefined, entities.map((e) => e.id));
    }

    return {
      url: pageContext.url,
      title: pageContext.title,
      pageType: pageContext.pageType,
      safeElements,
      safeText,
      safeFormFields,
      entityCount: entities.length,
      redactedCount: redactions.length,
      riskLevel: overallRisk,
      metadata: {
        processingTime,
        detectionSources,
        modelVersion: '1.0.0',
      },
    };
  }

  checkOutbound(payload: OutboundPayload): FirewallAction {
    const payloadStr = JSON.stringify(payload.data);
    const detectedFields: string[] = [];

    const sensitivePatterns: Array<{ pattern: RegExp; label: string }> = [
      { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, label: 'EMAIL' },
      { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, label: 'CREDIT_CARD' },
      { pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g, label: 'SSN' },
      { pattern: /\b[A-Za-z0-9]{32,}\b/g, label: 'POSSIBLE_API_KEY' },
      { pattern: /Bearer\s+[A-Za-z0-9_\-\.]+/gi, label: 'AUTH_TOKEN' },
      { pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi, label: 'PASSWORD' },
    ];

    for (const { pattern, label } of sensitivePatterns) {
      if (pattern.test(payloadStr)) {
        detectedFields.push(label);
      }
    }

    if (this.blockedDomains.has(payload.source)) {
      const action: FirewallAction = {
        timestamp: Date.now(),
        type: 'BLOCK',
        reason: `Domain ${payload.source} is blocked`,
        payload: payload.type,
        detectedFields,
      };
      this.actions.push(action);
      return action;
    }

    for (const re of this.blockedPaths) {
      if (re.test(payload.source)) {
        const action: FirewallAction = {
          timestamp: Date.now(),
          type: 'BLOCK',
          reason: `Source ${payload.source} matches blocked pattern`,
          payload: payload.type,
          detectedFields,
        };
        this.actions.push(action);
        return action;
      }
    }

    if (detectedFields.length > 0) {
      const action: FirewallAction = {
        timestamp: Date.now(),
        type: 'REDACT',
        reason: `Outbound payload contains sensitive fields: ${detectedFields.join(', ')}`,
        payload: payload.type,
        detectedFields,
      };
      this.actions.push(action);
      return action;
    }

    const action: FirewallAction = {
      timestamp: Date.now(),
      type: 'ALLOW',
      reason: 'No sensitive data detected in outbound payload',
      payload: payload.type,
    };
    this.actions.push(action);
    return action;
  }

  blockDomain(domain: string): void {
    this.blockedDomains.add(domain);
  }

  unblockDomain(domain: string): void {
    this.blockedDomains.delete(domain);
  }

  blockPathPattern(pattern: RegExp): void {
    this.blockedPaths.push(pattern);
  }

  getActions(): FirewallAction[] {
    return [...this.actions];
  }

  clearActions(): void {
    this.actions = [];
  }

  getBlockedDomains(): string[] {
    return [...this.blockedDomains];
  }

  private buildSafeElements(
    domElements: DOMElementInfo[],
    entities: DetectedEntity[],
  ): SafeElement[] {
    return domElements
      .filter((el) => el.isVisible)
      .map((el) => {
        const sensitiveFields: string[] = [];
        const seenCategories = new Set<PIICategory>();

        for (const entity of entities) {
          if (seenCategories.has(entity.type)) continue;

          if (entity.domSelector && entity.domSelector === el.selector) {
            sensitiveFields.push(entity.type);
            seenCategories.add(entity.type);
            continue;
          }

          if (entity.value && entity.value.length > 0) {
            const elText = el.text || '';
            const elValue = el.value || '';
            if (elText.includes(entity.value) || elValue.includes(entity.value)) {
              sensitiveFields.push(entity.type);
              seenCategories.add(entity.type);
            }
          }

          if (el.rect.width > 0 && el.rect.height > 0 && entity.bbox.width > 0 && entity.bbox.height > 0) {
            if (bboxOverlap(el.rect, entity.bbox) > 0.5) {
              sensitiveFields.push(entity.type);
              seenCategories.add(entity.type);
            }
          }
        }

        const role = this.inferRole(el);

        return {
          tag: el.tagName,
          role,
          label: this.inferLabel(el),
          selector: el.selector,
          rect: el.rect,
          isVisible: el.isVisible,
          isInteractive: el.isInput || el.isButton || el.isLink,
          sensitiveFields,
        };
      });
  }

  private buildSafeFormFields(
    formFields: FormFieldInfo[],
    entities: DetectedEntity[],
  ): SafeFormField[] {
    return formFields.map((field) => {
      const domEl = typeof document !== 'undefined' ? document.querySelector(field.selector) : null;
      const required = domEl ? domEl.hasAttribute('required') || domEl.getAttribute('aria-required') === 'true' : false;

      return {
        selector: field.selector,
        label: field.label || field.placeholder || field.name || field.type,
        type: field.type,
        required,
        rect: field.rect,
      };
    });
  }

  private buildSafeText(visibleText: string, entities: DetectedEntity[]): string {
    if (!visibleText || entities.length === 0) return visibleText;

    const sortedEntities = [...entities].sort((a, b) => {
      const idxA = visibleText.indexOf(a.value);
      const idxB = visibleText.indexOf(b.value);
      return (idxA === -1 ? Infinity : idxA) - (idxB === -1 ? Infinity : idxB);
    });

    let safeText = visibleText;

    for (const entity of sortedEntities) {
      if (!entity.value || entity.value.length === 0) continue;

      const escaped = entity.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const placeholder = `[${entity.type}]`;

      try {
        safeText = safeText.replace(new RegExp(escaped, 'g'), placeholder);
      } catch {
        while (safeText.includes(entity.value)) {
          safeText = safeText.replace(entity.value, placeholder);
        }
      }
    }

    return safeText;
  }

  private inferRole(el: DOMElementInfo): string {
    if (el.isButton) return 'button';
    if (el.isLink) return 'link';
    if (el.isInput) {
      if (el.inputType === 'password') return 'password';
      if (el.inputType === 'email') return 'textbox';
      if (el.inputType === 'tel') return 'textbox';
      if (el.inputType === 'checkbox') return 'checkbox';
      if (el.inputType === 'radio') return 'radio';
      return 'textbox';
    }
    return 'generic';
  }

  private inferLabel(el: DOMElementInfo): string {
    if (el.ariaLabel) return el.ariaLabel;
    if (el.placeholder) return el.placeholder;
    if (el.name) return el.name;
    if (el.text && el.text.length > 0 && el.text.length < 100) return el.text;
    if (el.id) return el.id;
    return el.tagName;
  }

  private computeOverallRisk(scores: RiskScore[]): RiskLevel {
    if (scores.length === 0) return 'LOW';
    let overall: RiskLevel = 'LOW';
    for (const score of scores) {
      overall = higherRisk(overall, score.level);
    }
    return overall;
  }

  private recordAction(
    type: FirewallAction['type'],
    reason: string,
    payload?: string,
    detectedFields?: string[],
  ): void {
    this.actions.push({
      timestamp: Date.now(),
      type,
      reason,
      payload,
      detectedFields,
    });
  }
}
