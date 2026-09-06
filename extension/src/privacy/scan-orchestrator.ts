import {
  ScanResult,
  PageContext,
  DetectedEntity,
  RiskScore,
  RedactionAction,
  PerformanceMetrics,
  PIICategory,
  RiskLevel,
  DetectionSource,
  FirewallAction,
  BoundingBox,
} from '../types/index';
import { PIIDetector } from './pii-detector';
import { RiskEngine } from './risk-engine';
import { PageClassifier } from './page-classifier';
import { PrivacyFirewall } from './privacy-firewall';
import { DOMExtractor } from '../dom/dom-extractor';
import { OCREngine, OCRWord } from '../perception/ocr-engine';
import { RedactionEngine } from '../redaction/redaction-engine';
import { AgentInterface } from '../agent/agent-interface';
import { generateId } from '../utils/id-generator';

const REDACTION_THRESHOLD: RiskLevel = 'HIGH';

const REDACTION_METHODS: Record<PIICategory, string> = {
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

const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function risksContainLevel(risks: RiskScore[], level: RiskLevel): boolean {
  return risks.some((r) => RISK_ORDER[r.level] >= RISK_ORDER[level]);
}

function bboxOverlapRatio(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  const intersection = (x2 - x1) * (y2 - y1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

function fuzzyStringMatch(a: string, b: string): number {
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();

  if (aLower.length === 0 || bLower.length === 0) return 0;
  if (aLower === bLower) return 1.0;

  const normalizedA = aLower.replace(/[\s\-_.]+/g, '');
  const normalizedB = bLower.replace(/[\s\-_.]+/g, '');
  if (normalizedA === normalizedB) return 0.95;

  const shorter = normalizedA.length <= normalizedB.length ? normalizedA : normalizedB;
  const longer = normalizedA.length <= normalizedB.length ? normalizedB : normalizedA;

  if (longer.includes(shorter) && shorter.length > 0) {
    return 0.7;
  }

  let matches = 0;
  let lcs = 0;
  const chars = new Set(shorter);
  for (const ch of longer) {
    if (chars.has(ch)) matches++;
  }

  const len = Math.min(shorter.length, longer.length);
  for (let i = 0; i < len; i++) {
    if (shorter[i] === longer[i]) lcs++;
  }

  const charRatio = matches / longer.length;
  const positionRatio = lcs / len;

  return Math.round(Math.max(charRatio, positionRatio) * 1000) / 1000;
}

export class ScanOrchestrator {
  private piiDetector: PIIDetector;
  private riskEngine: RiskEngine;
  private pageClassifier: PageClassifier;
  private firewall: PrivacyFirewall;
  private domExtractor: DOMExtractor;
  private ocrEngine: OCREngine;
  private redactionEngine: RedactionEngine;
  private agentInterface: AgentInterface;
  private initialized: boolean;
  private performance: PerformanceMetrics;
  private lastScanResult: ScanResult | null = null;

  constructor() {
    this.piiDetector = new PIIDetector();
    this.riskEngine = new RiskEngine();
    this.pageClassifier = new PageClassifier();
    this.firewall = new PrivacyFirewall();
    this.domExtractor = new DOMExtractor();
    this.ocrEngine = new OCREngine();
    this.redactionEngine = new RedactionEngine();
    this.agentInterface = new AgentInterface();
    this.initialized = false;
    this.performance = {
      modelLoadTime: 0,
      screenshotTime: 0,
      ocrTime: 0,
      detectionTime: 0,
      riskScoringTime: 0,
      redactionTime: 0,
      totalTime: 0,
      memoryUsage: 0,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const start = performance.now();
    await this.ocrEngine.initialize();
    this.performance.modelLoadTime = Math.round(performance.now() - start);

    this.initialized = true;
  }

  async scanPage(): Promise<ScanResult> {
    const totalStart = performance.now();
    const timings = {
      ocr: 0,
      dom: 0,
      detection: 0,
      riskScoring: 0,
      redaction: 0,
    };

    if (!this.initialized) {
      await this.initialize();
    }

    const domStart = performance.now();
    const pageContext = this.domExtractor.extractPageContext();
    pageContext.pageType = this.pageClassifier.classifyPage(
      pageContext.url,
      pageContext.title,
      pageContext.domElements,
      pageContext.visibleText,
    );
    timings.dom = Math.round(performance.now() - domStart);

    const detectionStart = performance.now();
    const domEntities = await this.piiDetector.scanPage(pageContext);

    let ocrEntities: DetectedEntity[] = [];

    const screenshotStart = performance.now();
    let screenshotDataUrl: string | undefined;

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.captureVisibleTab) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          chrome.tabs.captureVisibleTab({ format: 'png' }, (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (result) {
              resolve(result);
            } else {
              reject(new Error('captureVisibleTab returned undefined'));
            }
          });
        });

        screenshotDataUrl = dataUrl;

        const ocrStart = performance.now();
        const ocrResult = await this.ocrEngine.recognize(dataUrl);
        timings.ocr = Math.round(performance.now() - ocrStart);

        if (ocrResult.text.trim().length > 0) {
          ocrEntities = await this.detectPIIInOCR(ocrResult.text, ocrResult.words, pageContext);
        }
      }
    } catch (err) {
      console.warn('[ScanOrchestrator] Screenshot/OCR step skipped:', err instanceof Error ? err.message : err);
    }

    this.performance.screenshotTime = Math.round(performance.now() - screenshotStart);

    const combinedEntities = this.combineEntities(domEntities, ocrEntities);
    timings.detection = Math.round(performance.now() - detectionStart);

    const riskStart = performance.now();
    const risks = this.riskEngine.scoreEntities(combinedEntities, pageContext);
    timings.riskScoring = Math.round(performance.now() - riskStart);

    const redactionStart = performance.now();
    const redactions = this.generateRedactions(combinedEntities, risks);
    timings.redaction = Math.round(performance.now() - redactionStart);

    const redactionEntityIds = new Set(redactions.map((redaction) => redaction.entityId));
    const redactionEntities = combinedEntities.filter((entity) => redactionEntityIds.has(entity.id));
    const redactionMethods = {} as Record<PIICategory, string>;
    for (const redaction of redactions) {
      const entity = combinedEntities.find((candidate) => candidate.id === redaction.entityId);
      if (entity) redactionMethods[entity.type] = redaction.method;
    }

    if (typeof document !== 'undefined' && redactionEntities.length > 0) {
      this.redactionEngine.redactDOM(pageContext.domElements, redactionEntities);
    }

    let safeScreenshotDataUrl: string | undefined;
    if (screenshotDataUrl && redactionEntities.length > 0) {
      try {
        safeScreenshotDataUrl = await this.redactionEngine.redactScreenshotDataUrl(
          screenshotDataUrl,
          redactionEntities,
          redactionMethods,
        );
      } catch (err) {
        console.warn('[ScanOrchestrator] Screenshot redaction skipped:', err instanceof Error ? err.message : err);
      }
    }

    const sanitizedContext = this.firewall.createSanitizedContext(
      pageContext,
      combinedEntities,
      risks,
      redactions,
      Math.round(performance.now() - totalStart),
    );

    if (safeScreenshotDataUrl) {
      sanitizedContext.redactedScreenshot = safeScreenshotDataUrl;
    }

    const overallRisk = combinedEntities.length > 0 ? this.computeOverallRisk(risks) : 'LOW';

    const privacyReport = this.buildPrivacyReport(
      combinedEntities,
      risks,
      redactions,
      overallRisk,
    );

    const totalTime = Math.round(performance.now() - totalStart);

    this.performance = {
      ...this.performance,
      ocrTime: timings.ocr,
      detectionTime: timings.detection,
      riskScoringTime: timings.riskScoring,
      redactionTime: timings.redaction,
      totalTime,
      memoryUsage: this.measureMemoryUsage(),
    };

    const scanResult: ScanResult = {
      entities: combinedEntities,
      risks,
      redactions,
      sanitizedContext,
      privacyReport,
      screenshot: safeScreenshotDataUrl,
      processingTime: {
        total: totalTime,
        ocr: timings.ocr,
        dom: timings.dom,
        detection: timings.detection,
        riskScoring: timings.riskScoring,
        redaction: timings.redaction,
      },
    };

    this.lastScanResult = scanResult;
    this.agentInterface.storeScanResult(scanResult);

    return scanResult;
  }

  async scanOCR(
    imageSource: string | ImageData | HTMLCanvasElement,
  ): Promise<DetectedEntity[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const ocrStart = performance.now();
    const ocrResult = await this.ocrEngine.recognize(imageSource);
    this.performance.ocrTime = Math.round(performance.now() - ocrStart);

    if (!ocrResult.text || ocrResult.text.trim().length === 0) {
      return [];
    }

    const dummyContext: PageContext = {
      url: typeof window !== 'undefined' ? window.location.href : '',
      title: typeof document !== 'undefined' ? document.title : '',
      timestamp: Date.now(),
      pageType: 'unknown',
      viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
      viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
      scrollHeight: typeof document !== 'undefined' ? document.documentElement.scrollHeight : 0,
      domElements: [],
      formFields: [],
      visibleText: '',
    };

    return this.detectPIIInOCR(ocrResult.text, ocrResult.words, dummyContext);
  }

  getAgentInterface(): AgentInterface {
    return this.agentInterface;
  }

  getFirewall(): PrivacyFirewall {
    return this.firewall;
  }

  getLastScanResult(): ScanResult | null {
    return this.lastScanResult;
  }

  async shutdown(): Promise<void> {
    if (this.initialized) {
      try {
        await this.ocrEngine.terminate();
      } catch (err) {
        console.warn('[ScanOrchestrator] Shutdown error:', err instanceof Error ? err.message : err);
      }
      this.initialized = false;
    }
  }

  private async detectPIIInOCR(
    text: string,
    words: OCRWord[],
    pageContext: PageContext,
  ): Promise<DetectedEntity[]> {
    const rawEntities = await this.piiDetector.scanPage({
      ...pageContext,
      visibleText: text,
    });

    return this.mapBoundingBoxesToEntities(rawEntities, words);
  }

  private mapBoundingBoxesToEntities(
    entities: DetectedEntity[],
    words: OCRWord[],
  ): DetectedEntity[] {
    if (words.length === 0) return entities;

    const sortedWords = [...words].sort((a, b) => a.text.length - b.text.length);

    return entities.map((entity) => {
      if (!entity.value || entity.value.length === 0) return { ...entity, source: 'OCR' };

      const entityValue = entity.value.replace(/[\s(),.\-]+/g, '').toLowerCase();
      if (entityValue.length === 0) return { ...entity, source: 'OCR' };

      let bestBbox: BoundingBox | null = null;
      let bestScore = 0;

      for (const word of sortedWords) {
        const wordValue = word.text.replace(/[\s(),.\-]+/g, '').toLowerCase();
        if (wordValue.length === 0) continue;

        if (wordValue === entityValue) {
          bestBbox = word.bbox;
          bestScore = 1.0;
          break;
        }

        if (wordValue.includes(entityValue) || entityValue.includes(wordValue)) {
          const overlap = Math.min(wordValue.length, entityValue.length) / Math.max(wordValue.length, entityValue.length);
          if (overlap > bestScore) {
            bestScore = overlap;
            bestBbox = word.bbox;
          }
        }
      }

      if (!bestBbox && entity.context) {
        const contextValue = entity.context.replace(/[\s(),.\-]+/g, '').toLowerCase();
        const lines: BoundingBox[] = [];
        let currentLine: OCRWord[] = [];

        for (const word of words) {
          if (currentLine.length > 0 && Math.abs(word.bbox.y - currentLine[currentLine.length - 1].bbox.y) > 8) {
            lines.push(this.mergeWordsInLine(currentLine));
            currentLine = [];
          }
          currentLine.push(word);
        }
        if (currentLine.length > 0) {
          lines.push(this.mergeWordsInLine(currentLine));
        }

        for (const line of lines) {
          if (line.width <= 0 || line.height <= 0) continue;
          if (contextValue.length === 0) continue;

          const lineWords = words.filter(
            (w) => w.bbox.y >= line.y - 4 && w.bbox.y <= line.y + line.height + 4,
          );
          const lineText = lineWords.map((w) => w.text).join(' ').toLowerCase();
          const normalizedCtx = contextValue.toLowerCase();

          if (lineText.includes(normalizedCtx) || normalizedCtx.includes(lineText.replace(/\s+/g, ''))) {
            if (line.width > 0 && line.height > 0) {
              bestBbox = line;
              break;
            }
          }
        }
      }

      return {
        ...entity,
        source: 'OCR',
        bbox: bestBbox ?? entity.bbox,
        confidence: Math.min(1, entity.confidence + (bestScore > 0 ? 0.05 : 0)),
      };
    });
  }

  private mergeWordsInLine(words: OCRWord[]): BoundingBox {
    if (words.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

    const minX = Math.min(...words.map((w) => w.bbox.x));
    const minY = Math.min(...words.map((w) => w.bbox.y));
    const maxX = Math.max(...words.map((w) => w.bbox.x + w.bbox.width));
    const maxY = Math.max(...words.map((w) => w.bbox.y + w.bbox.height));

    return {
      x: Math.round(minX),
      y: Math.round(minY),
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY),
    };
  }

  private combineEntities(
    domEntities: DetectedEntity[],
    ocrEntities: DetectedEntity[],
  ): DetectedEntity[] {
    if (ocrEntities.length === 0) return domEntities;
    if (domEntities.length === 0) return ocrEntities;

    const combined: DetectedEntity[] = [];
    const used = new Set<number>();

    for (let i = 0; i < domEntities.length; i++) {
      const domEntity = domEntities[i];
      let merged = false;

      for (let j = 0; j < ocrEntities.length; j++) {
        if (used.has(j)) continue;

        const ocrEntity = ocrEntities[j];

        if (domEntity.type !== ocrEntity.type) continue;

        const valueMatch = fuzzyStringMatch(domEntity.value, ocrEntity.value);

        if (valueMatch > 0.8) {
          used.add(j);
          const better = domEntity.confidence >= ocrEntity.confidence ? domEntity : ocrEntity;
          combined.push({
            ...better,
            confidence: Math.max(domEntity.confidence, ocrEntity.confidence),
            source: this.mergeSource(domEntity.source, ocrEntity.source),
          });
          merged = true;
          break;
        }

        const overlap = bboxOverlapRatio(domEntity.bbox, ocrEntity.bbox);
        if (overlap > 0.5 && domEntity.bbox.width > 0 && domEntity.bbox.height > 0) {
          used.add(j);
          const better = domEntity.confidence >= ocrEntity.confidence ? domEntity : ocrEntity;
          combined.push({
            ...better,
            confidence: Math.max(domEntity.confidence, ocrEntity.confidence),
            source: this.mergeSource(domEntity.source, ocrEntity.source),
          });
          merged = true;
          break;
        }
      }

      if (!merged) {
        combined.push(domEntity);
      }
    }

    for (let j = 0; j < ocrEntities.length; j++) {
      if (!used.has(j)) {
        combined.push(ocrEntities[j]);
      }
    }

    return combined;
  }

  private mergeSource(a: DetectionSource, b: DetectionSource): DetectionSource {
    if (a === 'HYBRID' || b === 'HYBRID') return 'HYBRID';
    if (a !== b) return 'HYBRID';
    return a;
  }

  private generateRedactions(
    entities: DetectedEntity[],
    risks: RiskScore[],
  ): RedactionAction[] {
    const riskMap = new Map<string, RiskScore>();
    for (const risk of risks) {
      riskMap.set(risk.entityId, risk);
    }

    const redactions: RedactionAction[] = [];

    for (const entity of entities) {
      const risk = riskMap.get(entity.id);
      const level = risk ? risk.level : entity.risk;

      if (RISK_ORDER[level] < RISK_ORDER[REDACTION_THRESHOLD]) continue;

      const method = (REDACTION_METHODS[entity.type] || 'mask') as RedactionAction['method'];

      redactions.push({
        entityId: entity.id,
        method,
        originalValue: entity.value,
        redactedValue: `[${entity.type}_REDACTED]`,
        bbox: entity.bbox,
      });
    }

    return redactions;
  }

  private computeOverallRisk(risks: RiskScore[]): RiskLevel {
    if (risks.length === 0) return 'LOW';
    let overall: RiskLevel = 'LOW';
    for (const risk of risks) {
      if (RISK_ORDER[risk.level] > RISK_ORDER[overall]) {
        overall = risk.level;
      }
    }
    return overall;
  }

  private buildPrivacyReport(
    entities: DetectedEntity[],
    risks: RiskScore[],
    redactions: RedactionAction[],
    overallRisk: RiskLevel,
  ): ScanResult['privacyReport'] {
    const entitiesByType = {} as Record<PIICategory, number>;
    const entitiesByRisk = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 } as Record<RiskLevel, number>;
    const entitiesBySource = {} as Record<DetectionSource, number>;

    const allCategories: PIICategory[] = [
      'EMAIL', 'PHONE', 'NAME', 'ADDRESS', 'PASSWORD', 'USERNAME',
      'CREDIT_CARD', 'BANK_ACCOUNT', 'API_KEY', 'AUTH_TOKEN',
      'DATE_OF_BIRTH', 'GOVERNMENT_ID', 'MEDICAL_ID', 'FINANCIAL_DATA',
      'PRIVATE_DOCUMENT_CONTENT',
    ];

    for (const category of allCategories) {
      entitiesByType[category] = 0;
    }

    const allSources: DetectionSource[] = ['OCR', 'DOM', 'VISION', 'REGEX', 'CLASSIFIER', 'HYBRID'];
    for (const source of allSources) {
      entitiesBySource[source] = 0;
    }

    const riskMap = new Map<string, RiskScore>();
    for (const risk of risks) {
      riskMap.set(risk.entityId, risk);
    }

    for (const entity of entities) {
      entitiesByType[entity.type] = (entitiesByType[entity.type] || 0) + 1;

      const risk = riskMap.get(entity.id);
      const level = risk ? risk.level : entity.risk;
      entitiesByRisk[level] = (entitiesByRisk[level] || 0) + 1;

      entitiesBySource[entity.source] = (entitiesBySource[entity.source] || 0) + 1;
    }

    const redactionSummary = {
      total: redactions.length,
      byMethod: {} as Record<string, number>,
    };

    for (const redaction of redactions) {
      redactionSummary.byMethod[redaction.method] = (redactionSummary.byMethod[redaction.method] || 0) + 1;
    }

    const firewallActions: FirewallAction[] = this.firewall.getActions();

    return {
      timestamp: Date.now(),
      url: typeof window !== 'undefined' ? window.location.href : '',
      totalEntities: entities.length,
      entitiesByType,
      entitiesByRisk,
      entitiesBySource,
      redactionSummary,
      firewallActions,
      overallRisk,
      isSafeToTransmit: !risksContainLevel(risks, 'HIGH'),
    };
  }

  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performance };
  }

  private measureMemoryUsage(): number {
    try {
      const perf = performance as unknown as { memory?: { usedJSHeapSize?: number } };
      const used = perf.memory?.usedJSHeapSize;
      return typeof used === 'number' ? Math.round(used / 1024 / 1024) : 0;
    } catch {
      return 0;
    }
  }
}
