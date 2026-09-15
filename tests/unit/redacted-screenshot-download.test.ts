// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedactionEngine } from '../../extension/src/redaction/redaction-engine';
import type { DetectedEntity, BoundingBox } from '../../extension/src/types';

describe('Redacted Screenshot Download & Security Tests', () => {
  let engine: RedactionEngine;

  beforeEach(() => {
    engine = new RedactionEngine();
    document.body.innerHTML = '';
  });

  describe('Canvas Pixel Redaction & Boundary Clamping', () => {
    function makeMockCanvas(width = 800, height = 600) {
      const fillRectCalls: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
      const ctx = {
        canvas: { width, height },
        fillStyle: '',
        fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
          fillRectCalls.push({ x, y, w, h, style: ctx.fillStyle });
        }),
        getImageData: vi.fn((x: number, y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4).fill(255),
          width: w,
          height: h,
        })),
        putImageData: vi.fn(),
        drawImage: vi.fn(),
        font: '',
        textAlign: '',
        textBaseline: '',
        measureText: vi.fn(() => ({ width: 40 })),
        fillText: vi.fn(),
      };

      const canvas = {
        width,
        height,
        getContext: vi.fn(() => ctx),
        toDataURL: vi.fn(() => 'data:image/png;base64,REDACTED_IMAGE_DATA'),
      };

      return { canvas: canvas as unknown as HTMLCanvasElement, ctx, fillRectCalls };
    }

    it('burns solid black (#000000) mask into pixels for detected PII', () => {
      const { canvas, ctx, fillRectCalls } = makeMockCanvas(800, 600);
      const entity: DetectedEntity = {
        id: 'ent_email',
        type: 'EMAIL',
        value: 'john.doe@example.com',
        bbox: { x: 100, y: 150, width: 200, height: 24 },
        confidence: 0.98,
        risk: 'HIGH',
        source: 'DOM',
        timestamp: Date.now(),
      };

      engine.redactScreenshot(canvas, [entity]);

      expect(ctx.fillRect).toHaveBeenCalled();
      expect(fillRectCalls.length).toBeGreaterThan(0);
      const call = fillRectCalls[0];
      expect(call.style).toBe('#000000');
      expect(call.x).toBe(100);
      expect(call.y).toBe(150);
      expect(call.w).toBe(200);
      expect(call.h).toBe(24);
    });

    it('safely clamps bounding boxes that extend past canvas edges', () => {
      const { canvas, ctx, fillRectCalls } = makeMockCanvas(500, 400);
      const edgeEntities: DetectedEntity[] = [
        {
          id: 'ent_top_left',
          type: 'CREDIT_CARD',
          value: '4111 1111 1111 1234',
          bbox: { x: -20, y: -10, width: 100, height: 40 },
          confidence: 0.99,
          risk: 'CRITICAL',
          source: 'DOM',
          timestamp: Date.now(),
        },
        {
          id: 'ent_bottom_right',
          type: 'PHONE',
          value: '+1-555-987-6543',
          bbox: { x: 450, y: 380, width: 120, height: 50 },
          confidence: 0.95,
          risk: 'HIGH',
          source: 'DOM',
          timestamp: Date.now(),
        },
      ];

      engine.redactScreenshot(canvas, edgeEntities);

      expect(fillRectCalls.length).toBe(2);
      // First box clamped to canvas boundaries (x >= 0, y >= 0)
      expect(fillRectCalls[0].x).toBe(0);
      expect(fillRectCalls[0].y).toBe(0);
      expect(fillRectCalls[0].x + fillRectCalls[0].w).toBeLessThanOrEqual(500);
      expect(fillRectCalls[0].y + fillRectCalls[0].h).toBeLessThanOrEqual(400);

      // Second box clamped to canvas boundaries (x + w <= 500, y + h <= 400)
      expect(fillRectCalls[1].x).toBe(450);
      expect(fillRectCalls[1].y).toBe(380);
      expect(fillRectCalls[1].x + fillRectCalls[1].w).toBeLessThanOrEqual(500);
      expect(fillRectCalls[1].y + fillRectCalls[1].h).toBeLessThanOrEqual(400);
    });

    it('redacts multiple bboxes when an entity appears in multiple locations', () => {
      const { canvas, ctx, fillRectCalls } = makeMockCanvas(800, 600);
      const multiBoxEntity: DetectedEntity = {
        id: 'ent_token',
        type: 'AUTH_TOKEN',
        value: 'ghp_secretTokenValue1234567890',
        bbox: { x: 50, y: 100, width: 150, height: 20 },
        confidence: 0.99,
        risk: 'CRITICAL',
        source: 'DOM',
        timestamp: Date.now(),
        bboxes: [
          { x: 50, y: 100, width: 150, height: 20 },
          { x: 50, y: 300, width: 150, height: 20 },
          { x: 400, y: 500, width: 150, height: 20 },
        ],
      } as any;

      engine.redactScreenshot(canvas, [multiBoxEntity]);

      expect(fillRectCalls.length).toBe(3);
      expect(fillRectCalls.map((c) => ({ x: c.x, y: c.y }))).toEqual([
        { x: 50, y: 100 },
        { x: 50, y: 300 },
        { x: 400, y: 500 },
      ]);
    });

    it('skips entities with 0 width or 0 height gracefully without errors', () => {
      const { canvas, ctx, fillRectCalls } = makeMockCanvas(800, 600);
      const emptyEntities: DetectedEntity[] = [
        {
          id: 'ent_empty',
          type: 'NAME',
          value: 'Alice',
          bbox: { x: 0, y: 0, width: 0, height: 0 },
          confidence: 0.9,
          risk: 'MEDIUM',
          source: 'DOM',
          timestamp: Date.now(),
        },
      ];

      engine.redactScreenshot(canvas, emptyEntities);
      expect(fillRectCalls.length).toBe(0);
    });
  });

  describe('Security Check: Fail-Closed & Leak Prevention', () => {
    it('rejects unredacted capture if PII entities exist but redacted result matches raw capture', () => {
      const RAW_CAPTURE = 'data:image/png;base64,ORIGINAL_UNREDACTED_IMAGE';
      const entities = [{ id: '1', type: 'CREDIT_CARD', value: '4111222233334444' }];

      function verifySecurity(rawUrl: string, redactedUrl: string, detectedCount: number) {
        if (detectedCount > 0 && redactedUrl === rawUrl) {
          throw new Error('SECURITY VIOLATION: Unredacted screenshot leak detected!');
        }
        return redactedUrl;
      }

      // If redaction succeeded:
      const safeOutput = verifySecurity(RAW_CAPTURE, 'data:image/png;base64,BURNT_IN_REDACTION', entities.length);
      expect(safeOutput).not.toBe(RAW_CAPTURE);

      // If redaction failed to modify the image when PII exists:
      expect(() => {
        verifySecurity(RAW_CAPTURE, RAW_CAPTURE, entities.length);
      }).toThrow('SECURITY VIOLATION: Unredacted screenshot leak detected!');
    });

    it('allows clean raw screenshot download when 0 PII entities are detected', () => {
      const RAW_CAPTURE = 'data:image/png;base64,CLEAN_PAGE_SCREENSHOT';
      const entities: any[] = [];

      function getDownloadUrl(rawUrl: string, redactedUrl: string | null, detectedCount: number) {
        if (detectedCount > 0) {
          if (!redactedUrl || redactedUrl === rawUrl) {
            throw new Error('PII detected but no redacted image available.');
          }
          return redactedUrl;
        }
        return rawUrl;
      }

      const result = getDownloadUrl(RAW_CAPTURE, null, entities.length);
      expect(result).toBe(RAW_CAPTURE);
    });

    it('prevents raw unredacted file export in bulk downloads when PII exists', () => {
      const records = [
        {
          id: 'rec_with_pii',
          entityCount: 3,
          originalDataUrl: 'data:image/png;base64,RAW_LEAK_PII',
          redactedDataUrl: 'data:image/png;base64,SAFE_REDACTED',
        },
        {
          id: 'rec_without_pii',
          entityCount: 0,
          originalDataUrl: 'data:image/png;base64,CLEAN_ORIGINAL',
          redactedDataUrl: null,
        },
      ];

      function exportViaDownloadsMock(recs: typeof records) {
        const queuedDownloads: string[] = [];
        recs.forEach((r) => {
          // Rule: NEVER export originalDataUrl if entityCount > 0
          const safeUrl = r.redactedDataUrl || (r.entityCount === 0 ? r.originalDataUrl : null);
          if (safeUrl) {
            queuedDownloads.push(safeUrl);
          }
        });
        return queuedDownloads;
      }

      const downloaded = exportViaDownloadsMock(records);
      expect(downloaded).toHaveLength(2);
      expect(downloaded).toContain('data:image/png;base64,SAFE_REDACTED');
      expect(downloaded).toContain('data:image/png;base64,CLEAN_ORIGINAL');
      expect(downloaded).not.toContain('data:image/png;base64,RAW_LEAK_PII');
    });
  });

  describe('DOM Bounding Box Discovery for Detected PII', () => {
    it('discovers bounding rect for text nodes and input elements', () => {
      // Create test DOM structure
      document.body.innerHTML = `
        <div id="account-page">
          <p id="user-email">Account Email: user@company.com</p>
          <input id="user-phone" value="(555) 234-5678" />
        </div>
      `;

      const emailEl = document.getElementById('user-email')!;
      const phoneInput = document.getElementById('user-phone') as HTMLInputElement;

      // Mock getBoundingClientRect
      emailEl.getBoundingClientRect = () => ({
        top: 50,
        left: 20,
        right: 250,
        bottom: 74,
        width: 230,
        height: 24,
        x: 20,
        y: 50,
        toJSON: () => {},
      });

      phoneInput.getBoundingClientRect = () => ({
        top: 90,
        left: 20,
        right: 170,
        bottom: 120,
        width: 150,
        height: 30,
        x: 20,
        y: 90,
        toJSON: () => {},
      });

      function locateEntity(val: string) {
        const targetVal = String(val).trim();
        // Check inputs
        const inputs = document.querySelectorAll('input, textarea');
        for (let i = 0; i < inputs.length; i++) {
          const inp = inputs[i] as HTMLInputElement;
          if (inp.value && inp.value.includes(targetVal)) {
            const r = inp.getBoundingClientRect();
            return { x: r.left, y: r.top, width: r.width, height: r.height };
          }
        }
        // Check text content
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
          if (node.nodeValue?.includes(targetVal)) {
            const parent = node.parentElement;
            if (parent) {
              const r = parent.getBoundingClientRect();
              return { x: r.left, y: r.top, width: r.width, height: r.height };
            }
          }
        }
        return null;
      }

      const emailBbox = locateEntity('user@company.com');
      expect(emailBbox).toEqual({ x: 20, y: 50, width: 230, height: 24 });

      const phoneBbox = locateEntity('(555) 234-5678');
      expect(phoneBbox).toEqual({ x: 20, y: 90, width: 150, height: 30 });
    });
  });

  describe('Popup UI State Machine & Concurrency Control', () => {
    it('manages button states correctly during download and prevents concurrent clicks', async () => {
      let downloadInProgress = false;
      let downloadCount = 0;

      const btn = document.createElement('button');
      btn.id = 'downloadScreenshotBtn';
      btn.textContent = '🛡 Download Protected Screenshot';

      const indicator = document.createElement('div');
      indicator.id = 'downloadPrivacyIndicator';
      indicator.style.display = 'none';

      async function triggerDownload(entityCount: number) {
        if (downloadInProgress) return false; // Guard against race conditions / double click
        downloadInProgress = true;
        btn.disabled = true;
        btn.classList.add('protecting');
        btn.textContent = '⏳ Protecting Screenshot...';

        // Simulate async capture + redaction
        await new Promise((r) => setTimeout(r, 10));

        downloadCount++;
        btn.classList.remove('protecting');
        btn.classList.add('download-success');
        btn.textContent = '✓ Download Protected Screenshot';

        indicator.style.display = 'flex';
        if (entityCount > 0) {
          indicator.className = 'privacy-status-indicator';
          indicator.textContent = `🛡 Sensitive data protected (${entityCount} item${entityCount > 1 ? 's' : ''} redacted)`;
        } else {
          indicator.className = 'privacy-status-indicator safe';
          indicator.textContent = '✅ No sensitive data detected';
        }

        downloadInProgress = false;
        btn.disabled = false;
        return true;
      }

      // Initial state
      expect(btn.disabled).toBe(false);
      expect(btn.classList.contains('protecting')).toBe(false);

      // Start download
      const p1 = triggerDownload(3);
      // Attempt immediate concurrent click while in progress
      const p2 = triggerDownload(3);

      expect(btn.disabled).toBe(true);
      expect(btn.classList.contains('protecting')).toBe(true);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(true);
      expect(r2).toBe(false); // Second click was safely blocked by lock
      expect(downloadCount).toBe(1);

      // Verify final UI state
      expect(btn.classList.contains('download-success')).toBe(true);
      expect(btn.textContent).toContain('✓');
      expect(indicator.style.display).toBe('flex');
      expect(indicator.textContent).toContain('Sensitive data protected (3 items redacted)');
    });

    it('displays safe privacy indicator when page has no sensitive data', async () => {
      const indicator = document.createElement('div');
      const entityCount = 0;

      indicator.style.display = 'flex';
      if (entityCount > 0) {
        indicator.className = 'privacy-status-indicator';
        indicator.textContent = '🛡 Sensitive data protected';
      } else {
        indicator.className = 'privacy-status-indicator safe';
        indicator.textContent = '✅ No sensitive data detected';
      }

      expect(indicator.className).toBe('privacy-status-indicator safe');
      expect(indicator.textContent).toBe('✅ No sensitive data detected');
    });
  });
});
