import { BoundingBox, DetectedEntity, DOMElementInfo, PIICategory } from '../types/index';

export interface DOMRedactionResult {
  changes: Array<{ selector: string; originalValue: string; redactedValue: string }>;
  redactedCount: number;
}

const CATEGORY_LABEL: Record<PIICategory, string> = {
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  NAME: 'NAME',
  ADDRESS: 'ADDRESS',
  PASSWORD: 'PASSWORD',
  USERNAME: 'USERNAME',
  CREDIT_CARD: 'CREDIT_CARD',
  BANK_ACCOUNT: 'BANK_ACCOUNT',
  API_KEY: 'API_KEY',
  AUTH_TOKEN: 'AUTH_TOKEN',
  DATE_OF_BIRTH: 'DOB',
  GOVERNMENT_ID: 'GOVID',
  MEDICAL_ID: 'MEDID',
  FINANCIAL_DATA: 'FIN',
  PRIVATE_DOCUMENT_CONTENT: 'DOC',
};

const PLACEHOLDER: Record<PIICategory, string> = {
  EMAIL: '[EMAIL_REDACTED]',
  PHONE: '[PHONE_REDACTED]',
  NAME: '[NAME_REDACTED]',
  ADDRESS: '[ADDRESS_REDACTED]',
  PASSWORD: '[PASSWORD_REDACTED]',
  USERNAME: '[USERNAME_REDACTED]',
  CREDIT_CARD: '[CC_REDACTED]',
  BANK_ACCOUNT: '[ACCOUNT_REDACTED]',
  API_KEY: '[API_KEY_REDACTED]',
  AUTH_TOKEN: '[TOKEN_REDACTED]',
  DATE_OF_BIRTH: '[DOB_REDACTED]',
  GOVERNMENT_ID: '[GOVID_REDACTED]',
  MEDICAL_ID: '[MEDID_REDACTED]',
  FINANCIAL_DATA: '[FIN_REDACTED]',
  PRIVATE_DOCUMENT_CONTENT: '[DOC_REDACTED]',
};

function clampRect(
  bbox: BoundingBox,
  canvasW: number,
  canvasH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sx = Math.max(0, Math.round(bbox.x));
  const sy = Math.max(0, Math.round(bbox.y));
  const ex = Math.min(canvasW, Math.round(bbox.x + bbox.width));
  const ey = Math.min(canvasH, Math.round(bbox.y + bbox.height));
  return { sx, sy, sw: Math.max(0, ex - sx), sh: Math.max(0, ey - sy) };
}

export class RedactionEngine {
  async redactScreenshotDataUrl(
    dataUrl: string,
    entities: DetectedEntity[],
    methods?: Record<PIICategory, string>,
  ): Promise<string> {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      throw new Error('Screenshot redaction requires a browser document');
    }

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const loadedImage = new Image();
      loadedImage.onload = () => resolve(loadedImage);
      loadedImage.onerror = () => reject(new Error('Failed to decode screenshot'));
      loadedImage.src = dataUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d');
    if (!context || canvas.width <= 0 || canvas.height <= 0) {
      throw new Error('Failed to create screenshot redaction canvas');
    }

    context.drawImage(image, 0, 0);
    this.redactScreenshot(canvas, entities, methods);
    return canvas.toDataURL('image/png');
  }

  redactScreenshot(
    canvas: HTMLCanvasElement,
    entities: DetectedEntity[],
    methods?: Record<PIICategory, string>,
  ): HTMLCanvasElement {
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    for (const entity of entities) {
      if (entity.bbox.width <= 0 || entity.bbox.height <= 0) continue;

      const method = methods?.[entity.type] ?? 'mask';

      switch (method) {
        case 'blur':
          this.applyBlur(ctx, entity.bbox, 10);
          break;
        case 'pixelate':
          this.applyPixelate(ctx, entity.bbox, 8);
          break;
        case 'mask':
          this.applyMask(ctx, entity.bbox, '#000000');
          break;
        case 'replace':
          this.applyMask(ctx, entity.bbox, '#cccccc');
          this.drawTextOverlay(ctx, entity.bbox, `[${CATEGORY_LABEL[entity.type]}]`);
          break;
        case 'tokenize':
          this.applyMask(ctx, entity.bbox, '#e0e0e0');
          this.drawTextOverlay(
            ctx,
            entity.bbox,
            this.generateTokenizedValue(entity.type, 0),
          );
          break;
        default:
          this.applyMask(ctx, entity.bbox, '#000000');
          break;
      }
    }

    return canvas;
  }

  redactText(text: string, entities: DetectedEntity[]): string {
    if (!entities.length) return text;

    const sorted = [...entities].sort(
      (a, b) => {
        const idxA = text.indexOf(a.value);
        const idxB = text.indexOf(b.value);
        return (idxA === -1 ? Infinity : idxA) - (idxB === -1 ? Infinity : idxB);
      },
    );

    let result = text;

    for (const entity of sorted) {
      if (!entity.value || entity.value.length === 0) continue;

      const escaped = entity.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const placeholder = PLACEHOLDER[entity.type] ?? '[REDACTED]';

      try {
        result = result.replace(new RegExp(escaped, 'g'), placeholder);
      } catch {
        // Fallback: simple string replace
        while (result.includes(entity.value)) {
          result = result.replace(entity.value, placeholder);
        }
      }
    }

    return result;
  }

  redactDOM(elements: DOMElementInfo[], entities: DetectedEntity[]): DOMRedactionResult {
    const changes: DOMRedactionResult['changes'] = [];

    for (const entity of entities) {
      if (!entity.value || entity.value.length === 0) continue;

      for (const el of elements) {
        if (entity.domSelector && el.selector !== entity.domSelector) continue;
        if (!entity.domSelector) {
          const hasValue = el.value === entity.value || el.text === entity.value;
          if (!hasValue) continue;
        }

        const placeholder = PLACEHOLDER[entity.type] ?? '[REDACTED]';
        const originalValue = el.value ?? el.text;

        try {
          const domEl = document.querySelector(el.selector);
          if (!domEl) continue;

          if (el.isInput || el.tagName.toLowerCase() === 'input') {
            const input = domEl as HTMLInputElement;
            if (input.value === entity.value || originalValue === entity.value) {
              input.value = placeholder;
              input.setAttribute('data-pva-redacted', 'true');
              changes.push({
                selector: el.selector,
                originalValue: entity.value,
                redactedValue: placeholder,
              });
            }
          } else if (el.isButton || el.isLink) {
            if (domEl.textContent?.includes(entity.value)) {
              domEl.textContent = domEl.textContent.replace(entity.value, placeholder);
              domEl.setAttribute('data-pva-redacted', 'true');
              changes.push({
                selector: el.selector,
                originalValue: entity.value,
                redactedValue: placeholder,
              });
            }
          } else {
            if (domEl.textContent?.includes(entity.value)) {
              domEl.textContent = domEl.textContent.replace(entity.value, placeholder);
              domEl.setAttribute('data-pva-redacted', 'true');
              changes.push({
                selector: el.selector,
                originalValue: entity.value,
                redactedValue: placeholder,
              });
            }
          }
        } catch {
          // selector may be invalid or element removed from DOM
        }
      }
    }

    return { changes, redactedCount: changes.length };
  }

  applyBlur(
    ctx: CanvasRenderingContext2D,
    bbox: BoundingBox,
    radius: number = 10,
  ): void {
    const { sx, sy, sw, sh } = clampRect(bbox, ctx.canvas.width, ctx.canvas.height);
    if (sw <= 0 || sh <= 0) return;

    const imageData = ctx.getImageData(sx, sy, sw, sh);
    const data = imageData.data;
    const width = sw;
    const height = sh;
    const r = Math.max(1, Math.min(radius, 30));

    const copy = new Uint8ClampedArray(data);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let aSum = 0;
        let count = 0;

        const yStart = Math.max(0, y - r);
        const yEnd = Math.min(height - 1, y + r);
        const xStart = Math.max(0, x - r);
        const xEnd = Math.min(width - 1, x + r);

        for (let ky = yStart; ky <= yEnd; ky++) {
          for (let kx = xStart; kx <= xEnd; kx++) {
            const idx = (ky * width + kx) * 4;
            rSum += copy[idx];
            gSum += copy[idx + 1];
            bSum += copy[idx + 2];
            aSum += copy[idx + 3];
            count++;
          }
        }

        const idx = (y * width + x) * 4;
        data[idx] = (rSum / count) | 0;
        data[idx + 1] = (gSum / count) | 0;
        data[idx + 2] = (bSum / count) | 0;
        data[idx + 3] = (aSum / count) | 0;
      }
    }

    ctx.putImageData(imageData, sx, sy);
  }

  applyPixelate(
    ctx: CanvasRenderingContext2D,
    bbox: BoundingBox,
    pixelSize: number = 10,
  ): void {
    const { sx, sy, sw, sh } = clampRect(bbox, ctx.canvas.width, ctx.canvas.height);
    if (sw <= 0 || sh <= 0) return;

    const ps = Math.max(2, Math.round(pixelSize));

    const imageData = ctx.getImageData(sx, sy, sw, sh);
    const data = imageData.data;
    const width = sw;
    const height = sh;

    for (let blockY = 0; blockY < height; blockY += ps) {
      for (let blockX = 0; blockX < width; blockX += ps) {
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;

        const bEndY = Math.min(blockY + ps, height);
        const bEndX = Math.min(blockX + ps, width);

        for (let y = blockY; y < bEndY; y++) {
          for (let x = blockX; x < bEndX; x++) {
            const idx = (y * width + x) * 4;
            rSum += data[idx];
            gSum += data[idx + 1];
            bSum += data[idx + 2];
            count++;
          }
        }

        const rAvg = (rSum / count) | 0;
        const gAvg = (gSum / count) | 0;
        const bAvg = (bSum / count) | 0;

        for (let y = blockY; y < bEndY; y++) {
          for (let x = blockX; x < bEndX; x++) {
            const idx = (y * width + x) * 4;
            data[idx] = rAvg;
            data[idx + 1] = gAvg;
            data[idx + 2] = bAvg;
          }
        }
      }
    }

    ctx.putImageData(imageData, sx, sy);
  }

  applyMask(
    ctx: CanvasRenderingContext2D,
    bbox: BoundingBox,
    color: string = '#000000',
  ): void {
    const { sx, sy, sw, sh } = clampRect(bbox, ctx.canvas.width, ctx.canvas.height);
    if (sw <= 0 || sh <= 0) return;

    ctx.fillStyle = color;
    ctx.fillRect(sx, sy, sw, sh);
  }

  generateTokenizedValue(type: PIICategory, index: number): string {
    const label = CATEGORY_LABEL[type] ?? 'DATA';
    const padded = String(index).padStart(3, '0');
    return `${label}_${padded}`;
  }

  private drawTextOverlay(ctx: CanvasRenderingContext2D, bbox: BoundingBox, text: string): void {
    const { sx, sy, sw, sh } = clampRect(bbox, ctx.canvas.width, ctx.canvas.height);
    if (sw <= 0 || sh <= 0) return;

    const fontSize = Math.max(10, Math.min(14, sh * 0.5));
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const metrics = ctx.measureText(text);
    const textW = metrics.width;
    const textH = fontSize;

    if (textW > sw - 4 || textH > sh - 4) return;

    ctx.fillStyle = '#333333';
    ctx.fillText(text, sx + sw / 2, sy + sh / 2);
  }
}
