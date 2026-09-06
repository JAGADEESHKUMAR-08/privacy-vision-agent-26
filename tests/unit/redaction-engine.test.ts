import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedactionEngine } from '../../extension/src/redaction/redaction-engine';
import {
  entity,
  domElement,
  boundingBox,
  redaction,
} from '../helpers/fixtures';
import { DetectedEntity, DOMElementInfo, BoundingBox } from '../../extension/src/types/index';

class MockCanvas {
  width = 100;
  height = 60;
  getContext = vi.fn(() => mockCtx);
}

function makeCtx(): any {
  return {
    canvas: { width: 100, height: 60 },
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(400) })),
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    measureText: vi.fn(() => ({ width: 20 })),
    fillText: vi.fn(),
  };
}

let mockCtx: any;

function canvasWithContext(): { canvas: MockCanvas; ctx: any } {
  const canvas = new MockCanvas();
  const ctx = makeCtx();
  mockCtx = ctx;
  return { canvas, ctx };
}

describe('RedactionEngine - Text redaction with entity replacement', () => {
  let engine: RedactionEngine;

  beforeEach(() => {
    engine = new RedactionEngine();
  });

  it('replaces an email value with the email placeholder', () => {
    const result = engine.redactText('Contact john@example.org today', [
      entity({ type: 'EMAIL', value: 'john@example.org' }),
    ]);
    expect(result).toBe('Contact [EMAIL_REDACTED] today');
  });

  it('replaces occurrences of multiple entity types', () => {
    const result = engine.redactText('Email a@a.org or call 555-123-4567', [
      entity({ type: 'EMAIL', value: 'a@a.org' }),
      entity({ type: 'PHONE', value: '555-123-4567' }),
    ]);
    expect(result).toBe('Email [EMAIL_REDACTED] or call [PHONE_REDACTED]');
  });

  it('uses the correct placeholder per category', () => {
    const result = engine.redactText('123-45-6789 4111 1111 1111 1111', [
      entity({ type: 'GOVERNMENT_ID', value: '123-45-6789' }),
      entity({ type: 'CREDIT_CARD', value: '4111 1111 1111 1111' }),
    ]);
    expect(result).toBe('[GOVID_REDACTED] [CC_REDACTED]');
  });

  it('handles empty text gracefully', () => {
    const result = engine.redactText('', [entity({ type: 'EMAIL', value: 'a@a.org' })]);
    expect(result).toBe('');
  });

  it('returns the original text when no entities are provided', () => {
    const text = 'No sensitive data here';
    expect(engine.redactText(text, [])).toBe(text);
  });

  it('handles special regex characters in entity values', () => {
    const result = engine.redactText('token abc.d+e*f(g)', [
      entity({ type: 'AUTH_TOKEN', value: 'abc.d+e*f(g)' }),
    ]);
    expect(result.includes('abc.d+e*f(g)')).toBe(false);
    expect(result).toBe('token [TOKEN_REDACTED]');
  });

  it('replaces all occurrences even repeats', () => {
    const result = engine.redactText('email a@a.org and again a@a.org', [
      entity({ type: 'EMAIL', value: 'a@a.org' }),
    ]);
    expect(result).toBe('email [EMAIL_REDACTED] and again [EMAIL_REDACTED]');
  });
});

describe('RedactionEngine - Tokenized value generation', () => {
  let engine: RedactionEngine;

  beforeEach(() => {
    engine = new RedactionEngine();
  });

  it('generates a token label from the category', () => {
    expect(engine.generateTokenizedValue('EMAIL', 0)).toBe('EMAIL_000');
    expect(engine.generateTokenizedValue('CREDIT_CARD', 0)).toBe('CREDIT_CARD_000');
    expect(engine.generateTokenizedValue('DATE_OF_BIRTH', 0)).toBe('DOB_000');
  });

  it('pads the index to three digits', () => {
    expect(engine.generateTokenizedValue('PHONE', 42)).toBe('PHONE_042');
    expect(engine.generateTokenizedValue('PHONE', 999)).toBe('PHONE_999');
  });

  it('increments tokens across indices', () => {
    expect(engine.generateTokenizedValue('EMAIL', 1)).toBe('EMAIL_001');
    expect(engine.generateTokenizedValue('EMAIL', 2)).toBe('EMAIL_002');
  });

  it('falls back to a default data label for unknown categories', () => {
    expect(engine.generateTokenizedValue('CUSTOM' as DetectedEntity['type'], 0)).toBe('DATA_000');
  });
});

describe('RedactionEngine - Blur/pixelate/mask on canvas', () => {
  let engine: RedactionEngine;

  beforeEach(() => {
    engine = new RedactionEngine();
  });

  it('applyBlur reads image data, mutates and writes it back', () => {
    const { ctx } = canvasWithContext();
    engine.applyBlur(ctx, boundingBox(10, 10, 20, 20), 10);
    expect(ctx.getImageData).toHaveBeenCalledWith(10, 10, 20, 20);
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
  });

  it('clamps blur rects to the canvas bounds', () => {
    const { ctx } = canvasWithContext();
    ctx.canvas.width = 100;
    ctx.canvas.height = 60;
    engine.applyBlur(ctx, boundingBox(95, 55, 20, 20), 10);
    const call = ctx.getImageData.mock.calls[0];
    expect(call[0] + call[2]).toBeLessThanOrEqual(100);
    expect(call[1] + call[3]).toBeLessThanOrEqual(60);
  });

  it('skips blur when the rect lies entirely outside the canvas', () => {
    const { ctx } = canvasWithContext();
    engine.applyBlur(ctx, boundingBox(200, 200, 10, 10), 10);
    expect(ctx.getImageData).not.toHaveBeenCalled();
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });

  it('applyPixelate reads, modifies and writes image data with block averaging', () => {
    const { ctx } = canvasWithContext();
    engine.applyPixelate(ctx, boundingBox(0, 0, 40, 30), 8);
    expect(ctx.getImageData).toHaveBeenCalled();
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
  });

  it('applyPixelate clamps pixel size', () => {
    const { ctx } = canvasWithContext();
    engine.applyPixelate(ctx, boundingBox(0, 0, 20, 20), 2);
    engine.applyPixelate(ctx, boundingBox(0, 0, 20, 20), 1);
    expect(ctx.getImageData).toHaveBeenCalledTimes(2);
  });

  it('applyMask fills a rectangle with the given color', () => {
    const { ctx } = canvasWithContext();
    engine.applyMask(ctx, boundingBox(5, 5, 30, 30), '#ff0000');
    expect(ctx.fillStyle).toBe('#ff0000');
    expect(ctx.fillRect).toHaveBeenCalledWith(5, 5, 30, 30);
  });

  it('applyMask uses default black color', () => {
    const { ctx } = canvasWithContext();
    engine.applyMask(ctx, boundingBox(5, 5, 30, 30));
    expect(ctx.fillStyle).toBe('#000000');
  });

  it('applyMask skips zero-sized regions', () => {
    const { ctx } = canvasWithContext();
    engine.applyMask(ctx, boundingBox(0, 0, 0, 0));
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

describe('RedactionEngine - Screenshot redaction methods', () => {
  let engine: RedactionEngine;

  beforeEach(() => {
    engine = new RedactionEngine();
  });

  it('masks entities with the mask method', () => {
    const { canvas, ctx } = canvasWithContext();
    engine.redactScreenshot(
      canvas as unknown as HTMLCanvasElement,
      [entity({ type: 'EMAIL', value: 'a@a.org', bbox: boundingBox(0, 0, 10, 10) })],
      { EMAIL: 'mask' },
    );
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillStyle).toBe('#000000');
  });

  it('applies blur method when configured', () => {
    const { canvas, ctx } = canvasWithContext();
    engine.redactScreenshot(
      canvas as unknown as HTMLCanvasElement,
      [entity({ type: 'NAME', value: 'John', bbox: boundingBox(0, 0, 10, 10) })],
      { NAME: 'blur' },
    );
    expect(ctx.getImageData).toHaveBeenCalled();
    expect(ctx.putImageData).toHaveBeenCalled();
  });

  it('applies pixelate method when configured', () => {
    const { canvas, ctx } = canvasWithContext();
    engine.redactScreenshot(
      canvas as unknown as HTMLCanvasElement,
      [entity({ type: 'PHONE', value: '555-123-4567', bbox: boundingBox(0, 0, 10, 10) })],
      { PHONE: 'pixelate' },
    );
    expect(ctx.getImageData).toHaveBeenCalled();
  });

  it('applies replace method which masks and draws an overlay label', () => {
    const { canvas, ctx } = canvasWithContext();
    const spyFillText = vi.fn();
    ctx.fillText = spyFillText;
    engine.redactScreenshot(
      canvas as unknown as HTMLCanvasElement,
      [{ ...entity({ type: 'EMAIL', bbox: boundingBox(0, 0, 40, 20), value: 'a@a.org' }) }],
      { EMAIL: 'replace' },
    );
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(spyFillText).toHaveBeenCalled();
  });

  it('applies tokenize method which masks and draws the token label', () => {
    const { canvas, ctx } = canvasWithContext();
    const spyFillText = vi.fn();
    ctx.fillText = spyFillText;
    engine.redactScreenshot(
      canvas as unknown as HTMLCanvasElement,
      [entity({ type: 'CREDIT_CARD', bbox: boundingBox(0, 0, 60, 25), value: '4111 1111 1111 1111' })],
      { CREDIT_CARD: 'tokenize' },
    );
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(spyFillText).toHaveBeenCalled();
  });

  it('defaults to mask when no method is specified', () => {
    const { canvas, ctx } = canvasWithContext();
    engine.redactScreenshot(
      canvas as unknown as HTMLCanvasElement,
      [entity({ type: 'EMAIL', value: 'a@a.org', bbox: boundingBox(0, 0, 10, 10) })],
    );
    expect(ctx.fillStyle).toBe('#000000');
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('skips entities with zero-size bounding boxes', () => {
    const { canvas, ctx } = canvasWithContext();
    engine.redactScreenshot(
      canvas as unknown as HTMLCanvasElement,
      [entity({ type: 'EMAIL', value: 'a@a.org', bbox: boundingBox(0, 0, 0, 0) })],
    );
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('returns the canvas unchanged when no 2d context is available', () => {
    const canvas = { width: 100, height: 60, getContext: vi.fn(() => null) };
    const result = engine.redactScreenshot(
      canvas as unknown as HTMLCanvasElement,
      [entity({ type: 'EMAIL', bbox: boundingBox(0, 0, 10, 10) })],
    );
    expect(result).toBe(canvas);
  });
});

describe('RedactionEngine - Redaction method selection per category', () => {
  let engine: RedactionEngine;

  beforeEach(() => {
    engine = new RedactionEngine();
  });

  it('uses per-category methods passed in', () => {
    const { canvas, ctx } = canvasWithContext();
    const methods: Record<string, string> = {
      EMAIL: 'pixelate',
      PHONE: 'mask',
      CREDIT_CARD: 'tokenize',
    };
    engine.redactScreenshot(
      canvas as unknown as HTMLCanvasElement,
      [
        entity({ type: 'EMAIL', value: 'a@a.org', bbox: boundingBox(0, 0, 10, 10) }),
        entity({ type: 'PHONE', value: '555-123-4567', bbox: boundingBox(20, 0, 10, 10) }),
        entity({ type: 'CREDIT_CARD', value: '4111 1111 1111 1111', bbox: boundingBox(40, 0, 10, 10) }),
      ],
      methods,
    );
    expect(ctx.getImageData).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('masks by default for categories without an explicit method', () => {
    const { canvas, ctx } = canvasWithContext();
    engine.redactScreenshot(
      canvas as unknown as HTMLCanvasElement,
      [entity({ type: 'ADDRESS', bbox: boundingBox(1, 1, 10, 10) })],
      { EMAIL: 'tokenize' },
    );
    expect(ctx.fillStyle).toBe('#000000');
  });
});

describe('RedactionEngine - DOM redaction', () => {
  let engine: RedactionEngine;

  beforeEach(() => {
    engine = new RedactionEngine();
  });

  function makeFakeDocument() {
    const classList = { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) };
    const fakeInput = {
      value: 'a@a.org',
      setAttribute: vi.fn(),
      _textContent: 'hidden',
      set textContent(v: string) { this._textContent = v; },
      get textContent() { return this._textContent; },
      hasAttribute: vi.fn(() => false),
      getAttribute: vi.fn(() => null),
    };
    const fakeButton = {
      _textContent: 'Sign in with a@a.org',
      setAttribute: vi.fn(),
      set textContent(v: string) { this._textContent = v; },
      get textContent() { return this._textContent; },
      hasAttribute: vi.fn(() => false),
      getAttribute: vi.fn(() => null),
    };
    const querySelector = vi.fn((selector: string) => {
      if (selector === '#email-input') return fakeInput;
      if (selector === '#signin-btn') return fakeButton;
      return null;
    });
    return { fakeInput, fakeButton, querySelector };
  }

  it('redacts an input element value via domSelector', () => {
    const doc = makeFakeDocument();
    (globalThis as any).document = {
      querySelector: doc.querySelector,
    };

    const elements: DOMElementInfo[] = [
      domElement({
        selector: '#email-input',
        isInput: true,
        value: 'a@a.org',
        text: 'a@a.org',
      }),
    ];
    const result = engine.redactDOM(elements, [
      entity({ type: 'EMAIL', value: 'a@a.org', domSelector: '#email-input' }),
    ]);

    expect(result.redactedCount).toBe(1);
    expect(doc.fakeInput.value).toBe('[EMAIL_REDACTED]');
    expect(doc.fakeInput.setAttribute).toHaveBeenCalledWith('data-pva-redacted', 'true');
    expect(result.changes[0].originalValue).toBe('a@a.org');
  });

  it('redacts button text content', () => {
    const doc = makeFakeDocument();
    (globalThis as any).document = { querySelector: doc.querySelector };

    const elements: DOMElementInfo[] = [
      domElement({
        selector: '#signin-btn',
        isButton: true,
        isInput: false,
        value: undefined,
        text: 'Sign in with a@a.org',
        tagName: 'button',
      }),
    ];
    const result = engine.redactDOM(elements, [
      entity({ type: 'EMAIL', value: 'a@a.org', domSelector: '#signin-btn' }),
    ]);

    expect(result.redactedCount).toBe(1);
    expect(doc.fakeButton.textContent).toBe('Sign in with [EMAIL_REDACTED]');
  });

  it('returns no changes when the selector is not present in the DOM', () => {
    (globalThis as any).document = { querySelector: vi.fn(() => null) };
    const elements: DOMElementInfo[] = [
      domElement({ selector: '#missing', isInput: true, value: 'x@x.org' }),
    ];
    const result = engine.redactDOM(elements, [
      entity({ type: 'EMAIL', value: 'x@x.org', domSelector: '#missing' }),
    ]);
    expect(result.redactedCount).toBe(0);
    expect(result.changes).toEqual([]);
  });

  it('only matches elements whose value matches when domSelector is absent', () => {
    const doc = makeFakeDocument();
    (globalThis as any).document = { querySelector: doc.querySelector };
    const elements: DOMElementInfo[] = [
      domElement({ selector: '#email-input', isInput: true, value: 'other@example.com', text: 'x' }),
    ];
    const result = engine.redactDOM(elements, [
      entity({ type: 'EMAIL', value: 'a@a.org' }),
    ]);
    expect(result.redactedCount).toBe(0);
  });
});

describe('RedactionEngine - helper behaviors', () => {
  let engine: RedactionEngine;

  beforeEach(() => {
    engine = new RedactionEngine();
  });

  it('does not redact when entity value is empty', () => {
    const result = engine.redactText('hello world', [entity({ type: 'EMAIL', value: '' })]);
    expect(result).toBe('hello world');
  });

  it('redacts entities regardless of insertion order overlap', () => {
    const text = 'first a@a.org then 555-123-4567';
    const result = engine.redactText(text, [
      entity({ type: 'PHONE', value: '555-123-4567' }),
      entity({ type: 'EMAIL', value: 'a@a.org' }),
    ]);
    expect(result).toBe('first [EMAIL_REDACTED] then [PHONE_REDACTED]');
  });

  it('uses a generic placeholder for categories without a mapping', () => {
    const result = engine.redactText('x CUSTOM_value', [
      entity({ type: 'CUSTOM' as DetectedEntity['type'], value: 'CUSTOM_value' }),
    ]);
    expect(result).toBe('x [REDACTED]');
  });
});