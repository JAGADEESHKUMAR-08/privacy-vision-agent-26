import {
  AgentRequest,
  AgentResponse,
  SanitizedContext,
  ScanResult,
} from '../types/index';
import { RedactionEngine } from '../redaction/redaction-engine';

const REDACTION_METHODS_DEFAULTS: Record<string, string> = {
  EMAIL: 'mask',
  PHONE: 'mask',
  NAME: 'mask',
  ADDRESS: 'mask',
  PASSWORD: 'mask',
  USERNAME: 'replace',
  CREDIT_CARD: 'tokenize',
  BANK_ACCOUNT: 'tokenize',
  API_KEY: 'mask',
  AUTH_TOKEN: 'mask',
  DATE_OF_BIRTH: 'mask',
  GOVERNMENT_ID: 'tokenize',
  MEDICAL_ID: 'tokenize',
  FINANCIAL_DATA: 'mask',
  PRIVATE_DOCUMENT_CONTENT: 'mask',
};

export class AgentInterface {
  private lastScanResult: ScanResult | null = null;
  private lastSanitizedContext: SanitizedContext | null = null;
  private redactionEngine: RedactionEngine;

  constructor() {
    this.redactionEngine = new RedactionEngine();
  }

  async getPageScreenshot(): Promise<{ canvas: HTMLCanvasElement; sanitized: boolean }> {
    const canvas = document.createElement('canvas');
    let sanitized = false;

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.captureVisibleTab) {
          chrome.tabs.captureVisibleTab({ format: 'png' }, (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (result) {
              resolve(result);
            } else {
              reject(new Error('captureVisibleTab returned undefined'));
            }
          });
        } else {
          reject(new Error('chrome.tabs.captureVisibleTab not available'));
        }
      });

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load screenshot image'));
        image.src = dataUrl;
      });

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas 2d context');
      }
      ctx.drawImage(img, 0, 0);

      if (this.lastScanResult && this.lastScanResult.entities.length > 0) {
        const entitiesWithBbox = this.lastScanResult.entities.filter(
          (e) => e.bbox.width > 0 && e.bbox.height > 0,
        );

        if (entitiesWithBbox.length > 0) {
          const methodMap: Record<string, string> = {};
          for (const entity of entitiesWithBbox) {
            if (!methodMap[entity.id]) {
              methodMap[entity.id] = REDACTION_METHODS_DEFAULTS[entity.type] || 'mask';
            }
          }

          this.redactionEngine.redactScreenshot(canvas, entitiesWithBbox);
          sanitized = true;
        }
      }
    } catch (err) {
      console.warn('[AgentInterface] Screenshot capture failed:', err instanceof Error ? err.message : err);

      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#666666';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          'Screenshot unavailable - capture API not accessible',
          canvas.width / 2,
          canvas.height / 2,
        );
      }
    }

    return { canvas, sanitized };
  }

  getSanitizedContext(): SanitizedContext | null {
    return this.lastSanitizedContext;
  }

  getPageStructure(): {
    safeElements: Array<{
      tag: string;
      role: string;
      label: string;
      selector: string;
      isInteractive: boolean;
    }>;
    safeForms: Array<{
      selector: string;
      label: string;
      type: string;
      required: boolean;
    }>;
    safeText: string;
    pageType: string;
  } {
    if (!this.lastSanitizedContext) {
      return { safeElements: [], safeForms: [], safeText: '', pageType: 'unknown' };
    }

    const ctx = this.lastSanitizedContext;

    return {
      safeElements: ctx.safeElements.map((el) => ({
        tag: el.tag,
        role: el.role,
        label: el.label,
        selector: el.selector,
        isInteractive: el.isInteractive,
      })),
      safeForms: ctx.safeFormFields.map((f) => ({
        selector: f.selector,
        label: f.label,
        type: f.type,
        required: f.required,
      })),
      safeText: ctx.safeText,
      pageType: ctx.pageType,
    };
  }

  getVisibleElements(): Array<{
    selector: string;
    role: string;
    label: string;
    rect: { x: number; y: number; width: number; height: number };
  }> {
    if (!this.lastSanitizedContext) return [];

    return this.lastSanitizedContext.safeElements
      .filter((el) => el.isVisible && el.isInteractive)
      .map((el) => ({
        selector: el.selector,
        role: el.role,
        label: el.label,
        rect: { x: el.rect.x, y: el.rect.y, width: el.rect.width, height: el.rect.height },
      }));
  }

  getElementByDescription(
    description: string,
  ): { selector: string; rect: { x: number; y: number; width: number; height: number } } | null {
    if (!this.lastSanitizedContext) return null;

    const elements = this.lastSanitizedContext.safeElements.filter((el) => el.isVisible);
    if (elements.length === 0) return null;

    let bestMatch: { selector: string; rect: { x: number; y: number; width: number; height: number } } | null = null;
    let bestScore = 0;

    for (const el of elements) {
      const haystack = [el.label, el.role, el.tag, el.sensitiveFields.join(' '), el.selector]
        .filter(Boolean)
        .join(' ');

      const score = this.fuzzyMatch(haystack, description);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          selector: el.selector,
          rect: { x: el.rect.x, y: el.rect.y, width: el.rect.width, height: el.rect.height },
        };
      }
    }

    if (bestScore < 0.25) return null;
    return bestMatch;
  }

  async performAction(request: AgentRequest): Promise<AgentResponse> {
    try {
      switch (request.action) {
        case 'scan': {
          return {
            success: true,
            action: 'scan',
          };
        }

        case 'get_context': {
          return {
            success: true,
            context: this.lastSanitizedContext ?? undefined,
            action: 'get_context',
          };
        }

        case 'click': {
          if (!request.target) {
            return { success: false, error: 'No target selector specified for click action' };
          }
          const clicked = this.clickElement(request.target);
          if (!clicked) {
            return { success: false, error: `Element not found: ${request.target}` };
          }
          return { success: true, action: 'click' };
        }

        case 'type': {
          if (!request.target) {
            return { success: false, error: 'No target selector specified for type action' };
          }
          if (request.value === undefined || request.value === null) {
            return { success: false, error: 'No value specified for type action' };
          }
          const typed = this.typeInElement(request.target, request.value);
          if (!typed) {
            return { success: false, error: `Could not type into element: ${request.target}` };
          }
          return { success: true, action: 'type' };
        }

        case 'scroll': {
          const direction = request.target || 'down';
          const amount = typeof request.options?.amount === 'number' ? (request.options.amount as number) : 500;
          this.scrollPage(direction, amount);
          return { success: true, action: 'scroll' };
        }

        case 'screenshot': {
          const { canvas, sanitized } = await this.getPageScreenshot();
          let dataUrl: string;
          try {
            dataUrl = canvas.toDataURL('image/png');
          } catch {
            dataUrl = '';
          }
          return {
            success: true,
            action: 'screenshot',
            screenshot: dataUrl || undefined,
          };
        }

        default: {
          return {
            success: false,
            error: `Unknown action: ${(request as AgentRequest).action}`,
          };
        }
      }
    } catch (err) {
      return {
        success: false,
        error: `Action failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  storeScanResult(result: ScanResult): void {
    this.lastScanResult = result;
    this.lastSanitizedContext = result.sanitizedContext;
  }

  getLastScanResult(): ScanResult | null {
    return this.lastScanResult;
  }

  private clickElement(selector: string): boolean {
    let el: Element | null;
    try {
      el = document.querySelector(selector);
    } catch {
      return false;
    }
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const eventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
      screenX: cx + window.screenX,
      screenY: cy + window.screenY,
    };

    const pointerInit: PointerEventInit = {
      ...eventInit,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };

    try {
      el.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
    } catch {}

    try {
      el.dispatchEvent(new MouseEvent('mousedown', eventInit));
    } catch {}

    try {
      el.dispatchEvent(new PointerEvent('pointerup', pointerInit));
    } catch {}

    try {
      el.dispatchEvent(new MouseEvent('mouseup', eventInit));
    } catch {}

    try {
      el.dispatchEvent(new MouseEvent('click', eventInit));
    } catch {}

    if (el instanceof HTMLElement) {
      try {
        el.click();
      } catch {}
    }

    return true;
  }

  private typeInElement(selector: string, value: string): boolean {
    let el: Element | null;
    try {
      el = document.querySelector(selector);
    } catch {
      return false;
    }
    if (!el) return false;

    const isTextInput =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement;

    if (!isTextInput) {
      if (el instanceof HTMLElement && el.isContentEditable) {
        el.focus();
        el.textContent = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }

    const input = el as HTMLInputElement | HTMLTextAreaElement;

    input.focus();

    const nativeInputValueSetter =
      Object.getOwnPropertyDescriptor(
        el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        'value',
      )?.set;

    if (nativeInputValueSetter) {
      try {
        nativeInputValueSetter.call(input, value);
      } catch {
        input.value = value;
      }
    } else {
      input.value = value;
    }

    try {
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    } catch {}

    try {
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    } catch {}

    try {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Unidentified' }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
    } catch {}

    return true;
  }

  private scrollPage(direction: string, amount: number): boolean {
    const normalised = direction.toLowerCase();
    let deltaY: number;

    switch (normalised) {
      case 'up':
        deltaY = -amount;
        break;
      case 'down':
        deltaY = amount;
        break;
      case 'top':
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return true;
      case 'bottom':
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        return true;
      case 'left':
        window.scrollBy({ left: -amount, behavior: 'smooth' });
        return true;
      case 'right':
        window.scrollBy({ left: amount, behavior: 'smooth' });
        return true;
      default:
        deltaY = amount;
        break;
    }

    window.scrollBy({ top: deltaY, behavior: 'smooth' });
    return true;
  }

  private fuzzyMatch(text: string, query: string): number {
    const textLower = text.toLowerCase().trim();
    const queryLower = query.toLowerCase().trim();

    if (queryLower.length === 0) return 0;
    if (textLower === queryLower) return 1.0;
    if (textLower.includes(queryLower)) return 1.0;

    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);
    if (queryWords.length === 0) return 0;

    const textWords = textLower.split(/\s+/).filter((w) => w.length > 0);

    let totalScore = 0;

    for (const qw of queryWords) {
      let bestWordScore = 0;

      for (const tw of textWords) {
        if (tw === qw) {
          bestWordScore = 1.0;
          break;
        }
      }

      if (bestWordScore < 1.0) {
        for (const tw of textWords) {
          if (tw.includes(qw) || qw.includes(tw)) {
            const len = Math.min(tw.length, qw.length);
            const maxLen = Math.max(tw.length, qw.length);
            const overlapRatio = len / maxLen;
            if (overlapRatio >= 0.6) {
              bestWordScore = Math.max(bestWordScore, 0.5);
            }
          }
        }
      }

      if (bestWordScore < 0.5) {
        if (textLower.includes(qw)) {
          bestWordScore = 0.3;
        }
      }

      if (bestWordScore < 0.3) {
        const textCharSet = new Set(textLower);
        let charMatches = 0;
        for (const ch of qw) {
          if (textCharSet.has(ch)) charMatches++;
        }
        const charRatio = charMatches / qw.length;
        if (charRatio > 0.8 && qw.length >= 3) {
          bestWordScore = 0.2;
        }
      }

      totalScore += bestWordScore;
    }

    return totalScore / queryWords.length;
  }
}
