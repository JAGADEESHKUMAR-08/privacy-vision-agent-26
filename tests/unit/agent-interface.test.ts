// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentInterface } from '../../extension/src/agent/agent-interface';
import type { SanitizedContext, ScanResult, DetectedEntity } from '../../extension/src/types';

function makeEntity(partial: Partial<DetectedEntity> = {}): DetectedEntity {
  return {
    id: 'ent_1',
    type: 'EMAIL',
    value: 'alice@example.com',
    bbox: { x: 10, y: 20, width: 100, height: 14 },
    confidence: 0.99,
    risk: 'HIGH',
    source: 'DOM',
    timestamp: Date.now(),
    ...partial,
  };
}

function makeSanitized(overrides: Partial<SanitizedContext> = {}): SanitizedContext {
  return {
    url: 'https://example.com/',
    title: 'Example',
    pageType: 'login',
    safeElements: [
      {
        tag: 'input',
        role: 'textbox',
        label: 'Email address',
        selector: '#email',
        rect: { x: 10, y: 20, width: 100, height: 14 },
        isVisible: true,
        isInteractive: true,
        sensitiveFields: ['EMAIL'],
      },
      {
        tag: 'button',
        role: 'button',
        label: 'Sign in',
        selector: '#signin',
        rect: { x: 10, y: 60, width: 80, height: 30 },
        isVisible: true,
        isInteractive: true,
        sensitiveFields: [],
      },
    ],
    safeText: 'Sign in to continue',
    safeFormFields: [
      { selector: '#email', label: 'Email address', type: 'email', required: true, rect: { x: 0, y: 0, width: 100, height: 14 } },
    ],
    entityCount: 1,
    redactedCount: 1,
    riskLevel: 'MEDIUM',
    metadata: { processingTime: 12, detectionSources: ['DOM'], modelVersion: 'test' },
    ...overrides,
  };
}

function makeScanResult(entity: DetectedEntity = makeEntity()): ScanResult {
  const sanitized = makeSanitized();
  return {
    entities: [entity],
    risks: [],
    redactions: [],
    sanitizedContext: sanitized,
    privacyReport: {
      timestamp: Date.now(),
      url: 'https://example.com/',
      totalEntities: 1,
      entitiesByType: { EMAIL: 1 } as ScanResult['privacyReport']['entitiesByType'],
      entitiesByRisk: { HIGH: 1 } as ScanResult['privacyReport']['entitiesByRisk'],
      entitiesBySource: { DOM: 1 } as ScanResult['privacyReport']['entitiesBySource'],
      redactionSummary: { total: 1, byMethod: { mask: 1 } },
      firewallActions: [],
      overallRisk: 'MEDIUM',
      isSafeToTransmit: false,
    },
    processingTime: { total: 12, ocr: 0, dom: 3, detection: 4, riskScoring: 2, redaction: 3 },
  };
}

describe('AgentInterface', () => {
  let agent: AgentInterface;

  beforeEach(() => {
    document.body.innerHTML = '';
    // jsdom cannot rasterize; stub toDataURL so the screenshot action returns data.
    HTMLCanvasElement.prototype.toDataURL = function () {
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    };
    agent = new AgentInterface();
  });

  it('returns null sanitized context before any scan', () => {
    expect(agent.getSanitizedContext()).toBeNull();
    expect(agent.getPageStructure()).toEqual({
      safeElements: [],
      safeForms: [],
      safeText: '',
      pageType: 'unknown',
    });
    expect(agent.getVisibleElements()).toEqual([]);
  });

  it('stores and returns the last scan result', () => {
    const result = makeScanResult();
    agent.storeScanResult(result);
    expect(agent.getLastScanResult()).toBe(result);
    expect(agent.getSanitizedContext()).toBe(result.sanitizedContext);
  });

  it('getPageStructure maps sanitized elements/forms and never leaks raw text', () => {
    agent.storeScanResult(makeScanResult());
    const structure = agent.getPageStructure();
    expect(structure.pageType).toBe('login');
    expect(structure.safeElements[0]).toMatchObject({ selector: '#email', role: 'textbox' });
    expect(structure.safeForms[0].label).toBe('Email address');
    expect(structure.safeText).not.toContain('alice@example.com');
  });

  it('getVisibleElements returns only visible interactive elements', () => {
    const result = makeScanResult();
    result.sanitizedContext.safeElements[0].isVisible = false;
    agent.storeScanResult(result);
    const visible = agent.getVisibleElements();
    expect(visible.length).toBe(1);
    expect(visible[0].selector).toBe('#signin');
  });

  it('getElementByDescription finds elements via fuzzy label match', () => {
    agent.storeScanResult(makeScanResult());
    const match = agent.getElementByDescription('the sign in button');
    expect(match).not.toBeNull();
    expect(match!.selector).toBe('#signin');
    expect(match!.rect.width).toBe(80);
  });

  it('getElementByDescription returns null for low-confidence matches', () => {
    agent.storeScanResult(makeScanResult());
    expect(agent.getElementByDescription('zzz zzz')).toBeNull();
  });

  it('performAction: get_context returns sanitized context', async () => {
    agent.storeScanResult(makeScanResult());
    const resp = await agent.performAction({ action: 'get_context' });
    expect(resp.success).toBe(true);
    expect(resp.context).toBeTruthy();
  });

  it('performAction: click dispatches on a real element', async () => {
    document.body.innerHTML = `<button id="btn">Go</button>`;
    const clicked = vi.fn();
    document.getElementById('btn')!.addEventListener('click', clicked);
    const resp = await agent.performAction({ action: 'click', target: '#btn' });
    expect(resp.success).toBe(true);
    expect(clicked).toHaveBeenCalled();
  });

  it('performAction: click on missing element fails cleanly', async () => {
    const resp = await agent.performAction({ action: 'click', target: '#nope' });
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('Element not found');
  });

  it('performAction: type sets input value without leaking through context', async () => {
    document.body.innerHTML = `<input id="ta" type="text">`;
    const resp = await agent.performAction({ action: 'type', target: '#ta', value: 'hello' });
    expect(resp.success).toBe(true);
    const input = document.getElementById('ta') as HTMLInputElement;
    expect(input.value).toBe('hello');
    agent.storeScanResult(makeScanResult());
    const after = agent.performAction({ action: 'get_context' });
    expect((await after).context?.safeText).not.toContain('hello');
  });

  it('performAction: type requires a target and value', async () => {
    document.body.innerHTML = `<input id="ta" type="text">`;
    const noTarget = await agent.performAction({ action: 'type', value: 'x' });
    expect(noTarget.success).toBe(false);
    const noValue = await agent.performAction({ action: 'type', target: '#ta' });
    expect(noValue.success).toBe(false);
    const missing = await agent.performAction({ action: 'type', target: '#zz', value: 'x' });
    expect(missing.success).toBe(false);
  });

  it('performAction: scroll succeeds defensively', async () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const resp = await agent.performAction({ action: 'scroll', target: 'down' });
    expect(resp.success).toBe(true);
    expect(scrollBy).not.toHaveBeenCalledWith();
    scrollBy.mockRestore();
  });

  it('performAction: screenshot returns before+after data URLs (fallback canvas)', async () => {
    const resp = await agent.performAction({ action: 'screenshot' });
    expect(resp.success).toBe(true);
    expect(resp.screenshot).toBeTruthy();
    expect(resp.screenshotBefore).toBeTruthy();
    expect(String(resp.screenshot).startsWith('data:image/png')).toBe(true);
    expect(String(resp.screenshotBefore).startsWith('data:image/png')).toBe(true);
  });

  it('performAction: screenshot with a stored scan reports a redaction booking flag', async () => {
    const result = makeScanResult(makeEntity({ bbox: { x: 0, y: 0, width: 4, height: 4 } }));
    agent.storeScanResult(result);
    const resp = await agent.performAction({ action: 'screenshot' });
    expect(resp.success).toBe(true);
    // Capture API is unavailable in jsdom, so the gray fallback canvas is returned;
    // the flag must still be a boolean and the before/after URLs returned.
    expect(typeof resp.redacted).toBe('boolean');
    expect(resp.screenshot).toBeTruthy();
    expect(resp.screenshotBefore).toBeTruthy();
  });

  it('performAction: scan and unknown actions are handled', async () => {
    const scan = await agent.performAction({ action: 'scan' });
    expect(scan.success).toBe(true);
    const unknown = await agent.performAction({ action: 'fly' as never });
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain('Unknown action');
  });

  it('persists screenshot before+after locally when chrome.runtime is present', async () => {
    const sent: Array<{ type: string; record: Record<string, unknown> }> = [];
    const stub = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as unknown as { chrome: { runtime: { sendMessage: (...a: unknown[]) => void } } }).chrome = {
      runtime: {
        sendMessage: (msg: unknown, cb: (r: { success?: boolean }) => void) => {
          sent.push(msg as { type: string; record: Record<string, unknown> });
          cb({ success: true });
        },
      },
    };
    try {
      const result = makeScanResult();
      agent.storeScanResult(result);
      const resp = await agent.performAction({ action: 'screenshot' });
      expect(resp.success).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('SAVE_SCREENSHOT');
      expect(sent[0].record.originalDataUrl).toBeTruthy();
      expect(sent[0].record.redactedDataUrl).toBeTruthy();
      expect(sent[0].record.url).toBe('https://example.com/');
      expect(sent[0].record.entityCount).toBe(1);
      // The raw email never travels to storage metadata.
      expect(JSON.stringify(sent[0].record)).not.toContain('alice@example.com');
    } finally {
      (globalThis as { chrome?: unknown }).chrome = undefined;
    }
  });

  it('does not attempt local storage when chrome.runtime is unavailable', async () => {
    (globalThis as { chrome?: unknown }).chrome = undefined;
    const resp = await agent.performAction({ action: 'screenshot' });
    expect(resp.success).toBe(true);
    expect(resp.screenshotBefore).toBeTruthy();
  });
});