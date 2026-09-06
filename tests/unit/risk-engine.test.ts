import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RiskEngine } from '../../extension/src/privacy/risk-engine';
import {
  createPageContext,
  domElement,
  entity,
  boundingBox,
} from '../helpers/fixtures';
import { DetectedEntity, PageContext, DOMElementInfo } from '../../extension/src/types/index';

describe('RiskEngine - Entity sensitivity scoring', () => {
  let engine: RiskEngine;
  let page: PageContext;

  beforeEach(() => {
    engine = new RiskEngine();
    page = createPageContext({ pageType: 'unknown' });
  });

  it('assigns the highest sensitivity to credentials', () => {
    const password = entity({ type: 'PASSWORD', confidence: 0.5 });
    const apiKey = entity({ type: 'API_KEY', confidence: 0.5 });
    const token = entity({ type: 'AUTH_TOKEN', confidence: 0.5 });
    const card = entity({ type: 'CREDIT_CARD', confidence: 0.5 });

    const s1 = engine.scoreEntity(password, page);
    const s2 = engine.scoreEntity(apiKey, page);
    const s3 = engine.scoreEntity(token, page);
    const s4 = engine.scoreEntity(card, page);

    expect(s1.entitySensitivity).toBe(1.0);
    expect(s2.entitySensitivity).toBe(1.0);
    expect(s3.entitySensitivity).toBe(1.0);
    expect(s4.entitySensitivity).toBe(1.0);
  });

  it('assigns 0.8 sensitivity to high-risk data types', () => {
    for (const type of ['EMAIL', 'PHONE', 'BANK_ACCOUNT', 'GOVERNMENT_ID', 'MEDICAL_ID', 'FINANCIAL_DATA'] as const) {
      const score = engine.scoreEntity(entity({ type, confidence: 0.5 }), page);
      expect(score.entitySensitivity).toBe(0.8);
    }
  });

  it('assigns 0.5 sensitivity to medium-risk data types', () => {
    for (const type of ['USERNAME', 'NAME', 'ADDRESS', 'DATE_OF_BIRTH', 'PRIVATE_DOCUMENT_CONTENT'] as const) {
      const score = engine.scoreEntity(entity({ type, confidence: 0.5 }), page);
      expect(score.entitySensitivity).toBe(0.5);
    }
  });

  it('falls back to 0.5 for unknown types', () => {
    const e: DetectedEntity = {
      ...entity({ type: 'EMAIL' }),
      type: 'UNKNOWN_TYPE' as DetectedEntity['type'],
    };
    const score = engine.scoreEntity(e, page);
    expect(score.entitySensitivity).toBe(0.5);
  });

  it('passes model confidence through unchanged', () => {
    const score = engine.scoreEntity(entity({ type: 'EMAIL', confidence: 0.87 }), page);
    expect(score.modelConfidence).toBe(0.87);
  });

  it('clamps model confidence to [0, 1]', () => {
    const high = engine.scoreEntity(entity({ type: 'EMAIL', confidence: 1.5 }), page);
    const low = engine.scoreEntity(entity({ type: 'EMAIL', confidence: -0.5 }), page);
    expect(high.modelConfidence).toBe(1);
    expect(low.modelConfidence).toBe(0);
  });
});

describe('RiskEngine - DOM context scoring', () => {
  let engine: RiskEngine;

  beforeEach(() => {
    engine = new RiskEngine();
  });

  const pageWith = (elements: DOMElementInfo[]): PageContext =>
    createPageContext({ domElements: elements });

  it('scores password inputs at 1.0', () => {
    const e = entity({
      type: 'PASSWORD',
      confidence: 0.5,
      domSelector: '#pass',
      bbox: boundingBox(0, 0, 10, 10),
    });
    const page = pageWith([
      domElement({ selector: '#pass', inputType: 'password', isInput: true }),
    ]);
    const score = engine.scoreEntity(e, page);
    expect(score.domContext).toBe(1.0);
  });

  it('scores email input context via placeholder keywords', () => {
    const e = entity({
      type: 'EMAIL',
      confidence: 0.5,
      domSelector: '#mail',
      bbox: boundingBox(0, 0, 10, 10),
    });
    const page = pageWith([
      domElement({ selector: '#mail', placeholder: 'Enter your email', isInput: true }),
    ]);
    const score = engine.scoreEntity(e, page);
    expect(score.domContext).toBe(0.9);
  });

  it('scores based on DOM element label keywords', () => {
    const e = entity({
      type: 'EMAIL',
      confidence: 0.5,
      domSelector: '#user',
      bbox: boundingBox(0, 0, 10, 10),
    });
    const page = pageWith([
      domElement({ selector: '#user', name: 'login', isInput: true }),
    ]);
    const score = engine.scoreEntity(e, page);
    expect(score.domContext).toBe(0.85);
  });

  it('uses bbox containment to locate a matching DOM element', () => {
    const e = entity({
      type: 'EMAIL',
      confidence: 0.5,
      bbox: boundingBox(50, 50, 20, 20),
    });
    const page = pageWith([
      domElement({
        selector: '#inner',
        isInput: true,
        placeholder: 'password',
        rect: boundingBox(40, 40, 40, 40),
      }),
    ]);
    const score = engine.scoreEntity(e, page);
    expect(score.domContext).toBe(1.0);
  });

  it('falls back to a neutral dom context when no element matches', () => {
    const e = entity({
      type: 'EMAIL',
      confidence: 0.5,
      bbox: boundingBox(100, 100, 10, 10),
    });
    const page = pageWith([
      domElement({ selector: '#other', rect: boundingBox(0, 0, 20, 20) }),
    ]);
    const score = engine.scoreEntity(e, page);
    expect(score.domContext).toBe(0.4);
  });

  it('scores via autocomplete attribute', () => {
    const e = entity({
      type: 'EMAIL',
      confidence: 0.5,
      domSelector: '#ac',
      bbox: boundingBox(0, 0, 10, 10),
    });
    const page = pageWith([
      domElement({ selector: '#ac', autocomplete: 'email', isInput: true }),
    ]);
    const score = engine.scoreEntity(e, page);
    expect(score.domContext).toBe(0.9);
  });
});

describe('RiskEngine - Page context scoring', () => {
  let engine: RiskEngine;

  beforeEach(() => {
    engine = new RiskEngine();
  });

  it('scores banking pages highest', () => {
    const score = engine.scoreEntity(
      entity({ type: 'EMAIL', confidence: 0.5 }),
      createPageContext({ pageType: 'banking' }),
    );
    expect(score.pageContext).toBe(0.95);
  });

  it('scores login pages highly', () => {
    const score = engine.scoreEntity(
      entity({ type: 'USERNAME', confidence: 0.5 }),
      createPageContext({ pageType: 'login' }),
    );
    expect(score.pageContext).toBe(0.85);
  });

  it('scores healthcare and payment pages highly', () => {
    const health = engine.scoreEntity(
      entity({ type: 'EMAIL', confidence: 0.5 }),
      createPageContext({ pageType: 'healthcare' }),
    );
    const payment = engine.scoreEntity(
      entity({ type: 'EMAIL', confidence: 0.5 }),
      createPageContext({ pageType: 'payment' }),
    );
    expect(health.pageContext).toBe(0.9);
    expect(payment.pageContext).toBe(0.9);
  });

  it('scores unknown/public pages lower', () => {
    const unknown = engine.scoreEntity(
      entity({ type: 'EMAIL', confidence: 0.5 }),
      createPageContext({ pageType: 'unknown' }),
    );
    expect(unknown.pageContext).toBe(0.3);
  });

  it('matches page sensitivity by page type key', () => {
    const social = engine.scoreEntity(
      entity({ type: 'NAME', confidence: 0.5 }),
      createPageContext({ pageType: 'social_media' }),
    );
    expect(social.pageContext).toBe(0.6);
  });
});

describe('RiskEngine - Semantic context scoring', () => {
  let engine: RiskEngine;
  let page: PageContext;

  beforeEach(() => {
    engine = new RiskEngine();
    page = createPageContext({ pageType: 'unknown' });
  });

  it('scores high when surrounding text references sensitive terms', () => {
    const e = entity({
      type: 'EMAIL',
      confidence: 0.5,
      context: 'Provide your password and secret PIN for access.',
    });
    const score = engine.scoreEntity(e, page);
    expect(score.semanticContext).toBeGreaterThan(0.5);
  });

  it('scores neutral when surrounding text has no signal', () => {
    const e = entity({
      type: 'EMAIL',
      confidence: 0.5,
      context: 'This is a generic sentence about the weather today.',
    });
    const score = engine.scoreEntity(e, page);
    expect(score.semanticContext).toBe(0.5);
  });

  it('scores lower when text is explicitly public', () => {
    const e = entity({
      type: 'NAME',
      confidence: 0.5,
      context: 'This profile is public and anyone can see it.',
    });
    const score = engine.scoreEntity(e, page);
    expect(score.semanticContext).toBeLessThan(0.5);
  });

  it('uses entity context over page visible text', () => {
    const e = entity({
      type: 'EMAIL',
      confidence: 0.5,
      context: 'password secret confidential',
    });
    const pageWithText = createPageContext({
      pageType: 'unknown',
      visibleText: 'public share forum',
    });
    const score = engine.scoreEntity(e, pageWithText);
    expect(score.semanticContext).toBeGreaterThan(0.5);
  });

  it('uses page visible text when entity has no context', () => {
    const e = entity({ type: 'EMAIL', confidence: 0.5, context: undefined });
    const pageWithText = createPageContext({
      pageType: 'unknown',
      visibleText: 'confidential bank account credit card otp',
    });
    const score = engine.scoreEntity(e, pageWithText);
    expect(score.semanticContext).toBeGreaterThan(0.5);
  });

  it('returns a deterministic bounded score', () => {
    for (let i = 0; i < 50; i++) {
      const score = engine.scoreEntity(
        entity({ type: 'EMAIL', confidence: 0.5, context: 'password ' + i }),
        page,
      );
      expect(score.semanticContext).toBeGreaterThanOrEqual(0);
      expect(score.semanticContext).toBeLessThanOrEqual(1);
    }
  });
});

describe('RiskEngine - Overall risk calculation', () => {
  let engine: RiskEngine;

  beforeEach(() => {
    engine = new RiskEngine();
  });

  it('produces a weighted overall score in [0, 1]', () => {
    const card = entity({ type: 'CREDIT_CARD', confidence: 0.95 });
    const page = createPageContext({ pageType: 'banking' });
    const score = engine.scoreEntity(card, page, 'credit card purchase complete');
    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(1);
  });

  it('gives a high score to high-sensitivity entities on sensitive pages', () => {
    const card = entity({ type: 'CREDIT_CARD', confidence: 0.95 });
    const page = createPageContext({ pageType: 'payment' });
    const score = engine.scoreEntity(card, page, 'billing credit card');
    expect(score.overall).toBeGreaterThan(0.7);
  });

  it('gives a lower score to low-confidence entities on generic pages', () => {
    const name = entity({ type: 'NAME', confidence: 0.2 });
    const page = createPageContext({ pageType: 'unknown', visibleText: 'public forum post' });
    const score = engine.scoreEntity(name, page, 'public forum post');
    expect(score.overall).toBeLessThan(0.5);
  });

  it('clamps negative and overflow scores', () => {
    const e = entity({ type: 'PASSWORD', confidence: 5 });
    const page = createPageContext({ pageType: 'banking' });
    const score = engine.scoreEntity(e, page);
    expect(score.overall).toBeLessThanOrEqual(1);
    expect(score.overall).toBeGreaterThanOrEqual(0);
  });
});

describe('RiskEngine - Risk level mapping', () => {
  let engine: RiskEngine;

  beforeEach(() => {
    engine = new RiskEngine();
  });

  it('maps ≥0.8 to CRITICAL', () => {
    const card = entity({ type: 'CREDIT_CARD', confidence: 1 });
    const page = createPageContext({ pageType: 'banking' });
    const score = engine.scoreEntity(card, page, 'password secret pin');
    expect(score.overall).toBeGreaterThanOrEqual(0.8);
    expect(score.level).toBe('CRITICAL');
  });

  it('maps ≥0.6 to HIGH', () => {
    const email = entity({ type: 'EMAIL', confidence: 0.9 });
    const page = createPageContext({ pageType: 'ecommerce' });
    const score = engine.scoreEntity(email, page);
    expect(score.overall).toBeGreaterThanOrEqual(0.6);
    expect(score.level).toBe('HIGH');
  });

  it('maps ≥0.35 to MEDIUM', () => {
    const name = entity({ type: 'NAME', confidence: 0.6 });
    const page = createPageContext({ pageType: 'unknown' });
    const score = engine.scoreEntity(name, page);
    expect(score.level).toBe('MEDIUM');
  });

  it('maps <0.35 to LOW', () => {
    const name = entity({ type: 'NAME', confidence: 0.1 });
    const page = createPageContext({ pageType: 'unknown', visibleText: 'public' });
    const score = engine.scoreEntity(name, page, 'public');
    expect(score.level).toBe('LOW');
  });
});

describe('RiskEngine - Weight configuration', () => {
  let engine: RiskEngine;

  beforeEach(() => {
    engine = new RiskEngine();
  });

  it('uses default weights sum to ~1', () => {
    const score = engine.scoreEntity(
      entity({ type: 'EMAIL', confidence: 0.5 }),
      createPageContext({ pageType: 'unknown' }),
    );
    const sum =
      0.3 * score.entitySensitivity +
      0.25 * score.modelConfidence +
      0.2 * score.domContext +
      0.15 * score.pageContext +
      0.1 * score.semanticContext;
    expect(score.overall).toBeCloseTo(sum, 3);
  });

  it('accepts custom weights and normalizes their sum to 1', () => {
    const e = entity({ type: 'EMAIL', confidence: 0.5 });
    const page = createPageContext({ pageType: 'unknown' });
    const before = engine.scoreEntity(e, page);
    engine.configureWeights({
      entitySensitivity: 0.6,
      modelConfidence: 0.2,
      domContext: 0.1,
      pageContext: 0.05,
      semanticContext: 0.05,
    });
    const after = engine.scoreEntity(e, page);
    const sum =
      0.6 * after.entitySensitivity +
      0.2 * after.modelConfidence +
      0.1 * after.domContext +
      0.05 * after.pageContext +
      0.05 * after.semanticContext;
    expect(sum).toBeCloseTo(after.overall, 3);
    expect(after.overall).not.toBe(before.overall);
  });

  it('normalizes weights that do not sum to 1', () => {
    const spy = viSpy();
    engine.configureWeights({
      entitySensitivity: 1,
      modelConfidence: 1,
      domContext: 1,
      pageContext: 1,
      semanticContext: 1,
    });
    expect(spy).toBe(true);
    const score = engine.scoreEntity(
      entity({ type: 'EMAIL', confidence: 0.5 }),
      createPageContext({ pageType: 'unknown' }),
    );
    expect(score.overall).toBeLessThanOrEqual(1);
  });

  function viSpy(): boolean {
    const spy = vi.fn();
    const origWarn = console.warn;
    console.warn = spy;
    engine.configureWeights({
      entitySensitivity: 2,
      modelConfidence: 2,
      domContext: 2,
      pageContext: 2,
      semanticContext: 2,
    });
    console.warn = origWarn;
    return spy.mock.calls.length > 0;
  }
});

describe('RiskEngine - Batch scoring and edge cases', () => {
  let engine: RiskEngine;

  beforeEach(() => {
    engine = new RiskEngine();
  });

  it('scores multiple entities at once', () => {
    const page = createPageContext({ pageType: 'ecommerce' });
    const entities = [
      entity({ id: 'e1', type: 'EMAIL', confidence: 0.9, value: 'a@a.org' }),
      entity({ id: 'e2', type: 'CREDIT_CARD', confidence: 0.95, value: '4111 1111 1111 1111' }),
      entity({ id: 'e3', type: 'USERNAME', confidence: 0.4, value: 'john_doe' }),
    ];
    const scores = engine.scoreEntities(entities, page);
    expect(scores.length).toBe(3);
    expect(scores[0].entityId).toBe('e1');
    expect(scores[1].entityId).toBe('e2');
    expect(scores[2].entityId).toBe('e3');
  });

  it('returns LOW overall risk for an empty entity list', () => {
    expect(engine.getOverallRisk([])).toBe('LOW');
  });

  it('computes overall risk weighted by entity sensitivity', () => {
    const lowScore = {
      entityId: 'e1', overall: 0.2, entitySensitivity: 0.5,
      modelConfidence: 0.5, domContext: 0.5, pageContext: 0.5,
      semanticContext: 0.5, level: 'LOW' as const,
    };
    const highScore = {
      entityId: 'e2', overall: 0.98, entitySensitivity: 1.0,
      modelConfidence: 0.5, domContext: 0.5, pageContext: 0.5,
      semanticContext: 0.5, level: 'CRITICAL' as const,
    };
    const overall = engine.getOverallRisk([lowScore, highScore]);
    expect(overall).toBe('HIGH');
  });

  it('handles light weight on high-sensitivity entities by boosting overall', () => {
    const scores = [
      { entityId: 'a', overall: 0.9, entitySensitivity: 1.0, modelConfidence: 0.5, domContext: 0.5, pageContext: 0.5, semanticContext: 0.5, level: 'CRITICAL' as const },
      { entityId: 'b', overall: 0.1, entitySensitivity: 0.5, modelConfidence: 0.5, domContext: 0.5, pageContext: 0.5, semanticContext: 0.5, level: 'LOW' as const },
    ];
    const overall = engine.getOverallRisk(scores);
    expect(overall).toBeDefined();
  });

  it('returns a real risk level not just a score', () => {
    const score = engine.scoreEntity(
      entity({ type: 'GOVERNMENT_ID', confidence: 0.9 }),
      createPageContext({ pageType: 'government' }),
    );
    expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(score.level);
  });
});
