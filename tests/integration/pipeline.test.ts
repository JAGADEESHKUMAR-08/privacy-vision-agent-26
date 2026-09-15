// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tesseract is mocked so no worker/core/traineddata is required in tests.
let ocrRecognition: any;

vi.mock('tesseract.js', () => ({
  createWorker: async () => ({
    loadLanguage: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    recognize: vi.fn().mockImplementation(async () => ocrRecognition),
    terminate: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { ScanOrchestrator } from '../../extension/src/privacy/scan-orchestrator';
import { DetectedEntity } from '../../extension/src/types/index';

function bankingPage(): void {
  document.body.innerHTML = `
    <h1>Bank of Test</h1>
    <p>Welcome john.smith@example.org. Your phone is 555-123-4567.</p>
    <div>Card on file: 4111 1111 1111 1111</div>
    <form>
      <label>Username <input type="text" id="username" value="jsmith88"></label>
      <label>Password <input type="password" id="password" value="correcthorsebatt"></label>
    </form>
    <button type="submit">Log in</button>
  `;
}

function barePage(): void {
  document.body.innerHTML = `
    <h1>Plain page</h1>
    <p>Nothing sensitive here, just a sunny afternoon.</p>
  `;
}

describe('ScanOrchestrator integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    ocrRecognition = {
      data: {
        text: '',
        words: [],
        lines: [],
      },
    };
    delete (window as any).chrome;
  });

  it('runs a full scan and returns a sanitized, redacted context without leaks', async () => {
    bankingPage();
    const orchestrator = new ScanOrchestrator();
    const result = await orchestrator.scanPage();

    expect(result.entities.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(result.sanitizedContext);
    // The pipeline must never ship raw sensitive values to an AI context.
    expect(serialized).not.toContain('john.smith@example.org');
    expect(serialized).not.toContain('4111 1111 1111 1111');
    expect(serialized).not.toContain('555-123-4567');
    expect(serialized).not.toContain('correcthorsebatt');
    expect(result.sanitizedContext.riskLevel).toBeDefined();
    expect(result.privacyReport.overallRisk).toBeDefined();
    expect(result.processingTime.total).toBeGreaterThanOrEqual(0);
    await orchestrator.shutdown();
  });

  it('detects PII from DOM text and form fields', async () => {
    bankingPage();
    const orchestrator = new ScanOrchestrator();
    const result = await orchestrator.scanPage();
    const types = result.entities.map((e) => e.type);
    expect(types).toContain('EMAIL');
    expect(types).toContain('PHONE');
    expect(types).toContain('CREDIT_CARD');
    await orchestrator.shutdown();
  });

  it('returns LOW/empty result on a benign page', async () => {
    barePage();
    const orchestrator = new ScanOrchestrator();
    const result = await orchestrator.scanPage();
    expect(result.entities).toEqual([]);
    expect(result.privacyReport.overallRisk).toBe('LOW');
    await orchestrator.shutdown();
  });

  it('produces OCR-sourced entities from recognized text with word bboxes', async () => {
    barePage();
    ocrRecognition = {
      data: {
        text: 'Card 4111 1111 1111 1111 call 555-123-4567',
        words: [
          { text: 'Card', bbox: { x0: 1, y0: 4, x1: 30, y1: 16 }, confidence: 90, line_num: 1, block_num: 0, par_num: 0 },
          { text: '4111111111111111', bbox: { x0: 31, y0: 4, x1: 130, y1: 16 }, confidence: 95, line_num: 1, block_num: 0, par_num: 0 },
          { text: 'call', bbox: { x0: 1, y0: 20, x1: 25, y1: 32 }, confidence: 90, line_num: 2, block_num: 0, par_num: 0 },
          { text: '555-123-4567', bbox: { x0: 26, y0: 20, x1: 90, y1: 32 }, confidence: 93, line_num: 2, block_num: 0, par_num: 0 },
        ],
        lines: [
          { text: 'Card 4111 1111 1111 1111', bbox: { x0: 1, y0: 4, x1: 130, y1: 16 }, confidence: 92 },
          { text: 'call 555-123-4567', bbox: { x0: 1, y0: 20, x1: 90, y1: 32 }, confidence: 91 },
        ],
      },
    };
    const orchestrator = new ScanOrchestrator();
    const entities: DetectedEntity[] = await orchestrator.scanOCR('data:image/png;base64,AAAA');
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.every((e) => e.source === 'OCR')).toBe(true);
    const card = entities.find((e) => e.type === 'CREDIT_CARD');
    expect(card).toBeTruthy();
    expect(card!.bbox.width).toBeGreaterThan(0);
    await orchestrator.shutdown();
  });

  it('records REDACT firewall actions during a scan', async () => {
    bankingPage();
    const orchestrator = new ScanOrchestrator();
    await orchestrator.scanPage();
    const actions = orchestrator.getFirewall().getActions();
    expect(actions.some((a) => a.type === 'REDACT')).toBe(true);
    await orchestrator.shutdown();
  });

  it('exposes the most recent scan result for the agent interface', async () => {
    bankingPage();
    const orchestrator = new ScanOrchestrator();
    const result = await orchestrator.scanPage();
    expect(orchestrator.getLastScanResult()).toBe(result);
    await orchestrator.shutdown();
  });
});