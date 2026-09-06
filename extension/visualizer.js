/**
 * Privacy Vision Agent - Privacy Visualizer Overlay
 * =================================================
 * A self-contained module that creates a floating, draggable, resizable
 * panel on the page showing live privacy scan results.
 *
 * The panel offers four view modes:
 *   - Original   : shows the page untouched (no overlays)
 *   - Detection  : colored bounding boxes around detected PII
 *   - Redacted   : blurred/masked regions as they would appear
 *   - Sanitized  : what would be sent to external AI (tokenized text)
 *
 * Includes a summary stats bar, entity list, screenshot comparison slider,
 * and keyboard shortcut (Ctrl+Shift+V) to toggle the panel.
 *
 * Usage:
 *   window.PrivacyVisualizer.showVisualization(scanResults);
 *   window.PrivacyVisualizer.hideVisualization();
 *
 * scanResults shape:
 *   {
 *     entities: [{id, type, value, bbox, confidence, risk, domSelector}],
 *     risks:    [{entityId, level, overall}],
 *     overallRisk: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL',
 *     counts:   {EMAIL: n, PHONE: n, ...},
 *     totalEntities: n,
 *     pageType: '...',
 *     processingTime: {total: ms},
 *     sanitizedText: optional string
 *   }
 */
(function () {
  'use strict';

  if (window.__PVA_VISUALIZER_LOADED__) return;
  window.__PVA_VISUALIZER_LOADED__ = true;

  var PREFIX = '__pva-viz-';

  // ─── Risk Color Configuration ─────────────────────────────────────────────
  var RISK_CONFIG = {
    CRITICAL: {
      border: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.18)',
      fill: 'rgba(239, 68, 68, 0.35)',
      text: '#fca5a5',
      badge: 'rgba(239, 68, 68, 0.9)',
      glow: 'rgba(239, 68, 68, 0.6)'
    },
    HIGH: {
      border: '#f97316',
      bg: 'rgba(249, 115, 22, 0.15)',
      fill: 'rgba(249, 115, 22, 0.3)',
      text: '#fdba74',
      badge: 'rgba(249, 115, 22, 0.9)',
      glow: 'rgba(249, 115, 22, 0.55)'
    },
    MEDIUM: {
      border: '#eab308',
      bg: 'rgba(234, 179, 8, 0.12)',
      fill: 'rgba(234, 179, 8, 0.28)',
      text: '#fde047',
      badge: 'rgba(234, 179, 8, 0.9)',
      glow: 'rgba(234, 179, 8, 0.5)'
    },
    LOW: {
      border: '#3b82f6',
      bg: 'rgba(59, 130, 246, 0.1)',
      fill: 'rgba(59, 130, 246, 0.25)',
      text: '#93c5fd',
      badge: 'rgba(59, 130, 246, 0.9)',
      glow: 'rgba(59, 130, 246, 0.45)'
    }
  };

  var RISK_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

  // ─── Internal State ───────────────────────────────────────────────────────
  var state = {
    initialized: false,
    visible: false,
    activeMode: 'detection',
    scanResults: null,
    root: null,
    host: null,
    shadow: null,
    panel: null,
    overlaysLayer: null,
    redactionLayer: null,
    originalLayer: null,
    toggler: null,
    entityOverlays: [],
    drag: { active: false, startX: 0, startY: 0, origLeft: 0, origTop: 0 },
    resize: { active: false, mode: null, startX: 0, startY: 0, origW: 0, origH: 0 },
    currentScreenshot: null,
    compareActive: false,
    comparePosition: 50
  };

  // ─── CSS (injected into shadow root) ──────────────────────────────────────
  var CSS = String.raw`
    :host {
      all: initial;
      --pva-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                  "Helvetica Neue", Arial, sans-serif;
      --pva-mono: "SF Mono", "Fira Code", "Consolas", monospace;
      --pva-bg: #0f172a;
      --pva-bg-panel: #1e293b;
      --pva-bg-card: #16213a;
      --pva-border: #293548;
      --pva-border-light: #334155;
      --pva-text: #f1f5f9;
      --pva-text-dim: #94a3b8;
      --pva-text-faint: #64748b;
      --pva-accent: #6366f1;
      --pva-accent-glow: rgba(99, 102, 241, 0.35);
      --pva-success: #4ade80;
      --pva-warning: #fbbf24;
      --pva-danger: #ef4444;
      --pva-radius: 12px;
      --pva-shadow: 0 12px 48px rgba(0, 0, 0, 0.55), 0 2px 12px rgba(0, 0, 0, 0.4);
      font-family: var(--pva-font);
      color: var(--pva-text);
      line-height: 1.5;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* ── Layer containers ─────────────────────────────────────────────── */
    .pva-layer {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 2147483646;
    }

    .pva-layer.hidden {
      display: none;
    }

    /* ── Root container for panel + overlay layers ───────────────────── */
    .pva-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      z-index: 2147483647;
      pointer-events: none;
    }

    /* ── Overlays (bounding boxes) ───────────────────────────────────── */
    .pva-entity-overlay {
      position: absolute;
      pointer-events: auto;
      cursor: pointer;
      border-radius: 3px;
      transition: box-shadow 0.15s ease;
      animation: pva-pop-in 0.25s ease-out both;
    }

    .pva-entity-overlay.animate {
      animation: pva-pulse 1.5s ease-in-out infinite;
    }

    .pva-entity-overlay .pva-overlay-label {
      position: absolute;
      top: -20px;
      left: 0;
      background: #334155;
      color: #e2e8f0;
      font-family: var(--pva-mono);
      font-size: 10px;
      font-weight: 700;
      line-height: 1;
      padding: 4px 6px;
      border-radius: 4px;
      white-space: nowrap;
      letter-spacing: 0.3px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
      opacity: 0;
      transform: translateY(2px);
      transition: opacity 0.15s ease, transform 0.15s ease;
      pointer-events: none;
      z-index: 2;
    }

    .pva-entity-overlay:hover .pva-overlay-label {
      opacity: 1;
      transform: translateY(0);
    }

    /* ── Redaction (blur / mask) overlays ────────────────────────────── */
    .pva-redaction-overlay {
      position: absolute;
      pointer-events: none;
      border-radius: 3px;
      backdrop-filter: blur(6px) saturate(0.5);
      -webkit-backdrop-filter: blur(6px) saturate(0.5);
      background: rgba(79, 70, 229, 0.12);
      border: 1px dashed rgba(139, 92, 246, 0.5);
      animation: pva-fade-blur 0.4s ease-out both;
    }

    .pva-redaction-overlay::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: repeating-linear-gradient(
        45deg,
        transparent,
        transparent 4px,
        rgba(139, 92, 246, 0.08) 4px,
        rgba(139, 92, 246, 0.08) 8px
      );
    }

    .pva-redaction-overlay .pva-redact-label {
      position: absolute;
      bottom: 2px;
      left: 4px;
      font-family: var(--pva-mono);
      font-size: 8px;
      font-weight: 600;
      color: rgba(199, 210, 254, 0.9);
      letter-spacing: 0.3px;
      text-transform: uppercase;
      pointer-events: none;
    }

    /* ── Sanitized token overlay ─────────────────────────────────────── */
    .pva-token-overlay {
      position: absolute;
      pointer-events: none;
      display: flex;
      align-items: center;
      padding: 0 6px;
      background: rgba(30, 41, 59, 0.92);
      border: 1px solid rgba(99, 102, 241, 0.5);
      border-radius: 4px;
      overflow: hidden;
      color: #a5b4fc;
      font-family: var(--pva-mono);
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      text-overflow: ellipsis;
      animation: pva-fade-in 0.3s ease-out both;
    }

    .pva-token-overlay span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Main Panel ──────────────────────────────────────────────────── */
    .pva-panel {
      position: fixed;
      pointer-events: auto;
      width: 340px;
      min-width: 260px;
      min-height: 200px;
      background: var(--pva-bg-panel);
      border: 1px solid var(--pva-border);
      border-radius: var(--pva-radius);
      box-shadow: var(--pva-shadow);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 2147483647;
      transform-origin: top right;
      animation: pva-panel-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }

    .pva-panel.resizing {
      animation: none;
      transition: none;
    }

    /* Header */
    .pva-panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.15), rgba(79, 70, 229, 0.1));
      border-bottom: 1px solid var(--pva-border);
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      flex-shrink: 0;
    }

    .pva-panel-header:active {
      cursor: grabbing;
    }

    .pva-header-logo {
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #7c3aed, #4f46e5);
      border-radius: 7px;
      color: white;
      font-size: 14px;
      flex-shrink: 0;
    }

    .pva-header-title {
      flex: 1;
      min-width: 0;
    }

    .pva-header-title h3 {
      font-size: 12px;
      font-weight: 700;
      color: var(--pva-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pva-header-title .pva-header-sub {
      font-size: 10px;
      color: var(--pva-text-faint);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 1px;
    }

    .pva-header-btn {
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      color: var(--pva-text-dim);
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
      flex-shrink: 0;
      line-height: 1;
    }

    .pva-header-btn:hover {
      background: rgba(51, 65, 85, 0.6);
      color: var(--pva-text);
    }

    .pva-header-btn.pva-minimize.active {
      color: var(--pva-accent);
    }

    .pva-risk-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 20px;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.8px;
      font-family: var(--pva-mono);
      margin-left: 4px;
    }

    .pva-risk-pill.risk-LOW { background: rgba(59, 130, 246, 0.15); color: #93c5fd; }
    .pva-risk-pill.risk-MEDIUM { background: rgba(234, 179, 8, 0.15); color: #fde047; }
    .pva-risk-pill.risk-HIGH { background: rgba(249, 115, 22, 0.15); color: #fdba74; }
    .pva-risk-pill.risk-CRITICAL { background: rgba(239, 68, 68, 0.18); color: #fca5a5; }

    /* Minimized state */
    .pva-panel.minimized .pva-panel-body {
      display: none;
    }

    /* Body scroll area */
    .pva-panel-body {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      min-height: 0;
    }

    .pva-panel-body::-webkit-scrollbar {
      width: 6px;
    }

    .pva-panel-body::-webkit-scrollbar-track {
      background: transparent;
    }

    .pva-panel-body::-webkit-scrollbar-thumb {
      background: var(--pva-border-light);
      border-radius: 3px;
    }

    /* ── Tabs ────────────────────────────────────────────────────────── */
    .pva-tabs {
      display: flex;
      padding: 8px 8px 0;
      gap: 4px;
      border-bottom: 1px solid var(--pva-border);
      background: var(--pva-bg-panel);
    }

    .pva-tab {
      flex: 1;
      padding: 6px 4px;
      border: none;
      background: transparent;
      color: var(--pva-text-dim);
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      border-radius: 6px 6px 0 0;
      transition: background 0.15s, color 0.15s;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      white-space: nowrap;
    }

    .pva-tab:hover {
      background: rgba(51, 65, 85, 0.4);
      color: var(--pva-text);
    }

    .pva-tab.active {
      color: var(--pva-text);
      background: rgba(99, 102, 241, 0.12);
    }

    .pva-tab.active::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 20%;
      right: 20%;
      height: 2px;
      background: var(--pva-accent);
      border-radius: 2px;
    }

    .pva-tab .pva-tab-count {
      font-family: var(--pva-mono);
      font-size: 8px;
      font-weight: 800;
      background: var(--pva-border-light);
      color: var(--pva-text-dim);
      padding: 1px 5px;
      border-radius: 8px;
    }

    /* ── Stats Bar ───────────────────────────────────────────────────── */
    .pva-stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      padding: 8px;
      background: var(--pva-bg-panel);
      border-bottom: 1px solid var(--pva-border);
    }

    .pva-stat {
      text-align: center;
      padding: 4px 2px;
      background: rgba(15, 23, 42, 0.5);
      border-radius: 6px;
    }

    .pva-stat-value {
      font-size: 15px;
      font-weight: 800;
      color: var(--pva-text);
      line-height: 1.2;
      font-family: var(--pva-mono);
    }

    .pva-stat-value.zero {
      color: var(--pva-text-faint);
    }

    .pva-stat-value.high-risk {
      color: var(--pva-danger);
    }

    .pva-stat-label {
      font-size: 8px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--pva-text-faint);
      margin-top: 2px;
    }

    /* ── Entity List ─────────────────────────────────────────────────── */
    .pva-entity-list {
      padding: 4px 8px 8px;
    }

    .pva-entity-list-title {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--pva-text-faint);
      margin: 8px 4px 4px;
    }

    .pva-entity-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 8px;
      border-radius: 6px;
      margin-bottom: 3px;
      background: rgba(15, 23, 42, 0.35);
      border: 1px solid rgba(41, 53, 72, 0.4);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
    }

    .pva-entity-row:hover {
      background: rgba(51, 65, 85, 0.4);
      border-color: var(--pva-border-light);
    }

    .pva-entity-row.active {
      border-color: var(--pva-accent);
      box-shadow: 0 0 0 1px var(--pva-accent-glow);
    }

    .pva-entity-type {
      font-family: var(--pva-mono);
      font-size: 8px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      padding: 3px 6px;
      border-radius: 4px;
      min-width: 52px;
      text-align: center;
      color: white;
      flex-shrink: 0;
    }

    .pva-entity-type.rate-CRITICAL { background: rgba(220, 38, 38, 0.85); }
    .pva-entity-type.rate-HIGH { background: rgba(234, 88, 12, 0.85); }
    .pva-entity-type.rate-MEDIUM { background: rgba(217, 119, 6, 0.85); }
    .pva-entity-type.rate-LOW { background: rgba(37, 99, 235, 0.85); }

    .pva-entity-value {
      flex: 1;
      font-family: var(--pva-mono);
      font-size: 10px;
      color: #cbd5e1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pva-entity-conf {
      font-family: var(--pva-mono);
      font-size: 9px;
      color: var(--pva-text-faint);
      flex-shrink: 0;
    }

    .pva-empty-state {
      text-align: center;
      padding: 24px 12px;
      color: var(--pva-text-faint);
      font-size: 12px;
    }

    .pva-empty-icon {
      font-size: 28px;
      margin-bottom: 8px;
      opacity: 0.6;
    }

    /* ── Ring Progress (risk gauge) ──────────────────────────────────── */
    .pva-gauge-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
      border-bottom: 1px solid var(--pva-border);
      background: var(--pva-bg-panel);
    }

    .pva-gauge {
      position: relative;
      width: 64px;
      height: 64px;
    }

    .pva-gauge svg {
      width: 64px;
      height: 64px;
      transform: rotate(-90deg);
    }

    .pva-gauge-bg,
    .pva-gauge-fg {
      fill: none;
      stroke-width: 5;
      stroke-linecap: round;
    }

    .pva-gauge-bg {
      stroke: rgba(51, 65, 85, 0.5);
    }

    .pva-gauge-fg {
      stroke: var(--pva-accent);
      transition: stroke-dashoffset 0.6s ease, stroke 0.3s ease;
    }

    .pva-gauge-center {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .pva-gauge-value {
      font-size: 14px;
      font-weight: 800;
      font-family: var(--pva-mono);
      line-height: 1;
    }

    .pva-gauge-label {
      font-size: 7px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--pva-text-faint);
      margin-top: 2px;
    }

    .pva-gauge-meta {
      margin-left: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11px;
    }

    .pva-gauge-meta-row {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--pva-text-dim);
    }

    .pva-gauge-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .pva-gauge-dot.rate-CRITICAL { background: #ef4444; box-shadow: 0 0 4px rgba(239, 68, 68, 0.6); }
    .pva-gauge-dot.rate-HIGH { background: #f97316; box-shadow: 0 0 4px rgba(249, 115, 22, 0.6); }
    .pva-gauge-dot.rate-MEDIUM { background: #eab308; box-shadow: 0 0 4px rgba(234, 179, 8, 0.6); }
    .pva-gauge-dot.rate-LOW { background: #3b82f6; box-shadow: 0 0 4px rgba(59, 130, 246, 0.6); }

    /* ── Compare Slider / Screenshot mode ────────────────────────────── */
    .pva-compare {
      position: relative;
      height: 220px;
      border-bottom: 1px solid var(--pva-border);
      background: #0b1120;
      overflow: hidden;
      display: none;
    }

    .pva-compare.visible {
      display: block;
    }

    .pva-compare-img {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #0b1120;
    }

    .pva-compare-img.redacted {
      filter: blur(4px);
    }

    .pva-compare-divider {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background: rgba(255, 255, 255, 0.7);
      cursor: ew-resize;
      z-index: 3;
      box-shadow: 0 0 8px rgba(0, 0, 0, 0.5);
    }

    .pva-compare-handle {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 28px;
      height: 28px;
      background: var(--pva-accent);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    }

    .pva-compare-label {
      position: absolute;
      bottom: 8px;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 3px 8px;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      z-index: 4;
    }

    .pva-compare-label.orig {
      right: 8px;
    }

    .pva-compare-label.red {
      left: 8px;
    }

    .pva-compare-empty {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--pva-text-faint);
      font-size: 12px;
      flex-direction: column;
      gap: 8px;
      text-align: center;
      padding: 16px;
    }

    /* ── Footer ──────────────────────────────────────────────────────── */
    .pva-panel-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-top: 1px solid var(--pva-border);
      background: var(--pva-bg-panel);
      gap: 8px;
      font-size: 10px;
      color: var(--pva-text-faint);
      flex-shrink: 0;
    }

    .pva-footer-stats {
      display: flex;
      gap: 10px;
    }

    .pva-footer-stats b {
      color: var(--pva-text-dim);
      font-family: var(--pva-mono);
    }

    .pva-footer-shortcut {
      font-family: var(--pva-mono);
      background: var(--pva-bg-card);
      border: 1px solid var(--pva-border);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9px;
    }

    /* ── Toggler (floating tab) ──────────────────────────────────────── */
    .pva-toggler {
      position: fixed;
      right: 12px;
      top: 12px;
      z-index: 2147483646;
      display: none;
      align-items: center;
      gap: 6px;
      background: linear-gradient(135deg, #7c3aed, #4f46e5);
      color: white;
      border: none;
      border-radius: 20px;
      padding: 8px 16px;
      font-family: var(--pva-font);
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(124, 58, 237, 0.45);
      transition: transform 0.15s, box-shadow 0.2s;
      pointer-events: auto;
      user-select: none;
      -webkit-user-select: none;
    }

    .pva-toggler.visible {
      display: flex;
    }

    .pva-toggler:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 24px rgba(124, 58, 237, 0.55);
    }

    .pva-toggler .pva-toggler-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #4ade80;
      box-shadow: 0 0 6px rgba(74, 222, 128, 0.7);
      animation: pva-blink 2s infinite;
    }

    /* ── Animations ──────────────────────────────────────────────────── */
    @keyframes pva-panel-in {
      from { opacity: 0; transform: translateY(-12px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes pva-pop-in {
      from { opacity: 0; transform: scale(0.9); }
      to { opacity: 1; transform: scale(1); }
    }

    @keyframes pva-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes pva-fade-blur {
      from { opacity: 0; filter: blur(0); }
      to { opacity: 1; filter: blur(6px); }
    }

    @keyframes pva-pulse {
      0%, 100% { box-shadow: 0 0 4px rgba(255, 255, 255, 0.1); }
      50% { box-shadow: 0 0 12px var(--pva-glow); }
    }

    @keyframes pva-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `;

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function maskValue(value, type) {
    if (!value) return '';
    if (type === 'PASSWORD' || type === 'API_KEY' || type === 'AUTH_TOKEN') {
      if (value.length <= 8) return '****';
      return value.substring(0, 4) + '****' + value.substring(value.length - 4);
    }
    if (type === 'EMAIL') {
      var parts = String(value).split('@');
      if (parts.length === 2) {
        var nm = parts[0];
        if (nm.length <= 2) return nm[0] + '***@' + parts[1];
        return nm.substring(0, 2) + '***@' + parts[1];
      }
    }
    if (type === 'CREDIT_CARD') {
      var cc = String(value).replace(/\D/g, '');
      if (cc.length >= 8) return '****-****-****-' + cc.substring(cc.length - 4);
    }
    if (type === 'PHONE') {
      var ph = String(value).replace(/\D/g, '');
      if (ph.length >= 6) return '***-***-' + ph.substring(ph.length - 4);
    }
    if (type === 'GOVERNMENT_ID') {
      if (value.length >= 6) return '***-' + value.substring(value.length - 4);
    }
    if (String(value).length > 8) {
      return String(value).substring(0, 4) + '...' + String(value).substring(String(value).length - 2);
    }
    return '****';
  }

  function tokenizeValue(value, type) {
    var tokens = {
      EMAIL: 'EMAIL_TOKEN',
      PHONE: 'PHONE_TOKEN',
      PASSWORD: 'SECRET_TOKEN',
      USERNAME: 'USERNAME_TOKEN',
      NAME: 'NAME_TOKEN',
      ADDRESS: 'ADDRESS_TOKEN',
      CREDIT_CARD: 'CARD_TOKEN',
      BANK_ACCOUNT: 'ACCT_TOKEN',
      API_KEY: 'API_TOKEN',
      AUTH_TOKEN: 'AUTH_TOKEN',
      DATE_OF_BIRTH: 'DOB_TOKEN',
      GOVERNMENT_ID: 'GOV_ID_TOKEN',
      MEDICAL_ID: 'MED_TOKEN',
      FINANCIAL_DATA: 'FIN_TOKEN',
      PRIVATE_DOCUMENT_CONTENT: 'DOC_TOKEN'
    };
    return tokens[type] || 'PII_TOKEN';
  }

  // ─── Initialization ───────────────────────────────────────────────────────
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    // ── Create host element + shadow DOM ──────────────────────────────
    state.host = document.createElement('div');
    state.host.id = PREFIX + 'root';
    state.host.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';

    state.shadow = state.host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = CSS;
    state.shadow.appendChild(style);

    // ── Layer containers ───────────────────────────────────────────────
    state.overlaysLayer = document.createElement('div');
    state.overlaysLayer.className = 'pva-layer';
    state.overlaysLayer.id = PREFIX + 'overlays';
    state.overlaysLayer.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;';

    state.redactionLayer = document.createElement('div');
    state.redactionLayer.className = 'pva-layer';
    state.redactionLayer.id = PREFIX + 'redactions';
    state.redactionLayer.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;';

    state.originalLayer = document.createElement('div');
    state.originalLayer.className = 'pva-layer hidden';
    state.originalLayer.id = PREFIX + 'original';
    state.originalLayer.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483644;';

    state.shadow.appendChild(state.overlaysLayer);
    state.shadow.appendChild(state.redactionLayer);
    state.shadow.appendChild(state.originalLayer);

    // ── Build panel ────────────────────────────────────────────────────
    state.panel = buildPanel();
    state.shadow.appendChild(state.panel);

    // ── Toggler button ─────────────────────────────────────────────────
    state.toggler = document.createElement('button');
    state.toggler.className = 'pva-toggler';
    state.toggler.id = PREFIX + 'toggler';
    state.toggler.innerHTML =
      '<span class="pva-toggler-dot"></span><span class="pva-toggler-text">Privacy Visualizer</span>';
    state.shadow.appendChild(state.toggler);

    state.toggler.addEventListener('click', togglePanel);

    // ── Attach to document ─────────────────────────────────────────────
    (document.body || document.documentElement).appendChild(state.host);

    // ── Listeners ──────────────────────────────────────────────────────
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('keydown', onKeydown);

    // Listen for messages from the content script / popup (if running in
    // an extension context; harmless when loaded as a plain page script).
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(onMessage);
    }

    // DOM event bridge for content-script-to-page-world communication.
    window.addEventListener('pva:visualizer', onDomEvent);

    // Start hidden; the toggler lets the user open the panel.
    state.panel.style.display = 'none';
    state.toggler.classList.add('visible');
    state.visible = false;
  }

  // ─── Panel construction ───────────────────────────────────────────────────
  function buildPanel() {
    var panel = document.createElement('div');
    panel.className = 'pva-panel';
    panel.id = PREFIX + 'panel';
    panel.style.cssText =
      'top:16px;right:16px;left:auto;bottom:auto;';

    // ── Header ─────────────────────────────────────────────────────────
    var header = document.createElement('div');
    header.className = 'pva-panel-header';
    header.title = 'Drag to move';

    var logo = document.createElement('div');
    logo.className = 'pva-header-logo';
    logo.textContent = '\u{1F6E1}';
    header.appendChild(logo);

    var titleWrap = document.createElement('div');
    titleWrap.className = 'pva-header-title';
    var h3 = document.createElement('h3');
    h3.textContent = 'Privacy Vision Agent';
    var sub = document.createElement('div');
    sub.className = 'pva-header-sub';
    sub.id = PREFIX + 'headersub';
    sub.textContent = 'No scan yet';
    titleWrap.appendChild(h3);
    titleWrap.appendChild(sub);
    header.appendChild(titleWrap);

    var minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'pva-header-btn pva-minimize';
    minimizeBtn.id = PREFIX + 'minimizeBtn';
    minimizeBtn.textContent = '\u2013';
    minimizeBtn.title = 'Minimize / Maximize';
    minimizeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMinimized();
    });
    header.appendChild(minimizeBtn);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'pva-header-btn';
    closeBtn.id = PREFIX + 'closeBtn';
    closeBtn.textContent = '\u00d7';
    closeBtn.title = 'Close panel';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      hideVisualization();
    });
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // ── Body ───────────────────────────────────────────────────────────
    var body = document.createElement('div');
    body.className = 'pva-panel-body';
    body.id = PREFIX + 'body';

    // Tabs
    var tabs = document.createElement('div');
    tabs.className = 'pva-tabs';
    var tabDefs = [
      { id: 'original', label: 'Original', icon: '\u{1F4F7}' },
      { id: 'detection', label: 'Detection', icon: '\u{1F50D}' },
      { id: 'redacted', label: 'Redacted', icon: '\u{1F575}' },
      { id: 'sanitized', label: 'Sanitized', icon: '\u{1F512}' }
    ];
    tabDefs.forEach(function (def, idx) {
      var btn = document.createElement('button');
      btn.className = 'pva-tab' + (def.id === 'detection' ? ' active' : '');
      btn.setAttribute('data-mode', def.id);
      btn.id = PREFIX + 'tab-' + def.id;
      btn.innerHTML = '<span>' + def.icon + '</span><span>' + def.label + '</span>';
      var countSpan = document.createElement('span');
      countSpan.className = 'pva-tab-count';
      countSpan.id = PREFIX + 'tabcount-' + def.id;
      countSpan.textContent = '0';
      btn.appendChild(countSpan);
      btn.addEventListener('click', function () {
        setMode(def.id);
      });
      tabs.appendChild(btn);
    });
    body.appendChild(tabs);

    // Gauge
    var gaugeWrap = document.createElement('div');
    gaugeWrap.className = 'pva-gauge-wrap';
    gaugeWrap.innerHTML =
      '<div class="pva-gauge">' +
        '<svg viewBox="0 0 64 64">' +
          '<circle class="pva-gauge-bg" cx="32" cy="32" r="26"></circle>' +
          '<circle class="pva-gauge-fg" id="' + PREFIX + 'gaugefg" cx="32" cy="32" r="26" ' +
            'stroke-dasharray="163.4" stroke-dashoffset="163.4"></circle>' +
        '</svg>' +
        '<div class="pva-gauge-center">' +
          '<div class="pva-gauge-value" id="' + PREFIX + 'gaugevalue">0</div>' +
          '<div class="pva-gauge-label" id="' + PREFIX + 'gaugelabel">ENTITIES</div>' +
        '</div>' +
      '</div>' +
      '<div class="pva-gauge-meta">' +
        '<div class="pva-gauge-meta-row"><span class="pva-gauge-dot rate-LOW"></span><span>Low</span></div>' +
        '<div class="pva-gauge-meta-row"><span class="pva-gauge-dot rate-MEDIUM"></span><span>Medium</span></div>' +
        '<div class="pva-gauge-meta-row"><span class="pva-gauge-dot rate-HIGH"></span><span>High</span></div>' +
        '<div class="pva-gauge-meta-row"><span class="pva-gauge-dot rate-CRITICAL"></span><span>Critical</span></div>' +
      '</div>';
    body.appendChild(gaugeWrap);

    // Stats bar
    var stats = document.createElement('div');
    stats.className = 'pva-stats';
    var statDefs = [
      { id: 'statTotal', label: 'Entities', key: 'total' },
      { id: 'statCritical', label: 'Critical', key: 'CRITICAL', risk: true },
      { id: 'statHigh', label: 'High', key: 'HIGH', risk: true },
      { id: 'statMedium', label: 'Medium', key: 'MEDIUM', risk: true }
    ];
    statDefs.forEach(function (def) {
      var s = document.createElement('div');
      s.className = 'pva-stat';
      var val = document.createElement('div');
      val.className = 'pva-stat-value zero' + (def.risk ? ' high-risk' : '');
      val.id = PREFIX + def.id;
      val.textContent = '0';
      var lbl = document.createElement('div');
      lbl.className = 'pva-stat-label';
      lbl.textContent = def.label;
      s.appendChild(val);
      s.appendChild(lbl);
      stats.appendChild(s);
    });
    body.appendChild(stats);

    // Compare slider
    var compare = document.createElement('div');
    compare.className = 'pva-compare';
    compare.id = PREFIX + 'compare';
    compare.innerHTML =
      '<div class="pva-compare-empty" id="' + PREFIX + 'compareempty">' +
        '<div class="pva-compare-icon">\u{1F4F7}</div>' +
        '<div>Run a scan to see the redacted screenshot comparison.</div>' +
      '</div>';
    body.appendChild(compare);

    // Entity list
    var listTitle = document.createElement('div');
    listTitle.className = 'pva-entity-list-title';
    listTitle.textContent = 'Detected Entities';
    body.appendChild(listTitle);

    var entityList = document.createElement('div');
    entityList.className = 'pva-entity-list';
    entityList.id = PREFIX + 'entities';
    body.appendChild(entityList);

    panel.appendChild(body);

    // ── Footer ─────────────────────────────────────────────────────────
    var footer = document.createElement('div');
    footer.className = 'pva-panel-footer';
    footer.innerHTML =
      '<div class="pva-footer-stats">' +
        '<span>Page: <b id="' + PREFIX + 'pagetype">--</b></span>' +
        '<span>Latency: <b id="' + PREFIX + 'latency">--</b></span>' +
      '</div>' +
      '<span class="pva-footer-shortcut">Ctrl+Shift+V</span>';
    panel.appendChild(footer);

    // ── Drag / resize handlers ───────────────────────────────────────────
    header.addEventListener('mousedown', onDragStart);
    panel.addEventListener('resize', onPanelResize);

    return panel;
  }

  // ─── Drag + Resize ─────────────────────────────────────────────────────────
  function onDragStart(e) {
    if (e.target.closest('.pva-header-btn')) return;

    state.drag = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: parseFloat(state.panel.style.left) || (window.innerWidth - state.panel.offsetWidth - 16),
      origTop: parseFloat(state.panel.style.top) || 16
    };

    var setPosition = function (ev) {
      if (!state.drag.active) return;
      var dx = ev.clientX - state.drag.startX;
      var dy = ev.clientY - state.drag.startY;
      var newLeft = clamp(state.drag.origLeft + dx, 0, Math.max(0, window.innerWidth - 60));
      var newTop = clamp(state.drag.origTop + dy, 0, Math.max(0, window.innerHeight - 60));
      state.panel.style.left = newLeft + 'px';
      state.panel.style.top = newTop + 'px';
      state.panel.style.right = 'auto';
    };

    var stopDrag = function () {
      state.drag.active = false;
      document.removeEventListener('mousemove', setPosition);
      document.removeEventListener('mouseup', stopDrag);
    };

    document.addEventListener('mousemove', setPosition);
    document.addEventListener('mouseup', stopDrag);
    e.preventDefault();
  }

  function onPanelResize() {}

  // ─── Event handlers ────────────────────────────────────────────────────────
  function onScroll() {
    updateOverlayPositions();
  }

  function onResize() {
    updateOverlayPositions();
  }

  function onKeydown(e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    }
  }

  function onMessage(message) {
    if (!message) return;
    if (message.type === 'SHOW_PRIVACY_VISUALIZER' && message.scanResults) {
      showVisualization(message.scanResults);
    } else if (message.type === 'HIDE_PRIVACY_VISUALIZER') {
      hideVisualization();
    } else if (message.type === 'TOGGLE_PRIVACY_VISUALIZER') {
      togglePanel();
    }
  }

  // DOM event bridge: content scripts run in an isolated world, so the
  // content script dispatches CustomEvents to control this page-world module.
  function onDomEvent(event) {
    var detail = event.detail || {};
    if (detail.action === 'show') {
      showVisualization(detail.scanResults || null);
    } else if (detail.action === 'hide') {
      hideVisualization();
    } else if (detail.action === 'toggle') {
      togglePanel();
    }
  }

  // ─── Mode management ───────────────────────────────────────────────────────
  function setMode(mode) {
    state.activeMode = mode;
    state.panel.querySelectorAll('.pva-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.getAttribute('data-mode') === mode);
    });

    hideOverlaysLayer();
    hideRedactionsLayer();
    hideOriginalLayer();

    if (mode === 'detection') {
      if (state.scanResults) {
        state.overlaysLayer.classList.remove('hidden');
        state.overlaysLayer.style.display = 'block';
        state.overlaysLayer.setAttribute('data-active', '1');
      } else {
        hideOverlaysLayer();
      }
    } else if (mode === 'redacted') {
      if (state.scanResults) {
        state.redactionLayer.classList.remove('hidden');
        state.redactionLayer.style.display = 'block';
      } else {
        hideRedactionsLayer();
      }
    } else if (mode === 'sanitized') {
      if (state.scanResults) showSanitizedTokens();
      else hideSanitizedTokens();
    }
    // 'original' just shows nothing (overlays hidden)
  }

  function hideOverlaysLayer() {
    state.overlaysLayer.classList.add('hidden');
    state.overlaysLayer.style.display = 'none';
    state.overlaysLayer.removeAttribute('data-active');
  }

  function hideRedactionsLayer() {
    state.redactionLayer.classList.add('hidden');
    state.redactionLayer.style.display = 'none';
  }

  function hideOriginalLayer() {
    state.originalLayer.classList.add('hidden');
  }

  // ─── Overlay rendering ─────────────────────────────────────────────────────
  function getEntityRisk(entity, risks) {
    if (risks && risks.length) {
      for (var i = 0; i < risks.length; i++) {
        if (risks[i].entityId === entity.id) {
          return risks[i].level || entity.risk || 'LOW';
        }
      }
    }
    return entity.risk || 'LOW';
  }

  function getEntityRect(entity) {
    var rect = null;
    if (entity.domSelector) {
      try {
        var el = document.querySelector(entity.domSelector);
        if (el && el.getBoundingClientRect) {
          var r = el.getBoundingClientRect();
          if (r.width > 0 || r.height > 0) {
            rect = {
              x: r.left + window.scrollX,
              y: r.top + window.scrollY,
              width: r.width,
              height: r.height
            };
          }
        }
      } catch (e) {}
    }
    if (!rect && entity.bbox && entity.bbox.width > 0) {
      rect = {
        x: entity.bbox.x + (window.scrollX || 0),
        y: entity.bbox.y + (window.scrollY || 0),
        width: entity.bbox.width || 20,
        height: entity.bbox.height || 20
      };
    }
    return rect;
  }

  function createOverlays(results) {
    clearOverlays();

    var entities = results.entities || [];
    var risks = results.risks || [];
    if (!entities.length) return 0;

    var created = 0;

    entities.forEach(function (entity) {
      var rect = getEntityRect(entity);
      if (!rect) return;

      var risk = getEntityRisk(entity, risks);
      var config = RISK_CONFIG[risk] || RISK_CONFIG.LOW;

      // Detection overlay
      var overlay = document.createElement('div');
      overlay.className = 'pva-entity-overlay';
      overlay.setAttribute('data-entity-id', entity.id);
      overlay.style.cssText =
        'position:absolute;' +
        'left:' + rect.x + 'px;' +
        'top:' + rect.y + 'px;' +
        'width:' + rect.width + 'px;' +
        'height:' + rect.height + 'px;' +
        'background:' + config.bg + ';' +
        'border:2px solid ' + config.border + ';' +
        'box-shadow:0 0 0 rgba(0,0,0,0);' +
        '--pva-glow:' + config.glow + ';';

      // label
      var label = document.createElement('div');
      label.className = 'pva-overlay-label';
      label.textContent = entity.type + ' \u00b7 ' + Math.round(entity.confidence * 100) + '%';
      label.style.background = config.badge;
      overlay.appendChild(label);

      overlay.addEventListener('click', function () {
        setMode('detection');
        highlightEntityInList(entity.id);
      });

      state.overlaysLayer.appendChild(overlay);

      // Redaction overlay
      var redact = document.createElement('div');
      redact.className = 'pva-redaction-overlay';
      redact.setAttribute('data-entity-id', entity.id);
      redact.style.cssText =
        'position:absolute;' +
        'left:' + rect.x + 'px;' +
        'top:' + rect.y + 'px;' +
        'width:' + rect.width + 'px;' +
        'height:' + rect.height + 'px;';

      var redactLabel = document.createElement('div');
      redactLabel.className = 'pva-redact-label';
      redactLabel.textContent = entity.type;
      redact.appendChild(redactLabel);

      state.redactionLayer.appendChild(redact);

      // Sanitized token overlay
      var token = document.createElement('div');
      token.className = 'pva-token-overlay';
      token.setAttribute('data-entity-id', entity.id);
      token.style.cssText =
        'position:absolute;' +
        'left:' + (rect.x - 2) + 'px;' +
        'top:' + (rect.y - 2) + 'px;' +
        'width:' + rect.width + 'px;' +
        'max-width:' + Math.max(60, rect.width) + 'px;' +
        'height:' + Math.max(rect.height, 18) + 'px;';
      token.innerHTML = '<span>' + tokenizeValue(entity.value, entity.type) + '</span>';
      state.originalLayer.appendChild(token);

      created++;
    });

    if (created > 0) {
      state.overlaysLayer.classList.remove('hidden');
      state.overlaysLayer.style.display = 'block';
    } else {
      hideOverlaysLayer();
    }

    return created;
  }

  function clearOverlays() {
    state.overlaysLayer.innerHTML = '';
    state.redactionLayer.innerHTML = '';
    state.originalLayer.innerHTML = '';
  }

  function updateOverlayPositions() {
    if (!state.scanResults) return;
    var entities = state.scanResults.entities || [];
    var overlays = state.overlaysLayer.querySelectorAll('.pva-entity-overlay');
    var redacts = state.redactionLayer.querySelectorAll('.pva-redaction-overlay');
    var tokens = state.originalLayer.querySelectorAll('.pva-token-overlay');

    entities.forEach(function (entity, idx) {
      var rect = getEntityRect(entity);
      if (!rect) return;
      var o = overlays[idx];
      var r = redacts[idx];
      var t = tokens[idx];
      if (o) {
        o.style.left = rect.x + 'px';
        o.style.top = rect.y + 'px';
        o.style.width = rect.width + 'px';
        o.style.height = rect.height + 'px';
      }
      if (r) {
        r.style.left = rect.x + 'px';
        r.style.top = rect.y + 'px';
        r.style.width = rect.width + 'px';
        r.style.height = rect.height + 'px';
      }
      if (t) {
        t.style.left = (rect.x - 2) + 'px';
        t.style.top = (rect.y - 2) + 'px';
        t.style.width = rect.width + 'px';
      }
    });
  }

  function showSanitizedTokens() {
    state.originalLayer.classList.remove('hidden');
    state.originalLayer.style.display = 'block';
  }

  function hideSanitizedTokens() {
    state.originalLayer.classList.add('hidden');
    state.originalLayer.style.display = 'none';
  }

  // ─── Entity list rendering ─────────────────────────────────────────────────
  function renderEntityList(scans) {
    var listEl = state.shadow.getElementById(PREFIX + 'entities');
    var entities = (scans.entities || []).slice();
    var risks = scans.risks || [];

    if (!entities.length) {
      listEl.innerHTML =
        '<div class="pva-empty-state">' +
          '<div class="pva-empty-icon">\u{1F50D}</div>' +
          '<div>No PII detected on this page.</div>' +
        '</div>';
      return;
    }

    // Sort by risk level
    entities.sort(function (a, b) {
      var ra = RISK_ORDER[getEntityRisk(a, risks)];
      var rb = RISK_ORDER[getEntityRisk(b, risks)];
      return (rb - ra) || (b.confidence - a.confidence);
    });

    var MAX_DISPLAY = 40;
    entities = entities.slice(0, MAX_DISPLAY);

    var html = '';
    entities.forEach(function (entity) {
      var risk = getEntityRisk(entity, risks);
      var masked = maskValue(entity.value, entity.type);
      html +=
        '<div class="pva-entity-row" data-entity-id="' + escapeHtml(entity.id) + '">' +
          '<span class="pva-entity-type rate-' + risk + '">' + escapeHtml(risk) + '</span>' +
          '<span class="pva-entity-value" title="' + escapeHtml(entity.type + ': ' + entity.value) + '">' +
            escapeHtml(entity.type) + ': ' + escapeHtml(masked) +
          '</span>' +
          '<span class="pva-entity-conf">' + Math.round(entity.confidence * 100) + '%</span>' +
        '</div>';
    });

    if ((scans.entities || []).length > MAX_DISPLAY) {
      html +=
        '<div class="pva-empty-state" style="padding:8px;">' +
          '... and ' + ((scans.entities.length - MAX_DISPLAY)) + ' more' +
        '</div>';
    }

    listEl.innerHTML = html;

    // Wire up click-to-highlight
    listEl.querySelectorAll('.pva-entity-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-entity-id');
        var target = state.overlaysLayer.querySelector('[data-entity-id="' + id + '"]');
        if (target) {
          setMode('detection');
          target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          target.classList.add('animate');
          setTimeout(function () { target.classList.remove('animate'); }, 1500);
        }
      });
    });
  }

  function highlightEntityInList(id) {
    var rows = state.shadow.getElementById(PREFIX + 'entities').querySelectorAll('.pva-entity-row');
    rows.forEach(function (row) {
      row.classList.toggle('active', row.getAttribute('data-entity-id') === id);
    });
  }

  // ─── Stats / gauge update ──────────────────────────────────────────────────
  function updateGauge(scans) {
    var total = scans.totalEntities || (scans.entities || []).length;
    var risks = scans.risks || [];
    var counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0 };

    (scans.entities || []).forEach(function (e) {
      var level = getEntityRisk(e, risks);
      if (counts[level] !== undefined) counts[level]++;
    });

    var circumference = 2 * Math.PI * 26;

    var gaugeFg = state.shadow.getElementById(PREFIX + 'gaugefg');
    var gaugeValue = state.shadow.getElementById(PREFIX + 'gaugevalue');
    var gaugeLabel = state.shadow.getElementById(PREFIX + 'gaugelabel');

    if (gaugeFg) {
      var ratio = total > 0 ? clamp((total - 1) / 30, 0, 1) : 0;
      gaugeFg.style.strokeDashoffset = circumference * (1 - ratio);
      // Color based on overall risk
      var overall = scans.overallRisk || 'LOW';
      var colors = { LOW: '#3b82f6', MEDIUM: '#eab308', HIGH: '#f97316', CRITICAL: '#ef4444' };
      gaugeFg.style.stroke = colors[overall] || '#3b82f6';
    }

    if (gaugeValue) gaugeValue.textContent = total;
    if (gaugeLabel) gaugeLabel.textContent = 'ENTITIES';

    // stat values
    var statEls = {
      statTotal: state.shadow.getElementById(PREFIX + 'statTotal'),
      statCritical: state.shadow.getElementById(PREFIX + 'statCritical'),
      statHigh: state.shadow.getElementById(PREFIX + 'statHigh'),
      statMedium: state.shadow.getElementById(PREFIX + 'statMedium')
    };

    if (statEls.statTotal) {
      statEls.statTotal.textContent = total;
      statEls.statTotal.classList.toggle('zero', total === 0);
    }
    if (statEls.statCritical) {
      statEls.statCritical.textContent = counts.CRITICAL;
      statEls.statCritical.classList.toggle('zero', counts.CRITICAL === 0);
    }
    if (statEls.statHigh) {
      statEls.statHigh.textContent = counts.HIGH;
      statEls.statHigh.classList.toggle('zero', counts.HIGH === 0);
    }
    if (statEls.statMedium) {
      statEls.statMedium.textContent = counts.MEDIUM;
      statEls.statMedium.classList.toggle('zero', counts.MEDIUM === 0);
    }
  }

  // ─── Toggle behaviors ──────────────────────────────────────────────────────
  function toggleMinimized() {
    state.panel.classList.toggle('minimized');
    var btn = state.shadow.getElementById(PREFIX + 'minimizeBtn');
    if (btn) {
      btn.textContent = state.panel.classList.contains('minimized') ? '\u002b' : '\u2013';
    }
  }

  function togglePanel() {
    if (state.visible) {
      hideVisualization();
    } else {
      // Try to use last scan if available, else just show empty panel
      if (!state.scanResults && window.__PVA_LAST_SCAN__) {
        showVisualization(window.__PVA_LAST_SCAN__);
      } else {
        showPanel();
      }
    }
  }

  function showPanel() {
    if (state.visible) return;
    state.visible = true;
    state.panel.style.display = 'flex';
    state.toggler.style.display = 'none';
  }

  function hidePanel() {
    if (!state.visible) return;
    state.visible = false;
    state.panel.style.display = 'none';
    state.toggler.classList.add('visible');
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  function showVisualization(scanResults) {
    init();
    state.scanResults = scanResults || null;

    // Header sub
    var sub = state.shadow.getElementById(PREFIX + 'headersub');
    if (sub) {
      if (scanResults) {
        sub.textContent = scanResults.pageTitle || scanResults.url || 'Scan complete';
      }
    }

    // Page type / latency
    var pageTypeEl = state.shadow.getElementById(PREFIX + 'pagetype');
    if (pageTypeEl) {
      pageTypeEl.textContent = scanResults && scanResults.pageType
        ? String(scanResults.pageType).replace(/_/g, ' ')
        : '--';
    }
    var latencyEl = state.shadow.getElementById(PREFIX + 'latency');
    if (latencyEl) {
      latencyEl.textContent = scanResults && scanResults.processingTime
        ? scanResults.processingTime.total + 'ms'
        : '--';
    }

    // tab counts
    var total = scanResults ? (scanResults.totalEntities || (scanResults.entities || []).length) : 0;
    var tabTotal = state.shadow.getElementById(PREFIX + 'tabcount-sanitized');
    if (tabTotal) tabTotal.textContent = total;
    var tabDetect = state.shadow.getElementById(PREFIX + 'tabcount-detection');
    if (tabDetect) tabDetect.textContent = total;

    if (scanResults) {
      createOverlays(scanResults);
      renderEntityList(scanResults);
      updateGauge(scanResults);
      updateCompare(scanResults);
    } else {
      clearOverlays();
      var listEl = state.shadow.getElementById(PREFIX + 'entities');
      if (listEl) {
        listEl.innerHTML =
          '<div class="pva-empty-state">' +
            '<div class="pva-empty-icon">\u{1F9E0}</div>' +
            '<div>Run a scan, then re-open the visualizer to see results.</div>' +
          '</div>';
      }
      hideOverlaysLayer();
      hideRedactionsLayer();
      hideSanitizedTokens();
    }

    // Reset mode
    setMode(state.activeMode || 'detection');

    // Show panel
    showPanel();
  }

  function hideVisualization() {
    if (!state.initialized) return;
    state.visible = false;
    state.panel.style.display = 'none';
    state.toggler.classList.add('visible');
    state.scanResults = null;
    clearOverlays();
    hideOverlaysLayer();
    hideRedactionsLayer();
    hideSanitizedTokens();
    hideCompare();
  }

  // ─── Compare slider ────────────────────────────────────────────────────────
  function updateCompare(scans) {
    var compare = state.shadow.getElementById(PREFIX + 'compare');
    if (!compare) return;
    if (!scans || !scans.entities || !scans.entities.length) {
      renderCompareEmpty(compare, null);
      return;
    }
    renderCompareSlider(compare, scans);
  }

  function hideCompare() {
    var compare = state.shadow.getElementById(PREFIX + 'compare');
    if (compare) {
      compare.classList.remove('visible');
      state.compareActive = false;
    }
  }

  function renderCompareEmpty(container) {
    container.innerHTML =
      '<div class="pva-compare-empty">' +
        '<div class="pva-compare-icon">\u{1F4F7}</div>' +
        '<div>Run a scan to see the redacted screenshot comparison.</div>' +
      '</div>';
    container.classList.remove('visible');
    state.compareActive = false;
  }

  function renderCompareSlider(container, scans) {
    var original = scans.screenshot ||
      (scans.sanitizedContext && scans.sanitizedContext.screenshot) || null;
    var redacted = (scans.sanitizedContext && scans.sanitizedContext.redactedScreenshot) || null;

    if (!original && !redacted) {
      renderCompareEmpty(container);
      return;
    }

    var origSrc = original || redacted;
    var redSrc = redacted || original;

    container.innerHTML =
      '<img class="pva-compare-img" id="' + PREFIX + 'cmp-orig" src="' + escapeHtml(origSrc) + '" alt="Original">' +
      '<img class="pva-compare-img redacted" id="' + PREFIX + 'cmp-red" src="' + escapeHtml(redSrc) + '" alt="Redacted">' +
      '<div class="pva-compare-divider" id="' + PREFIX + 'cmp-divider">' +
        '<div class="pva-compare-handle">\u21c4</div>' +
      '</div>' +
      '<div class="pva-compare-label red" id="' + PREFIX + 'cmp-label-red">Redacted</div>' +
      '<div class="pva-compare-label orig">Original</div>';
    container.classList.add('visible');
    state.compareActive = true;

    var divider = container.querySelector('#' + PREFIX + 'cmp-divider');
    var redImg = container.querySelector('#' + PREFIX + 'cmp-red');
    var label = container.querySelector('#' + PREFIX + 'cmp-label-red');

    var pos = state.comparePosition;

    function renderPos(p) {
      pos = clamp(p, 5, 95);
      state.comparePosition = pos;
      if (divider) divider.style.left = pos + '%';
      if (redImg) redImg.style.clipPath = 'inset(0 0 0 ' + pos + '%)';
      if (label) label.style.left = pos + '%';
    }

    function onPointer(e) {
      var rect = container.getBoundingClientRect();
      var ratio = (e.clientX - rect.left) / rect.width;
      renderPos(Math.round(ratio * 100));
    }

    divider.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      divider.setPointerCapture(e.pointerId);
      divider.addEventListener('pointermove', onPointer);
    });

    divider.addEventListener('pointerup', function () {
      divider.removeEventListener('pointermove', onPointer);
    });

    renderPos(pos);
  }

  // ─── Expose globally ───────────────────────────────────────────────────────
  window.PrivacyVisualizer = {
    showVisualization: showVisualization,
    hideVisualization: hideVisualization,
    toggle: togglePanel,
    setMode: setMode,
    isVisible: function () { return state.visible; }
  };
})();
