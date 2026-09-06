import { BoundingBox } from '../types/index';

export interface OCRWord {
  text: string;
  bbox: BoundingBox;
  confidence: number;
  lineIndex: number;
}

export interface OCRLine {
  text: string;
  bbox: BoundingBox;
  confidence: number;
}

export interface OCRResult {
  text: string;
  words: OCRWord[];
  lines: OCRLine[];
  processingTime: number;
}

interface TesseractWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
  line_num: number;
  block_num: number;
  par_num: number;
}

interface TesseractLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

interface TesseractResponse {
  data: {
    text: string;
    words: TesseractWord[];
    lines: TesseractLine[];
  };
}

interface TesseractWorker {
  loadLanguage(lang: string): Promise<void>;
  initialize(lang: string): Promise<void>;
  recognize(image: string | ImageData | HTMLCanvasElement): Promise<TesseractResponse>;
  terminate(): Promise<void>;
}

function createEmptyResult(): OCRResult {
  return { text: '', words: [], lines: [], processingTime: 0 };
}

function toBoundingBox(
  bbox: { x0: number; y0: number; x1: number; y1: number },
): BoundingBox {
  const x = Math.max(0, Math.round(bbox.x0));
  const y = Math.max(0, Math.round(bbox.y0));
  return {
    x,
    y,
    width: Math.max(0, Math.round(bbox.x1 - bbox.x0)),
    height: Math.max(0, Math.round(bbox.y1 - bbox.y0)),
  };
}

export class OCREngine {
  private worker: TesseractWorker | null = null;
  private initialized = false;
  private language: string;

  constructor(language: string = 'eng') {
    this.language = language;
  }

  async initialize(): Promise<void> {
    if (this.initialized && this.worker) return;

    try {
      const Tesseract = await import('tesseract.js');
      const worker = await Tesseract.createWorker(this.language);
      this.worker = worker as unknown as TesseractWorker;
      this.initialized = true;
    } catch (err) {
      console.warn(
        '[OCREngine] Tesseract.js unavailable, OCR features disabled:',
        err instanceof Error ? err.message : err,
      );
      this.worker = null;
      this.initialized = false;
    }
  }

  async recognize(
    imageSource: string | ImageData | HTMLCanvasElement,
  ): Promise<OCRResult> {
    if (!this.worker || !this.initialized) {
      return createEmptyResult();
    }

    const start = performance.now();

    try {
      const response = await this.worker.recognize(imageSource);
      const elapsed = performance.now() - start;

      const lines: OCRLine[] = response.data.lines.map((line) => ({
        text: line.text,
        bbox: toBoundingBox(line.bbox),
        confidence: Math.round(line.confidence * 100) / 100,
      }));

      const words: OCRWord[] = response.data.words.map((word) => ({
        text: word.text,
        bbox: toBoundingBox(word.bbox),
        confidence: Math.round(word.confidence * 100) / 100,
        lineIndex: Math.max(0, word.line_num - 1),
      }));

      return {
        text: response.data.text,
        words,
        lines,
        processingTime: Math.round(elapsed),
      };
    } catch (err) {
      console.error(
        '[OCREngine] Recognition failed:',
        err instanceof Error ? err.message : err,
      );
      return { ...createEmptyResult(), processingTime: Math.round(performance.now() - start) };
    }
  }

  async recognizeRegion(
    imageSource: string | ImageData | HTMLCanvasElement,
    region: BoundingBox,
  ): Promise<OCRResult> {
    if (!this.worker || !this.initialized) {
      return createEmptyResult();
    }

    const start = performance.now();

    try {
      let cropped: HTMLCanvasElement | ImageData | string = imageSource;

      if (typeof HTMLCanvasElement !== 'undefined' && imageSource instanceof HTMLCanvasElement) {
        const { x, y, width, height } = region;
        const sx = Math.max(0, Math.round(x));
        const sy = Math.max(0, Math.round(y));
        const sw = Math.min(Math.round(width), imageSource.width - sx);
        const sh = Math.min(Math.round(height), imageSource.height - sy);

        if (sw > 0 && sh > 0) {
          const offscreen = document.createElement('canvas');
          offscreen.width = sw;
          offscreen.height = sh;
          const offCtx = offscreen.getContext('2d');
          if (offCtx) {
            offCtx.drawImage(
              imageSource,
              sx, sy, sw, sh,
              0, 0, sw, sh,
            );
            cropped = offscreen;
          }
        }
      } else if (typeof ImageData !== 'undefined' && imageSource instanceof ImageData) {
        const { x, y, width, height } = region;
        const sx = Math.max(0, Math.round(x));
        const sy = Math.max(0, Math.round(y));
        const sw = Math.min(Math.round(width), imageSource.width - sx);
        const sh = Math.min(Math.round(height), imageSource.height - sy);

        if (sw > 0 && sh > 0 && typeof ImageData !== 'undefined') {
          const srcData = imageSource.data;
          const dstData = new Uint8ClampedArray(sw * sh * 4);
          for (let row = 0; row < sh; row++) {
            const srcOffset = ((sy + row) * imageSource.width + sx) * 4;
            const dstOffset = row * sw * 4;
            for (let col = 0; col < sw; col++) {
              const si = srcOffset + col * 4;
              const di = dstOffset + col * 4;
              dstData[di] = srcData[si];
              dstData[di + 1] = srcData[si + 1];
              dstData[di + 2] = srcData[si + 2];
              dstData[di + 3] = srcData[si + 3];
            }
          }
          cropped = new ImageData(dstData, sw, sh);
        }
      }

      const response = await this.worker.recognize(cropped);
      const elapsed = performance.now() - start;

      const offsetX = Math.max(0, Math.round(region.x));
      const offsetY = Math.max(0, Math.round(region.y));

      const lines: OCRLine[] = response.data.lines.map((line) => ({
        text: line.text,
        bbox: {
          x: toBoundingBox(line.bbox).x + offsetX,
          y: toBoundingBox(line.bbox).y + offsetY,
          width: toBoundingBox(line.bbox).width,
          height: toBoundingBox(line.bbox).height,
        },
        confidence: Math.round(line.confidence * 100) / 100,
      }));

      const words: OCRWord[] = response.data.words.map((word) => ({
        text: word.text,
        bbox: {
          x: toBoundingBox(word.bbox).x + offsetX,
          y: toBoundingBox(word.bbox).y + offsetY,
          width: toBoundingBox(word.bbox).width,
          height: toBoundingBox(word.bbox).height,
        },
        confidence: Math.round(word.confidence * 100) / 100,
        lineIndex: Math.max(0, word.line_num - 1),
      }));

      return {
        text: response.data.text,
        words,
        lines,
        processingTime: Math.round(elapsed),
      };
    } catch (err) {
      console.error(
        '[OCREngine] Region recognition failed:',
        err instanceof Error ? err.message : err,
      );
      return { ...createEmptyResult(), processingTime: Math.round(performance.now() - start) };
    }
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch {
        // ignore cleanup errors
      }
      this.worker = null;
      this.initialized = false;
    }
  }
}
