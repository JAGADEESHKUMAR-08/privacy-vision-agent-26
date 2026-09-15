import { describe, it, expect, beforeEach } from 'vitest';
import { PrivacyFirewall } from '../../extension/src/privacy/privacy-firewall';
import { createPageContext, entity, domElement, formField, riskScore, boundingBox } from '../helpers/fixtures';
import { OutboundPayload } from '../../extension/src/types/index';

describe('PrivacyFirewall.checkOutbound', () => {
  let firewall: PrivacyFirewall;

  beforeEach(() => {
    firewall = new PrivacyFirewall();
  });

  it('allows a clean payload with no sensitive data', () => {
    const action = firewall.checkOutbound({
      source: 'https://agent.example.com',
      type: 'agent',
      data: { question: 'Summarize this page' },
    });
    expect(action.type).toBe('ALLOW');
    expect(action.detectedFields).toBeUndefined();
  });

  it('blocks a payload containing an email address', () => {
    const action = firewall.checkOutbound({
      source: 'https://agent.example.com',
      type: 'agent',
      data: { message: 'Reach me at john.doe@example.com please' },
    });
    expect(action.type).toBe('REDACT');
    expect(action.detectedFields).toContain('EMAIL');
  });

  it('flags a credit card number regardless of formatting', () => {
    const card = firewall.checkOutbound({
      source: 'agent',
      type: 'test',
      data: { value: '4111 1111 1111 1111' },
    });
    expect(card.detectedFields).toContain('CREDIT_CARD');

    const dashed = firewall.checkOutbound({
      source: 'agent',
      type: 'test',
      data: { value: '4111-1111-1111-1111' },
    });
    expect(dashed.detectedFields).toContain('CREDIT_CARD');
  });

  it('flags an SSN', () => {
    const action = firewall.checkOutbound({
      source: 'agent',
      type: 'test',
      data: { identity: '123-45-6789' },
    });
    expect(action.detectedFields).toContain('SSN');
  });

  it('flags bearer tokens clearly rather than as generic text', () => {
    const action = firewall.checkOutbound({
      source: 'agent',
      type: 'test',
      data: { auth: 'Bearer eyJhbGciOiJIUzI1NiJ9.token.signature' },
    });
    expect(action.detectedFields).toContain('AUTH_TOKEN');
  });

  it('flags inline password assignments', () => {
    const action = firewall.checkOutbound({
      source: 'agent',
      type: 'test',
      data: { text: 'password=hunter2credentials' },
    });
    expect(action.detectedFields).toContain('PASSWORD');
  });

  it('flags long alphanumeric strings as possible API keys', () => {
    const action = firewall.checkOutbound({
      source: 'agent',
      type: 'test',
      data: { key: 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56' },
    });
    expect(action.detectedFields).toContain('POSSIBLE_API_KEY');
  });

  it('blocks outbound payloads to a manually blocked domain', () => {
    firewall.blockDomain('evil.example.com');
    const action = firewall.checkOutbound({
      source: 'evil.example.com',
      type: 'agent',
      data: { question: 'hi' },
    });
    expect(action.type).toBe('BLOCK');
    expect(firewall.getBlockedDomains()).toEqual(['evil.example.com']);
  });

  it('blocks payloads matching a blocked path pattern', () => {
    firewall.blockPathPattern(/tracker/);
    const action = firewall.checkOutbound({
      source: 'https://example.com/tracker',
      type: 'test',
      data: { a: 1 },
    });
    expect(action.type).toBe('BLOCK');
    expect(action.reason).toMatch(/pattern/);
  });

  it('keeps an audit trail of actions', () => {
    firewall.blockDomain('bad.test');
    firewall.checkOutbound({ source: 'https://good.test', type: 't', data: { a: 1 } });
    firewall.checkOutbound({ source: 'bad.test', type: 't', data: { a: 1 } });
    const actions = firewall.getActions();
    expect(actions.map((a) => a.type)).toEqual(['ALLOW', 'BLOCK']);
    firewall.clearActions();
    expect(firewall.getActions()).toEqual([]);
  });
});

describe('PrivacyFirewall.createSanitizedContext', () => {
  let firewall: PrivacyFirewall;

  beforeEach(() => {
    firewall = new PrivacyFirewall();
  });

  it('redacts entity values from visible text', () => {
    const ctx = createPageContext({ visibleText: 'Contact john@example.org or 555-123-4567 today.' });
    const entities = [
      entity({ type: 'EMAIL', value: 'john@example.org' }),
      entity({ type: 'PHONE', value: '555-123-4567' }),
    ];
    const sanitized = firewall.createSanitizedContext(ctx, entities, [], [], 12);
    expect(sanitized.safeText).toBe('Contact [EMAIL] or [PHONE] today.');
  });

  it('never leaks raw values into the sanitized context', () => {
    const ctx = createPageContext({ visibleText: 'john@example.org' });
    const entities = [entity({ type: 'EMAIL', value: 'john@example.org' })];
    const sanitized = firewall.createSanitizedContext(ctx, entities, [], [], 12);
    expect(sanitized.safeText).not.toContain('john@example.org');
  });

  it('marks sensitive fields on elements via DOM selector match', () => {
    const ctx = createPageContext({
      domElements: [domElement({ selector: 'input#email', text: 'foo' })],
    });
    const entities = [entity({ type: 'EMAIL', value: 'definitely@iathere.test', domSelector: 'input#email' })];
    const sanitized = firewall.createSanitizedContext(ctx, entities, [], [], 5);
    expect(sanitized.safeElements[0].sensitiveFields).toContain('EMAIL');
  });

  it('marks sensitive fields on elements via bbox overlap', () => {
    const ctx = createPageContext({
      domElements: [domElement({ selector: 'div#card', rect: boundingBox(10, 10, 100, 40) })],
    });
    // Large overlapping region => IoU > 0.5
    const entities = [entity({ type: 'CREDIT_CARD', value: '4111 1111 1111 1111', bbox: boundingBox(12, 12, 80, 36) })];
    const sanitized = firewall.createSanitizedContext(ctx, entities, [], [], 5);
    expect(sanitized.safeElements[0].sensitiveFields).toContain('CREDIT_CARD');
  });

  it('does not mark elements with no relation to any entity', () => {
    const ctx = createPageContext({
      domElements: [domElement({ selector: 'button#submit', rect: boundingBox(200, 200, 80, 30) })],
    });
    const entities = [entity({ type: 'EMAIL', value: 'x@y.org', bbox: boundingBox(0, 0, 10, 10) })];
    const sanitized = firewall.createSanitizedContext(ctx, entities, [], [], 5);
    expect(sanitized.safeElements[0].sensitiveFields).toEqual([]);
  });

  it('computes the overall risk from the highest entity risk', () => {
    const ctx = createPageContext({});
    const risks = [riskScore({ entityId: 'a', level: 'LOW' }), riskScore({ entityId: 'b', level: 'CRITICAL' })];
    const sanitized = firewall.createSanitizedContext(ctx, [], risks, [], 4);
    expect(sanitized.riskLevel).toBe('CRITICAL');
  });

  it('returns LOW risk when nothing is scored', () => {
    const sanitized = firewall.createSanitizedContext(createPageContext({}), [], [], [], 3);
    expect(sanitized.riskLevel).toBe('LOW');
  });

  it('records a REDACT action per redaction and a WARN when nothing redacted', () => {
    const ctx = createPageContext({ visibleText: 'x@y.org' });
    const entities = [entity({ type: 'EMAIL', value: 'x@y.org' })];
    const redactions = [
      { entityId: 'ent-1', method: 'mask', originalValue: 'x@y.org', redactedValue: '[EMAIL_REDACTED]', bbox: boundingBox() },
    ];
    firewall.createSanitizedContext(ctx, entities, [], redactions, 4);
    expect(firewall.getActions().some((a) => a.type === 'REDACT')).toBe(true);

    firewall.clearActions();
    firewall.createSanitizedContext(ctx, entities, [], [], 4);
    expect(firewall.getActions().some((a) => a.type === 'WARN')).toBe(true);
  });

  it('reports the detection sources and entity/redaction counts', () => {
    const ctx = createPageContext({ visibleText: 'x@y.org' });
    const entities = [
      entity({ id: 'e1', type: 'EMAIL', value: 'x@y.org', source: 'OCR' }),
      entity({ id: 'e2', type: 'PASSWORD', value: 'pw', source: 'VISION' }),
    ];
    const sanitized = firewall.createSanitizedContext(ctx, entities, [], [], 9);
    expect(sanitized.entityCount).toBe(2);
    expect(sanitized.redactedCount).toBe(0);
    expect(sanitized.metadata.detectionSources).toEqual(expect.arrayContaining(['OCR', 'VISION']));
    expect(sanitized.metadata.processingTime).toBe(9);
  });
});