import { describe, it, expect, vi, beforeEach } from 'vitest';

let worker: any;
let failCreate = false;

vi.mock('tesseract.js', () => ({
  createWorker: () =>
    failCreate ? Promise.reject(new Error('worker failed')) : Promise.resolve(worker),
}));

import { OCREngine } from '../../extension/src/perception/ocr-engine';

class StubImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

const FAKE_RESPONSE = {
  data: {
    text: 'hello world',
    words: [
      { text: 'hello', bbox: { x0: 1.2, y0: 3.4, x1: 50, y1: 20 }, confidence: 92.6, line_num: 1, block_num: 0, par_num: 0 },
      { text: 'world', bbox: { x0: 51, y0: 3.4, x1: 100, y1: 20 }, confidence: 88, line_num: 1, block_num: 0, par_num: 0 },
    ],
    lines: [{ text: 'hello world', bbox: { x0: 1, y0: 3, x1: 100, y1: 20 }, confidence: 90 }],
  },
};

function makeWorker(): any {
  return {
    loadLanguage: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    recognize: vi.fn().mockResolvedValue(JSON.parse(JSON.stringify(FAKE_RESPONSE))),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
}

describe('OCREngine', () => {
  beforeEach(() => {
    failCreate = false;
    worker = makeWorker();
  });

  it('initializes a tesseract worker for the chosen language', async () => {
    const engine = new OCREngine('eng');
    await engine.initialize();
    expect(worker.initialize).not.toHaveBeenCalled();
    await engine.terminate();
  });

  it('recognizes an image and maps words/lines to the OCRResult shape', async () => {
    const engine = new OCREngine('eng');
    await engine.initialize();
    const result = await engine.recognize('data:image/png;base64,AAAA');
    expect(worker.recognize).toHaveBeenCalledWith('data:image/png;base64,AAAA');

    expect(result.text).toBe('hello world');
    expect(result.words).toHaveLength(2);
    // x0=1.2 -> 1, y0=3.4 -> 3, width = 50-1.2 = 48.8 -> 49
    expect(result.words[0].bbox).toEqual({ x: 1, y: 3, width: 49, height: 17 });
    expect(result.words[0].confidence).toBe(92.6);
    expect(result.words[0].lineIndex).toBe(0); // line_num - 1
    expect(result.lines[0].bbox.x).toBe(1);
    expect(result.processingTime).toBeGreaterThanOrEqual(0);
  });

  it('returns an empty result when the worker never initialized', async () => {
    const engine = new OCREngine('eng');
    const result = await engine.recognize('data:image/png;base64,AAAA');
    expect(result).toEqual({ text: '', words: [], lines: [], processingTime: 0 });
  });

  it('returns an empty result when worker creation fails (graceful degradation)', async () => {
    failCreate = true;
    const engine = new OCREngine('eng');
    await engine.initialize();
    expect(worker.initialize).not.toHaveBeenCalled();
    const result = await engine.recognize('data:image/png;base64,AAAA');
    expect(result.text).toBe('');
    expect(result.words).toEqual([]);
  });

  it('returns an empty result when recognition throws', async () => {
    worker.recognize = vi.fn().mockRejectedValue(new Error('tesseract exploded'));
    const engine = new OCREngine('eng');
    await engine.initialize();
    const result = await engine.recognize('x');
    expect(result.text).toBe('');
    expect(result.words).toEqual([]);
    expect(result.processingTime).toBeGreaterThanOrEqual(0);
  });

  it('crops an ImageData region and offsets OCR boxes by the region origin', async () => {
    (globalThis as any).ImageData = StubImageData;
    worker.recognize = vi.fn().mockResolvedValue(JSON.parse(JSON.stringify(FAKE_RESPONSE)));

    const engine = new OCREngine('eng');
    await engine.initialize();

    const w = 40;
    const h = 24;
    const src = new StubImageData(new Uint8ClampedArray(w * h * 4), w, h);
    const region = { x: 10, y: 8, width: 8, height: 6 };

    const result = await engine.recognizeRegion(src, region);

    // 8x6 crop passed into the worker
    const crop = worker.recognize.mock.calls[0][0];
    expect(crop).toBeInstanceOf(StubImageData);
    expect(crop.width).toBe(8);
    expect(crop.height).toBe(6);

    // word bbox has region origin added
    expect(result.words[0].bbox.x).toBe(10 + 1);
    expect(result.words[0].bbox.y).toBe(8 + 3);
    expect(result.lines[0].bbox.x).toBe(10 + 1);
  });

  it('terminate stops and clears the worker', async () => {
    const engine = new OCREngine('eng');
    await engine.initialize();
    await engine.terminate();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    const result = await engine.recognize('x');
    expect(result.text).toBe('');
  });
});