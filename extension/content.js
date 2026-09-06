/**
 * Privacy Vision Agent - Content Script
 * Self-contained privacy detection pipeline running on every webpage.
 * No ES module imports - all functionality is inlined.
 */
(function () {
  'use strict';

  if (window.__PVA_CONTENT_LOADED__) return;
  window.__PVA_CONTENT_LOADED__ = true;

  var PVA_VERSION = '1.0.0';
  var SCAN_COOLDOWN_MS = 2000;
  var OVERLAY_PREFIX = 'pva-overlay-';
  var ENTITY_ID_PREFIX = 'ent';

  // ─── Global State ───────────────────────────────────────────────────────────
  var lastScanResult = null;
  var overlayVisible = false;
  var observerActive = false;
  var debounceTimer = null;
  var scanInProgress = false;
  var piiMLLoadPromise = null;
  var piiML = null;
  var mlScanMs = 0;

  window.__PVA_LAST_SCAN__ = null;
  window.__PVA_OVERLAY_VISIBLE__ = false;

  // ─── ID Generator ───────────────────────────────────────────────────────────
  var idCounter = 0;
  function generateId(prefix) {
    idCounter++;
    return (prefix || ENTITY_ID_PREFIX) + '_' + Date.now().toString(36) + '_' + idCounter;
  }

  // ─── PII Detection Patterns ─────────────────────────────────────────────────
  var EMAIL_EXCLUSIONS = {
    'example.com': 1, 'test.com': 1, 'localhost': 1, 'domain.com': 1,
    'email.com': 1, 'mail.com': 1, 'sentry.io': 1, 'wixpress.com': 1,
    'example.org': 1, 'example.net': 1, 'test.org': 1, 'invalid': 1,
    'localhost.localdomain': 1
  };
  var EMAIL_FILTER = /^(?:test|admin|info|noreply|no-reply|support|hello|webmaster|postmaster|abuse|hostmaster)@/i;

  var TRUSTED_DOMAINS = {
    'google.com': 1, 'microsoft.com': 1, 'apple.com': 1, 'github.com': 1,
    'mozilla.org': 1, 'w3.org': 1, 'schema.org': 1, 'cloudflare.com': 1,
    'amazonaws.com': 1, 'gstatic.com': 1, 'googleapis.com': 1
  };

  var PATTERNS = {
    EMAIL: [/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g],
    PHONE: [
      /\+?\d{1,3}[\s.\-]?\(?\d{2,4}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}/g,
      /\(\d{3}\)\s?\d{3}[\s.\-]\d{4}/g,
      /\d{3}[\s.\-]\d{3}[\s.\-]\d{4}/g,
      /\d{5}\s\d{6}/g
    ],
    CREDIT_CARD: [
      /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,
      /\b\d{4}[\s\-]?\d{6}[\s\-]?\d{4}\b/g,
      /\b\d{4}[\s\-]?\d{5}[\s\-]?\d{5}\b/g
    ],
    SSN: [/\b\d{3}-?\d{2}-?\d{4}\b/g],
    API_KEY: [
      /\b(?:sk|pk|ak|rk|ghp|gho|ghu|ghs|github_pat|xox[baprs])[_\-]?[A-Za-z0-9\-]{16,}\b/g,
      /\b(?:AIza)[A-Za-z0-9_\-]{35}\b/g,
      /(?:api[_\-]?key|apikey|secret[_\-]?key|access[_\-]?key)\s*[:=]\s*['"]?([A-Za-z0-9_\-]{20,})['"]?/gi
    ],
    JWT: [/\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g],
    BEARER: [/Bearer\s+[A-Za-z0-9_\-\.]{20,}/gi],
    AUTH_TOKEN: [
      /\b(?:sess|sid|token|jwt)[_\-]?[A-Za-z0-9_\-]{20,}\b/gi
    ],
    GOV_ID: [
      /\b\d{3}-?\d{2}-?\d{4}\b/g,
      /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
      /\b[A-Z]{5}\d{4}[A-Z]\b/gi,
      /\b\d{12}\b/g,
      /\b[A-Z]{1,2}\d{6,7}[A-Z\d]\b/gi
    ],
    BANK_ACCOUNT: [
      /\b(?:account|acct)[\s.#:_\-]*(?:number|#|no\.?)?[\s:#_]*(\d{8,17})\b/gi,
      /\b(?:routing|rtn|aba)[\s.#:_\-]*(?:number|#|no\.?)?[\s:#_]*(\d{9})\b/gi,
      /\b\d{9}\b/g
    ],
    MEDICAL_ID: [
      /\b(?:MRN|mrn)[\s.\-]?\d{6,10}\b/gi
    ]
  };

  var BASE_RISK = {
    PASSWORD: 'CRITICAL', API_KEY: 'CRITICAL', AUTH_TOKEN: 'CRITICAL', CREDIT_CARD: 'CRITICAL',
    EMAIL: 'HIGH', PHONE: 'HIGH', BANK_ACCOUNT: 'HIGH', GOVERNMENT_ID: 'HIGH',
    MEDICAL_ID: 'HIGH', FINANCIAL_DATA: 'HIGH',
    USERNAME: 'MEDIUM', NAME: 'MEDIUM', ADDRESS: 'MEDIUM', DATE_OF_BIRTH: 'MEDIUM',
    PRIVATE_DOCUMENT_CONTENT: 'MEDIUM'
  };

  var SENSITIVITY_MAP = {
    PASSWORD: 1.0, API_KEY: 1.0, AUTH_TOKEN: 1.0, CREDIT_CARD: 1.0,
    EMAIL: 0.8, PHONE: 0.8, BANK_ACCOUNT: 0.8, GOVERNMENT_ID: 0.8,
    MEDICAL_ID: 0.8, FINANCIAL_DATA: 0.8,
    USERNAME: 0.5, NAME: 0.5, ADDRESS: 0.5, DATE_OF_BIRTH: 0.5,
    PRIVATE_DOCUMENT_CONTENT: 0.5
  };

  // ─── Credit Card Luhn Check ─────────────────────────────────────────────────
  function luhnCheck(num) {
    var digits = num.replace(/[\s\-]/g, '');
    if (!/^\d{13,19}$/.test(digits)) return false;
    var sum = 0;
    var alternate = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var n = parseInt(digits[i], 10);
      if (isNaN(n)) return false;
      if (alternate) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alternate = !alternate;
    }
    return sum % 10 === 0;
  }

  // ─── Phone Validation ───────────────────────────────────────────────────────
  function isValidPhone(value) {
    var stripped = value.replace(/[\s()+.\-]/g, '');
    if (stripped.length < 7 || stripped.length > 15) return false;
    if (/^\d{7,8}$/.test(stripped)) return false;
    var digitCount = stripped.replace(/\D/g, '').length;
    return digitCount >= 7 && digitCount <= 15;
  }

  function normalizePhone(raw) {
    return raw.replace(/[\s()+.\-]/g, '');
  }

  // ─── Core PII Detector ──────────────────────────────────────────────────────
  function detectPII(text, domContext) {
    if (!text || text.trim().length === 0) return [];
    var entities = [];
    var seen = {};

    function addEntity(type, value, confidence, source) {
      var key = type + ':' + value;
      if (seen[key]) return;
      seen[key] = true;
      entities.push({
        id: generateId('ent'),
        type: type,
        value: value,
        bbox: { x: 0, y: 0, width: 0, height: 0 },
        confidence: Math.round(confidence * 1000) / 1000,
        risk: BASE_RISK[type] || 'LOW',
        source: source || 'REGEX',
        timestamp: Date.now(),
        context: extractSurrounding(value, text),
        domSelector: null
      });
    }

    function extractSurrounding(target, fullText) {
      var idx = fullText.indexOf(target);
      if (idx === -1) return '';
      var start = Math.max(0, idx - 60);
      var end = Math.min(fullText.length, idx + target.length + 60);
      return fullText.substring(start, end).trim();
    }

    function findMatches(patternArray) {
      var results = [];
      for (var p = 0; p < patternArray.length; p++) {
        var re = new RegExp(patternArray[p].source, patternArray[p].flags);
        var match;
        while ((match = re.exec(text)) !== null) {
          results.push(match[0]);
        }
      }
      return results;
    }

    // Password detection from DOM
    if (domContext && domContext.hasPasswordField) {
      if (text.length >= 4 && text.length <= 128) {
        addEntity('PASSWORD', text, 0.95, 'REGEX');
      }
    }

    // EMAIL
    var emails = findMatches(PATTERNS.EMAIL);
    for (var e = 0; e < emails.length; e++) {
      var email = emails[e];
      var domain = email.split('@')[1]?.toLowerCase() || '';
      if (EMAIL_EXCLUSIONS[domain]) continue;
      if (EMAIL_FILTER.test(email)) continue;
      var emailConf = 0.9;
      if (TRUSTED_DOMAINS[domain]) emailConf -= 0.2;
      if (domContext && domContext.hasEmailField) emailConf += 0.08;
      if (emailConf > 0.2) addEntity('EMAIL', email, Math.min(emailConf, 1), 'REGEX');
    }

    // PHONE
    var phoneSeen = {};
    for (var p = 0; p < PATTERNS.PHONE.length; p++) {
      var phoneMatches = findMatches([PATTERNS.PHONE[p]]);
      for (var ph = 0; ph < phoneMatches.length; ph++) {
        var phone = phoneMatches[ph];
        if (!isValidPhone(phone)) continue;
        var normalized = normalizePhone(phone);
        if (phoneSeen[normalized]) continue;
        phoneSeen[normalized] = true;
        var phoneConf = 0.85;
        if (normalized.startsWith('+')) phoneConf += 0.05;
        if (/^\+1?\d{10}$/.test(normalized)) phoneConf += 0.03;
        if (domContext && domContext.hasPhoneField) phoneConf += 0.1;
        addEntity('PHONE', phone, Math.min(phoneConf, 1), 'REGEX');
      }
    }

    // CREDIT CARD
    var ccSeen = {};
    for (var c = 0; c < PATTERNS.CREDIT_CARD.length; c++) {
      var ccMatches = findMatches([PATTERNS.CREDIT_CARD[c]]);
      for (var ci = 0; ci < ccMatches.length; ci++) {
        var cc = ccMatches[ci];
        if (!luhnCheck(cc)) continue;
        var ccDigits = cc.replace(/\D/g, '');
        if (ccSeen[ccDigits]) continue;
        ccSeen[ccDigits] = true;
        addEntity('CREDIT_CARD', cc, 0.95, 'REGEX');
      }
    }

    // SSN / Government ID
    var govMatches = findMatches(PATTERNS.GOV_ID);
    for (var g = 0; g < govMatches.length; g++) {
      var gov = govMatches[g];
      var stripped = gov.replace(/[\s\-]/g, '');
      var govConf = 0;
      var govType = 'GOVERNMENT_ID';
      if (/^\d{3}-?\d{2}-?\d{4}$/.test(stripped)) govConf = 0.92;
      else if (/^\d{4}\s?\d{4}\s?\d{4}$/.test(stripped)) govConf = 0.88;
      else if (/^[A-Z]{5}\d{4}[A-Z]$/i.test(stripped)) govConf = 0.9;
      else if (/^[A-Z]\d{7,8}$/i.test(stripped)) govConf = 0.85;
      else if (/^\d{12}$/.test(stripped)) govConf = 0.8;
      else if (/^[A-Z]{1,2}\d{6,7}[A-Z\d]$/i.test(stripped)) govConf = 0.82;
      else continue;
      if (domContext && domContext.hasGovernmentField) govConf = Math.min(govConf + 0.1, 0.98);
      addEntity(govType, gov, govConf, 'REGEX');
    }

    // API Key
    var apiKeyMatches = findMatches(PATTERNS.API_KEY);
    for (var k = 0; k < apiKeyMatches.length; k++) {
      var key = apiKeyMatches[k];
      var keyConf = 0.7;
      if (/\bsk[_\-](?:live[_\-]|test[_\-]|prod[_\-])?[A-Za-z0-9]{16,64}\b/.test(key)) keyConf = 0.95;
      else if (/\bpk[_\-](?:live[_\-]|test[_\-]|prod[_\-])?[A-Za-z0-9]{16,64}\b/.test(key)) keyConf = 0.95;
      else if (/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/.test(key)) keyConf = 0.98;
      else if (/\b(?:xox[baprs])-[A-Za-z0-9\-]{10,48}\b/.test(key)) keyConf = 0.97;
      else if (/\b(?:AIza)[A-Za-z0-9_\-]{35}\b/.test(key)) keyConf = 0.96;
      addEntity('API_KEY', key, keyConf, 'REGEX');
    }

    // JWT
    var jwtMatches = findMatches(PATTERNS.JWT);
    for (var j = 0; j < jwtMatches.length; j++) {
      var jwt = jwtMatches[j];
      var jwtConf = 0.7;
      var parts = jwt.split('.');
      if (parts.length === 3) {
        try {
          var header = JSON.parse(atob(parts[0]));
          if (header.alg && header.typ) jwtConf = 0.97;
        } catch (e) { jwtConf = 0.7; }
      }
      addEntity('AUTH_TOKEN', jwt, jwtConf, 'REGEX');
    }

    // Bearer tokens
    var bearerMatches = findMatches(PATTERNS.BEARER);
    for (var b = 0; b < bearerMatches.length; b++) {
      addEntity('AUTH_TOKEN', bearerMatches[b], 0.95, 'REGEX');
    }

    // Other auth tokens
    var tokenMatches = findMatches(PATTERNS.AUTH_TOKEN);
    for (var t = 0; t < tokenMatches.length; t++) {
      var token = tokenMatches[t];
      var tokenConf = 0.85;
      if (/^(?:sess|sid|token|jwt)[_\-]?[A-Za-z0-9_\-]{20,}$/i.test(token)) tokenConf = 0.85;
      addEntity('AUTH_TOKEN', token, tokenConf, 'REGEX');
    }

    // Medical ID
    var medMatches = findMatches(PATTERNS.MEDICAL_ID);
    for (var m = 0; m < medMatches.length; m++) {
      var med = medMatches[m];
      var medConf = 0.75;
      if (/^MRN[\s.\-]?\d{6,10}$/i.test(med)) medConf = 0.88;
      if (domContext && domContext.hasMedicalField) medConf = Math.min(medConf + 0.1, 0.95);
      addEntity('MEDICAL_ID', med, medConf, 'REGEX');
    }

    // Bank Account (only when financial context present)
    if (domContext && domContext.hasFinancialField) {
      var bankMatches = findMatches(PATTERNS.BANK_ACCOUNT);
      for (var ba = 0; ba < bankMatches.length; ba++) {
        addEntity('BANK_ACCOUNT', bankMatches[ba], 0.82, 'REGEX');
      }
    }

    // Address detection
    var streetRe = /\d+\s+[A-Za-z0-9\s]+(?:st|nd|rd|th|ave|blvd|dr|ln|way|ct|pl|cir|hwy|terr|trail|pkwy)\b/i;
    var zipRe = /\b\d{5}(?:-\d{4})?\b/;
    var addressParts = text.split(/[;|\n]/);
    for (var a = 0; a < addressParts.length; a++) {
      var addrPart = addressParts[a].trim();
      if (addrPart.length > 5 && addrPart.length < 200) {
        var hasStreet = streetRe.test(addrPart);
        var hasZip = zipRe.test(addrPart);
        if (hasStreet && hasZip) addEntity('ADDRESS', addrPart, 0.88, 'REGEX');
        else if (hasStreet) addEntity('ADDRESS', addrPart, 0.75, 'REGEX');
      }
    }

    // Financial data
    var currencyRe = /^[\$€£¥]\s?\d{1,3}(?:[,.]\d{3})*(?:\.\d{2})?$/;
    var currencyAltRe = /^\d{1,3}(?:[,.]\d{3})*(?:\.\d{2})?\s?(?:USD|EUR|GBP|INR|JPY|CAD|AUD)$/i;
    if (currencyRe.test(text.trim()) || currencyAltRe.test(text.trim())) {
      var numStr = text.replace(/[^0-9.]/g, '');
      var amount = parseFloat(numStr);
      if (!isNaN(amount) && amount > 0) {
        var finConf = amount > 100000 ? 0.65 : amount > 10000 ? 0.55 : 0.45;
        addEntity('FINANCIAL_DATA', text.trim(), finConf, 'REGEX');
      }
    }

    return entities;
  }

  // ─── Risk Scoring ───────────────────────────────────────────────────────────
  function scoreEntities(entities, pageType) {
    var PAGE_TYPE_SENSITIVITY = {
      banking: 0.95, healthcare: 0.9, payment: 0.9, login: 0.85,
      ecommerce: 0.8, admin_dashboard: 0.75, saas_dashboard: 0.75,
      social_media: 0.6, profile: 0.6, registration: 0.55, settings: 0.5,
      email: 0.5, job_portal: 0.45, government: 0.9, unknown: 0.3
    };

    var weights = {
      entitySensitivity: 0.30,
      modelConfidence: 0.25,
      domContext: 0.20,
      pageContext: 0.15,
      semanticContext: 0.10
    };

    var HIGH_RISK_TERMS = [
      'password', 'secret', 'private', 'confidential', 'sensitive',
      'credential', 'pin', 'ssn', 'social security', 'aadhaar',
      'pan', 'passport', 'bank account', 'credit card', 'debit card'
    ];

    function riskLevel(score) {
      if (score >= 0.8) return 'CRITICAL';
      if (score >= 0.6) return 'HIGH';
      if (score >= 0.35) return 'MEDIUM';
      return 'LOW';
    }

    function computeSemantic(text) {
      var lower = (text || '').toLowerCase();
      var highHits = 0;
      for (var i = 0; i < HIGH_RISK_TERMS.length; i++) {
        if (lower.includes(HIGH_RISK_TERMS[i])) highHits++;
      }
      if (highHits === 0) return 0.5;
      var normalized = Math.tanh(highHits / 3);
      return Math.max(0, Math.min(1, 0.5 + normalized * 0.5));
    }

    return entities.map(function (entity) {
      var entitySensitivity = SENSITIVITY_MAP[entity.type] || 0.5;
      var modelConfidence = Math.max(0, Math.min(1, entity.confidence));
      var domContext = 0.4;
      var pageCtxScore = PAGE_TYPE_SENSITIVITY[pageType] || 0.3;
      var semanticCtx = computeSemantic(entity.context || '');

      var overall =
        weights.entitySensitivity * entitySensitivity +
        weights.modelConfidence * modelConfidence +
        weights.domContext * domContext +
        weights.pageContext * pageCtxScore +
        weights.semanticContext * semanticCtx;

      var clamped = Math.max(0, Math.min(1, overall));

      return {
        entityId: entity.id,
        overall: clamped,
        entitySensitivity: entitySensitivity,
        modelConfidence: modelConfidence,
        domContext: domContext,
        pageContext: pageCtxScore,
        semanticContext: semanticCtx,
        level: riskLevel(clamped)
      };
    });
  }

  function computeOverallRisk(risks) {
    if (risks.length === 0) return 'LOW';
    var RISK_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
    var overall = 'LOW';
    for (var i = 0; i < risks.length; i++) {
      if (RISK_ORDER[risks[i].level] > RISK_ORDER[overall]) {
        overall = risks[i].level;
      }
    }
    return overall;
  }

  // ─── Page Type Classification ───────────────────────────────────────────────
  var PAGE_TYPE_SIGNALS = {
    banking: {
      urlPatterns: [/bank/i, /account\/?(?:overview|balance|summary)/i, /wire/i, /transfer/i, /loan/i, /invest/i],
      keywords: ['account balance', 'transfer funds', 'wire transfer', 'routing number', 'iban'],
      formHints: ['routing', 'account number', 'iban', 'swift', 'bic']
    },
    login: {
      urlPatterns: [/login/i, /signin/i, /sign-in/i, /auth/i, /sso/i, /oauth/i],
      keywords: ['sign in', 'log in', 'forgot password', 'remember me'],
      formHints: ['username', 'password', 'email address']
    },
    registration: {
      urlPatterns: [/register/i, /signup/i, /sign-up/i, /create.?account/i],
      keywords: ['create account', 'sign up', 'confirm password', 'agree to terms'],
      formHints: ['confirm password', 'agree', 'terms']
    },
    payment: {
      urlPatterns: [/pay/i, /billing/i, /invoice/i, /checkout/i, /stripe/i, /paypal/i],
      keywords: ['credit card', 'debit card', 'billing address', 'payment', 'charge'],
      formHints: ['card number', 'cvv', 'expiry', 'billing address']
    },
    ecommerce: {
      urlPatterns: [/shop/i, /store/i, /cart/i, /checkout/i, /product/i, /buy/i],
      keywords: ['add to cart', 'checkout', 'shipping address', 'billing'],
      formHints: ['card number', 'cvv', 'expiry', 'billing', 'shipping']
    },
    healthcare: {
      urlPatterns: [/health/i, /medical/i, /patient/i, /clinic/i, /hospital/i, /diagnos/i],
      keywords: ['patient', 'diagnosis', 'prescription', 'medical record', 'appointment'],
      formHints: ['medical history', 'allergies', 'medication', 'insurance id']
    },
    government: {
      urlPatterns: [/gov\./i, /\.gov/i, /tax/i, /irs/i, /passport/i, /aadhaar/i],
      keywords: ['social security', 'tax return', 'citizen', 'government id'],
      formHints: ['ssn', 'taxpayer id', 'license number', 'passport']
    },
    admin_dashboard: {
      urlPatterns: [/admin/i, /dashboard/i, /panel/i, /console/i, /manage/i],
      keywords: ['dashboard', 'analytics', 'settings', 'users', 'admin'],
      formHints: ['api key', 'secret', 'token', 'webhook']
    },
    email: {
      urlPatterns: [/mail/i, /inbox/i, /email/i, /compose/i, /outlook/i, /gmail/i],
      keywords: ['inbox', 'compose', 'sent', 'draft', 'subject'],
      formHints: ['to', 'subject', 'message body']
    },
    social_media: {
      urlPatterns: [/feed/i, /timeline/i, /profile/i, /friend/i, /post/i, /message/i],
      keywords: ['friends', 'followers', 'posts', 'share', 'like', 'comment'],
      formHints: ['bio', 'about me', 'website link']
    },
    saas_dashboard: {
      urlPatterns: [/workspace/i, /project/i, /team/i],
      keywords: ['workspace', 'project', 'api', 'usage', 'plan', 'billing'],
      formHints: ['api key', 'project name', 'webhook url']
    }
  };

  function classifyPageType(url, title, formHints, bodyText) {
    var lowerUrl = (url || '').toLowerCase();
    var lowerTitle = (title || '').toLowerCase();
    var lowerBody = (bodyText || '').slice(0, 5000).toLowerCase();
    var lowerFormHints = (formHints || []).join(' ').toLowerCase();

    var bestType = 'unknown';
    var bestScore = 0;

    var types = Object.keys(PAGE_TYPE_SIGNALS);
    for (var i = 0; i < types.length; i++) {
      var type = types[i];
      if (type === 'unknown') continue;
      var signals = PAGE_TYPE_SIGNALS[type];
      var score = 0;

      for (var u = 0; u < signals.urlPatterns.length; u++) {
        if (signals.urlPatterns[u].test(lowerUrl)) score += 3;
        if (signals.urlPatterns[u].test(lowerTitle)) score += 2;
      }
      for (var k = 0; k < signals.keywords.length; k++) {
        if (lowerBody.includes(signals.keywords[k])) score += 1;
        if (lowerTitle.includes(signals.keywords[k])) score += 1;
      }
      for (var f = 0; f < signals.formHints.length; f++) {
        if (lowerFormHints.includes(signals.formHints[f])) score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }
    return bestType;
  }

  // ─── DOM Extraction ─────────────────────────────────────────────────────────
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, MATH: 1 };
  var INTERACTIVE_TAGS = { A: 1, BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1 };

  function cssSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    var parts = [];
    var current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      var selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = '#' + CSS.escape(current.id);
        parts.unshift(selector);
        break;
      }
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === current.tagName;
        });
        if (siblings.length > 1) {
          var index = Array.prototype.indexOf.call(siblings, current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }
      if (current.className && typeof current.className === 'string') {
        var classes = current.className.trim().split(/\s+/).slice(0, 2);
        if (classes.length > 0) {
          selector += '.' + classes.map(function (c) { return CSS.escape(c); }).join('.');
        }
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function getBoundingBox(el) {
    var rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x * 100) / 100,
      y: Math.round(rect.y * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100
    };
  }

  function isElementVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right < 0 || rect.left > window.innerWidth) return false;
    return true;
  }

  function getElementText(el) {
    if (el instanceof HTMLInputElement) {
      return el.value || el.placeholder || el.getAttribute('aria-label') || '';
    }
    if (el instanceof HTMLSelectElement) {
      var selected = el.options[el.selectedIndex];
      return selected ? selected.text : '';
    }
    if (el instanceof HTMLTextAreaElement) {
      return el.value || el.placeholder || '';
    }
    if (el instanceof HTMLButtonElement) {
      return (el.textContent || '').trim() || el.getAttribute('aria-label') || '';
    }
    if (el instanceof HTMLAnchorElement) {
      return (el.textContent || '').trim() || el.title || el.getAttribute('aria-label') || '';
    }
    return (el.textContent || '').trim() || '';
  }

  function resolveLabelForField(field) {
    if (field.id) {
      var labelEl = document.querySelector('label[for="' + CSS.escape(field.id) + '"]');
      if (labelEl) return (labelEl.textContent || '').trim() || undefined;
    }
    var parent = field.parentElement;
    for (var depth = 0; depth < 5 && parent; depth++) {
      if (parent.tagName === 'LABEL') return (parent.textContent || '').trim() || undefined;
      var lbl = parent.querySelector('label');
      if (lbl) return (lbl.textContent || '').trim() || undefined;
      parent = parent.parentElement;
    }
    if (field.getAttribute('aria-label')) return field.getAttribute('aria-label');
    if (field.placeholder) return field.placeholder;
    var title = field.getAttribute('title');
    if (title) return title;
    return undefined;
  }

  function extractDOMElements() {
    var elements = [];
    var allElements = document.querySelectorAll(
      'a, button, input, select, textarea, [role="button"], [role="link"], ' +
      '[role="checkbox"], [role="radio"], [role="switch"], [role="textbox"], ' +
      '[role="combobox"], [role="tab"], [role="menuitem"], [role="slider"], [tabindex]'
    );

    for (var i = 0; i < allElements.length; i++) {
      var el = allElements[i];
      if (SKIP_TAGS[el.tagName]) continue;
      if (el.closest('[hidden]') || el.hasAttribute('hidden')) continue;

      var isVisible = isElementVisible(el);
      var rect = getBoundingBox(el);
      var tag = el.tagName.toLowerCase();
      var isInput = false, isButton = false, isLink = false;
      var type, name, placeholder, value, autocomplete, inputType;

      if (el instanceof HTMLInputElement) {
        isInput = true;
        inputType = el.type;
        type = 'input';
        name = el.name || undefined;
        placeholder = el.placeholder || undefined;
        autocomplete = el.autocomplete || undefined;
        if (['text', 'password', 'email', 'tel', 'url', 'search', 'number'].indexOf(el.type) !== -1) {
          value = el.value || undefined;
        }
      } else if (el instanceof HTMLButtonElement) {
        isButton = true;
        type = 'button';
        name = el.name || undefined;
      } else if (el instanceof HTMLSelectElement) {
        isInput = true;
        type = 'select';
        name = el.name || undefined;
      } else if (el instanceof HTMLTextAreaElement) {
        isInput = true;
        type = 'textarea';
        name = el.name || undefined;
        placeholder = el.placeholder || undefined;
        value = el.value || undefined;
      } else if (el instanceof HTMLAnchorElement) {
        isLink = true;
        type = 'anchor';
        value = el.href || undefined;
      } else {
        var role = el.getAttribute('role');
        if (role === 'button' || role === 'menuitem' || role === 'tab' || role === 'switch') {
          isButton = true;
          type = 'role-button';
        } else if (role === 'link') {
          isLink = true;
          type = 'role-link';
        } else if (role === 'textbox' || role === 'combobox') {
          isInput = true;
          type = 'role-input';
          placeholder = el.getAttribute('aria-placeholder') || undefined;
        }
      }

      var text = getElementText(el);

      elements.push({
        tagName: tag,
        text: text,
        type: type,
        name: name,
        placeholder: placeholder,
        value: value,
        id: el.id || undefined,
        className: (typeof el.className === 'string' && el.className.trim()) ? el.className.trim() : undefined,
        selector: cssSelector(el),
        rect: rect,
        isVisible: isVisible,
        isInput: isInput,
        isButton: isButton,
        isLink: isLink,
        autocomplete: autocomplete,
        ariaLabel: el.getAttribute('aria-label') || undefined,
        inputType: inputType
      });
    }
    return elements;
  }

  function extractFormFields() {
    var fields = [];
    var inputs = document.querySelectorAll('input, select, textarea');
    var processed = {};

    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (processed[el]) continue;
      processed[el] = true;

      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'reset') continue;
      if (el.hasAttribute('hidden') || el.closest('[hidden]')) continue;

      var field = {
        selector: cssSelector(el),
        name: el.name || '',
        type: el.type || '',
        placeholder: el.placeholder || '',
        value: el.type === 'password' ? '' : (el.value || ''),
        label: resolveLabelForField(el),
        autocomplete: el.autocomplete || undefined,
        isPassword: el.type === 'password',
        rect: getBoundingBox(el)
      };
      fields.push(field);
    }
    return fields;
  }

  function detectSensitiveFieldsFromDOM(formFields) {
    var hints = {
      hasPasswordField: false,
      hasFinancialField: false,
      hasMedicalField: false,
      hasGovernmentField: false,
      hasEmailField: false,
      hasPhoneField: false
    };

    for (var i = 0; i < formFields.length; i++) {
      var f = formFields[i];
      var combined = (f.name + ' ' + f.placeholder + ' ' + (f.label || '') + ' ' + (f.autocomplete || '') + ' ' + f.type).toLowerCase();

      if (f.isPassword || f.type === 'password') hints.hasPasswordField = true;
      if (combined.indexOf('email') !== -1 || f.type === 'email') hints.hasEmailField = true;
      if (combined.indexOf('phone') !== -1 || combined.indexOf('mobile') !== -1 || f.type === 'tel') hints.hasPhoneField = true;
      if (combined.indexOf('credit') !== -1 || combined.indexOf('card') !== -1 || combined.indexOf('account') !== -1 || combined.indexOf('routing') !== -1 || combined.indexOf('payment') !== -1 || combined.indexOf('bank') !== -1) hints.hasFinancialField = true;
      if (combined.indexOf('medical') !== -1 || combined.indexOf('health') !== -1 || combined.indexOf('patient') !== -1 || combined.indexOf('diagnosis') !== -1 || combined.indexOf('mrn') !== -1) hints.hasMedicalField = true;
      if (combined.indexOf('ssn') !== -1 || combined.indexOf('social security') !== -1 || combined.indexOf('aadhaar') !== -1 || combined.indexOf('pan') !== -1 || combined.indexOf('passport') !== -1 || combined.indexOf('national id') !== -1) hints.hasGovernmentField = true;
    }

    return hints;
  }

  function getVisibleText() {
    var textParts = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          var el = node;
          if (SKIP_TAGS[el.tagName]) return NodeFilter.FILTER_REJECT;
          if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return NodeFilter.FILTER_REJECT;
          if (el.closest('script, style, noscript, template, svg, math')) return NodeFilter.FILTER_REJECT;
          var style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var BLOCK_TAGS = { DIV: 1, P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, LI: 1, TR: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1, NAV: 1, MAIN: 1, ASIDE: 1 };
    var lastBlockLevel = '';
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        var text = (node.textContent || '').trim();
        if (text.length > 0) textParts.push(text);
        continue;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        var el = node;
        if (el.tagName === 'BR') { textParts.push('\n'); continue; }
        if (BLOCK_TAGS[el.tagName]) {
          if (lastBlockLevel) textParts.push('\n');
          lastBlockLevel = el.tagName;
          continue;
        }
      }
    }

    return textParts.join(' ')
      .replace(/(\n\s*){3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  function extractPageContext() {
    var domElements = extractDOMElements();
    var formFields = extractFormFields();
    var visibleText = getVisibleText();
    var sensitiveHints = detectSensitiveFieldsFromDOM(formFields);

    var formHints = formFields.map(function (f) {
      return f.placeholder + ' ' + (f.label || '') + ' ' + f.name + ' ' + (f.autocomplete || '');
    });

    var pageType = classifyPageType(window.location.href, document.title, formHints, visibleText);

    return {
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      pageType: pageType,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      domElements: domElements,
      formFields: formFields,
      visibleText: visibleText,
      sensitiveHints: sensitiveHints
    };
  }

  // ─── Redaction Overlay ──────────────────────────────────────────────────────
  function injectVisualizer(callback) {
    if (window.__PVA_VISUALIZER_INJECTED__) {
      if (callback) callback();
      return;
    }
    try {
      var script = document.createElement('script');
      script.src = chrome.runtime.getURL('visualizer.js');
      script.async = false;
      script.onload = function () {
        window.__PVA_VISUALIZER_INJECTED__ = true;
        if (callback) callback();
      };
      script.onerror = function () {
        if (callback) callback();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      if (callback) callback();
    }
  }

  function dispatchVisualizer(action, results) {
    try {
      window.dispatchEvent(new CustomEvent('pva:visualizer', {
        detail: { action: action, scanResults: results || null }
      }));
    } catch (e) {}
  }

  function getLastScanCopy() {
    return lastScanResult || window.__PVA_LAST_SCAN__ || null;
  }

  function createOverlayForEntities(entities, risks) {
    removeOverlays();

    var riskMap = {};
    for (var r = 0; r < risks.length; r++) {
      riskMap[risks[r].entityId] = risks[r];
    }

    var COLOR_MAP = {
      CRITICAL: { bg: 'rgba(220, 38, 38, 0.15)', border: '#dc2626', text: '#fca5a5' },
      HIGH: { bg: 'rgba(234, 88, 12, 0.12)', border: '#ea580c', text: '#fdba74' },
      MEDIUM: { bg: 'rgba(234, 179, 8, 0.10)', border: '#eab308', text: '#fde047' },
      LOW: { bg: 'rgba(59, 130, 246, 0.08)', border: '#3b82f6', text: '#93c5fd' }
    };

    var container = document.createElement('div');
    container.id = OVERLAY_PREFIX + 'container';
    container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';

    var created = 0;
    for (var i = 0; i < entities.length; i++) {
      var entity = entities[i];
      var risk = riskMap[entity.id];
      var riskLevel = risk ? risk.level : entity.risk;
      var color = COLOR_MAP[riskLevel] || COLOR_MAP.LOW;

      var targetRect = null;
      if (entity.domSelector) {
        try {
          var targetEl = document.querySelector(entity.domSelector);
          if (targetEl) targetRect = targetEl.getBoundingClientRect();
        } catch (e) {}
      }

      if (!targetRect && entity.bbox.width > 0 && entity.bbox.height > 0) {
        targetRect = entity.bbox;
      }

      if (!targetRect) continue;

      var overlay = document.createElement('div');
      overlay.className = OVERLAY_PREFIX + 'box';
      overlay.style.cssText =
        'position:absolute;' +
        'left:' + (targetRect.x + window.scrollX) + 'px;' +
        'top:' + (targetRect.y + window.scrollY) + 'px;' +
        'width:' + targetRect.width + 'px;' +
        'height:' + targetRect.height + 'px;' +
        'background:' + color.bg + ';' +
        'border:2px solid ' + color.border + ';' +
        'border-radius:3px;' +
        'pointer-events:none;' +
        'box-shadow:0 0 4px ' + color.border + '40;';

      var label = document.createElement('div');
      label.style.cssText =
        'position:absolute;top:-18px;left:0;' +
        'background:' + color.border + ';' +
        'color:#fff;' +
        'font-size:9px;' +
        'font-weight:700;' +
        'padding:1px 5px;' +
        'border-radius:3px;' +
        'white-space:nowrap;' +
        'font-family:monospace;' +
        'letter-spacing:0.3px;';
      label.textContent = entity.type + ' (' + Math.round(entity.confidence * 100) + '%)';
      overlay.appendChild(label);

      container.appendChild(overlay);
      created++;
    }

    if (created > 0) {
      document.documentElement.appendChild(container);
      overlayVisible = true;
      window.__PVA_OVERLAY_VISIBLE__ = true;
    }

    return created;
  }

  function removeOverlays() {
    var existing = document.getElementById(OVERLAY_PREFIX + 'container');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    overlayVisible = false;
    window.__PVA_OVERLAY_VISIBLE__ = false;
  }

  // ─── ML PII Booster ─────────────────────────────────────────────────────────
  // Loosely integrates the on-device PII classifier (pii-inference.js) as a
  // secondary detector that catches PII the regex engine cannot (NAME, USERNAME,
  // PASSWORD, generic ADDRESS, etc.). The 13.5MB model is loaded lazily on the
  // first meaningful scan and cached; it is never pre-loaded on every page.

  var ML_CONFIDENCE_THRESHOLD = 0.55;
  // ML is used ONLY to recall categories that regex is structurally blind to.
  // Structured/numeric types (CREDIT_CARD, SSN/GOV_ID, DOB, BANK_ACCOUNT,
  // API_KEY, AUTH_TOKEN, PHONE, EMAIL) are handled precisely by regex with
  // validators, and the lightweight char model reliably misclassifies raw
  // number runs - so we never let ML override those.
  var ML_ADD_TYPES = {
    NAME: 1, USERNAME: 1, PASSWORD: 1, ADDRESS: 1
  };

  function ensurePiiML() {
    if (piiML) return Promise.resolve(piiML);
    if (piiMLLoadPromise) return piiMLLoadPromise;

    piiMLLoadPromise = (async function () {
      try {
        var resp = await fetch(chrome.runtime.getURL('pii-inference.js'));
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var src = await resp.text();
        // Evaluate in the content script's isolated context so chrome.runtime
        // and fetch (used by the engine to load the model) remain available.
        var engine = eval(src + '\n;PII');
        await engine.load();
        piiML = engine;
        return engine;
      } catch (e) {
        console.warn('[PVA] PII ML booster unavailable:', e && e.message);
        piiMLLoadPromise = null;
        return null;
      }
    })();

    return piiMLLoadPromise;
  }

  function chunkForML(text) {
    if (!text) return [];
    var chunks = text.split(/(?<=[.\n;,])\s+/);
    var out = [];
    for (var i = 0; i < chunks.length; i++) {
      var c = (chunks[i] || '').trim();
      if (c.length < 2 || c.length > 180) continue;
      out.push(c);
    }
    if (out.length === 0 && text.trim().length >= 2) out.push(text.trim().slice(0, 180));
    return out;
  }

  function mlPredIsUseful(label) {
    // Only recall categories regex is structurally blind to.
    return ML_ADD_TYPES[label] === 1;
  }

  function runMLBoost(pageContext, entities) {
    if (!piiML) return entities;

    var seen = {};
    for (var i = 0; i < entities.length; i++) {
      seen[entities[i].type + ':' + entities[i].value] = true;
    }

    var added = 0;

    function maybeAdd(label, score, value, domSelector) {
      if (label === 'NONE') return;
      if (score < ML_CONFIDENCE_THRESHOLD) return;
      if (!mlPredIsUseful(label)) return;
      var key = label + ':' + value;
      if (seen[key]) return;
      seen[key] = true;

      var sensitivity = SENSITIVITY_MAP[label] ? 1 : 0;
      entities.push({
        id: generateId('ent'),
        type: label,
        value: value,
        bbox: { x: 0, y: 0, width: 0, height: 0 },
        confidence: Math.round(score * 1000) / 1000,
        risk: BASE_RISK[label] || 'MEDIUM',
        source: 'ML',
        timestamp: Date.now(),
        context: value,
        domSelector: domSelector || null,
        sensitivity: sensitivity
      });
      added++;
    }

    // Boost from form-field values (short, high-value PII).
    var formFields = pageContext.formFields || [];
    for (var f = 0; f < formFields.length; f++) {
      var field = formFields[f];
      var val = (field.value || '');
      if (!val || val.trim().length < 2 || val.length > 180) continue;
      try {
        var r = piiML.classifyText(val);
        maybeAdd(r.label, r.score, val.trim(), field.selector);
      } catch (e) { /* continue */ }
    }

    // Boost from short visible-text chunks.
    var textChunks = chunkForML(pageContext.visibleText);
    var checked = 0;
    for (var c = 0; c < textChunks.length && checked < 40; c++) {
      var chunk = textChunks[c];
      // Only probe chunks that contain no obvious quote/structural noise.
      if (chunk.length > 180) continue;
      checked++;
      try {
        var res = piiML.classifyText(chunk);
        maybeAdd(res.label, res.score, chunk, null);
      } catch (e) { /* continue */ }
    }

    if (added > 0) {
      console.log('[PVA] ML booster added ' + added + ' entity/entities');
    }
    return entities;
  }

  // ─── Full Pipeline Scan ─────────────────────────────────────────────────────
  function runFullScan(callback) {
    if (scanInProgress) {
      callback({ success: false, error: 'Scan already in progress' });
      return;
    }

    scanInProgress = true;
    var startTime = performance.now();

    try {
      var pageContext = extractPageContext();
      var domStart = performance.now();
      var domTiming = Math.round(performance.now() - domStart);

      var entities = detectPII(pageContext.visibleText, pageContext.sensitiveHints);

      // Also scan form field values
      for (var f = 0; f < pageContext.formFields.length; f++) {
        var field = pageContext.formFields[f];
        if (field.value && field.value.trim().length > 0) {
          var fieldEntities = detectPII(field.value, pageContext.sensitiveHints);
          for (var fe = 0; fe < fieldEntities.length; fe++) {
            fieldEntities[fe].domSelector = field.selector;
            var already = false;
            for (var ex = 0; ex < entities.length; ex++) {
              if (entities[ex].type === fieldEntities[fe].type && entities[ex].value === fieldEntities[fe].value) {
                already = true;
                break;
              }
            }
            if (!already) entities.push(fieldEntities[fe]);
          }
        }
      }

      var detectTiming = Math.round(performance.now() - startTime - domTiming);

      // Best-effort ML boost (async model load) - never blocks the response.
      var hasContent = (pageContext.visibleText && pageContext.visibleText.trim().length > 0) ||
        (pageContext.formFields && pageContext.formFields.length > 0);

      function finalizeScan() {
        var risks = scoreEntities(entities, pageContext.pageType);
        var riskTiming = Math.round(performance.now() - startTime - detectTiming - domTiming - mlScanMs);

        var overallRisk = computeOverallRisk(risks);

        // Build entity counts
        var counts = {
          EMAIL: 0, PHONE: 0, PASSWORD: 0, CREDIT_CARD: 0, API_KEY: 0,
          AUTH_TOKEN: 0, GOVERNMENT_ID: 0, BANK_ACCOUNT: 0, ADDRESS: 0,
          NAME: 0, USERNAME: 0, DATE_OF_BIRTH: 0, MEDICAL_ID: 0,
          FINANCIAL_DATA: 0, OTHER: 0
        };
        for (var c = 0; c < entities.length; c++) {
          var t = entities[c].type;
          if (counts.hasOwnProperty(t)) counts[t]++;
          else counts.OTHER++;
        }

        var totalTime = Math.round(performance.now() - startTime);

        var scanResult = {
          success: true,
          entities: entities,
          risks: risks,
          overallRisk: overallRisk,
          counts: counts,
          totalEntities: entities.length,
          pageType: pageContext.pageType,
          pageTitle: pageContext.title,
          url: pageContext.url,
          mlEnhanced: !!piiML,
          processingTime: {
            total: totalTime,
            dom: domTiming,
            detection: detectTiming,
            riskScoring: riskTiming,
            ml: mlScanMs
          },
          pageContext: {
            domElementCount: pageContext.domElements.length,
            formFieldCount: pageContext.formFields.length,
            visibleTextLength: pageContext.visibleText.length
          }
        };

        lastScanResult = scanResult;
        window.__PVA_LAST_SCAN__ = scanResult;

        // Log to background
        chrome.runtime.sendMessage({
          type: 'LOG_EVENT',
          level: entities.length > 0 ? 'warn' : 'info',
          message: 'Scan completed: ' + entities.length + ' entities found on ' + pageContext.pageType + ' page',
          data: {
            url: pageContext.url,
            entityCount: entities.length,
            overallRisk: overallRisk,
            processingTime: totalTime
          }
        });

        scanInProgress = false;
        callback(scanResult);
      }

      if (hasContent) {
        if (piiML) {
          var mlS = performance.now();
          try {
            runMLBoost(pageContext, entities);
          } catch (e) { /* ignore */ }
          mlScanMs = Math.round(performance.now() - mlS);
          finalizeScan();
        } else {
          var mlStart = performance.now();
          ensurePiiML().then(function (engine) {
            mlScanMs = Math.round(performance.now() - mlStart);
            try {
              if (engine) runMLBoost(pageContext, entities);
            } catch (e) { /* booster failure must never break the scan */ }
            finalizeScan();
          }).catch(function () {
            finalizeScan();
          });
        }
      } else {
        finalizeScan();
      }
    } catch (err) {
      scanInProgress = false;
      callback({ success: false, error: err.message || 'Scan failed' });
    }
  }

  // ─── Agent Action Execution ─────────────────────────────────────────────────
  function executeClick(selector) {
    var el;
    try { el = document.querySelector(selector); } catch (e) { return false; }
    if (!el) return false;

    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;

    var eventInit = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
    var pointerInit = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true };

    try { el.dispatchEvent(new PointerEvent('pointerdown', pointerInit)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', eventInit)); } catch (e) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', pointerInit)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', eventInit)); } catch (e) {}
    try { el.dispatchEvent(new MouseEvent('click', eventInit)); } catch (e) {}
    if (el instanceof HTMLElement) {
      try { el.click(); } catch (e) {}
    }
    return true;
  }

  function executeType(selector, value) {
    var el;
    try { el = document.querySelector(selector); } catch (e) { return false; }
    if (!el) return false;

    var isTextInput = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
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

    el.focus();
    var proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (nativeSetter && nativeSetter.set) {
      try { nativeSetter.set.call(el, value); } catch (e) { el.value = value; }
    } else {
      el.value = value;
    }

    try { el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch (e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true })); } catch (e) {}
    return true;
  }

  function executeScroll(direction, amount) {
    var amt = amount || 500;
    switch ((direction || 'down').toLowerCase()) {
      case 'up': window.scrollBy({ top: -amt, behavior: 'smooth' }); break;
      case 'down': window.scrollBy({ top: amt, behavior: 'smooth' }); break;
      case 'top': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'bottom': window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }); break;
      case 'left': window.scrollBy({ left: -amt, behavior: 'smooth' }); break;
      case 'right': window.scrollBy({ left: amt, behavior: 'smooth' }); break;
      default: window.scrollBy({ top: amt, behavior: 'smooth' }); break;
    }
    return true;
  }

  // ─── MutationObserver for Dynamic Content ───────────────────────────────────
  function startObserver() {
    if (observerActive) return;
    if (!document.body) return;

    var INTERACTIVE_ROLES = { button: 1, link: 1, menuitem: 1, tab: 1, checkbox: 1, radio: 1, switch: 1, textbox: 1, combobox: 1 };

    var observer = new MutationObserver(function (mutations) {
      var significant = false;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var added = m.addedNodes[j];
            if (added.nodeType === Node.ELEMENT_NODE) {
              if (INTERACTIVE_TAGS[added.tagName] || added.querySelector('input, button, select, textarea, a')) {
                significant = true;
                break;
              }
              var r = added.getAttribute('role');
              if (r && INTERACTIVE_ROLES[r]) { significant = true; break; }
            }
          }
          if (!significant && m.addedNodes.length > 3) significant = true;
        }
        if (m.type === 'attributes') {
          if (m.attributeName === 'value' || m.attributeName === 'content') significant = true;
        }
        if (significant) break;
      }

      if (significant && lastScanResult) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          // Auto re-scan on significant DOM changes if overlay is visible
          if (overlayVisible) {
            runFullScan(function (result) {
              if (result.success) createOverlayForEntities(result.entities, result.risks);
            });
          }
        }, 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['value', 'content', 'hidden'],
      characterData: true
    });

    observerActive = true;
  }

  function stopObserver() {
    observerActive = false;
  }

  // ─── Message Listener ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    switch (message.type) {
      case 'SCAN_PAGE':
        runFullScan(function (result) {
          sendResponse(result);
        });
        return true;

      case 'GET_PAGE_CONTEXT':
        var ctx = extractPageContext();
        sendResponse({
          success: true,
          url: ctx.url,
          title: ctx.title,
          pageType: ctx.pageType,
          domElementCount: ctx.domElements.length,
          formFieldCount: ctx.formFields.length,
          visibleTextLength: ctx.visibleText.length,
          sensitiveHints: ctx.sensitiveHints
        });
        return false;

      case 'GET_ELEMENTS':
        var els = extractDOMElements();
        sendResponse({ success: true, elements: els, count: els.length });
        return false;

      case 'GET_PAGE_TEXT':
        sendResponse({ success: true, text: getVisibleText() });
        return false;

      case 'EXECUTE_ACTION':
        var actionResult = false;
        if (message.action === 'click') {
          actionResult = executeClick(message.target);
        } else if (message.action === 'type') {
          actionResult = executeType(message.target, message.value);
        } else if (message.action === 'scroll') {
          actionResult = executeScroll(message.direction, message.amount);
        }
        sendResponse({ success: actionResult });
        return false;

      case 'SHOW_DETECTION_OVERLAY':
        if (lastScanResult && lastScanResult.entities.length > 0) {
          var count = createOverlayForEntities(lastScanResult.entities, lastScanResult.risks);
          sendResponse({ success: true, overlayCount: count });
        } else {
          runFullScan(function (result) {
            if (result.success && result.entities.length > 0) {
              var c = createOverlayForEntities(result.entities, result.risks);
              sendResponse({ success: true, overlayCount: c });
            } else {
              sendResponse({ success: true, overlayCount: 0, message: 'No entities detected' });
            }
          });
          return true;
        }
        return false;

      case 'SHOW_PRIVACY_VISUALIZER':
      case 'TOGGLE_PRIVACY_VISUALIZER':
      case 'HIDE_PRIVACY_VISUALIZER':
        var vizAction =
          message.type === 'SHOW_PRIVACY_VISUALIZER' ? 'show' :
          message.type === 'HIDE_PRIVACY_VISUALIZER' ? 'hide' : 'toggle';
        injectVisualizer(function () {
          var results = getLastScanCopy();
          dispatchVisualizer(vizAction, results);
        });
        sendResponse({ success: true });
        return false;

      case 'HIDE_DETECTION_OVERLAY':
        removeOverlays();
        sendResponse({ success: true });
        return false;

      case 'TOGGLE_OVERLAY':
        if (overlayVisible) {
          removeOverlays();
          sendResponse({ success: true, visible: false });
        } else if (lastScanResult && lastScanResult.entities.length > 0) {
          var cnt = createOverlayForEntities(lastScanResult.entities, lastScanResult.risks);
          sendResponse({ success: true, visible: true, overlayCount: cnt });
        } else {
          runFullScan(function (result) {
            if (result.success && result.entities.length > 0) {
              var cc = createOverlayForEntities(result.entities, result.risks);
              sendResponse({ success: true, visible: true, overlayCount: cc });
            } else {
              sendResponse({ success: true, visible: false, message: 'Nothing to show' });
            }
          });
          return true;
        }
        return false;

      case 'GET_LAST_SCAN':
        sendResponse({ success: true, result: lastScanResult });
        return false;

      case 'RUN_AGENT':
        // Backward compatibility with old agent functionality
        var pageCtx = extractPageContext();
        sendResponse({
          success: true,
          task: message.task,
          pageTitle: pageCtx.title,
          url: pageCtx.url,
          buttonCount: pageCtx.domElements.filter(function (e) { return e.isButton; }).length,
          linkCount: pageCtx.domElements.filter(function (e) { return e.isLink; }).length,
          inputCount: pageCtx.domElements.filter(function (e) { return e.isInput; }).length,
          action: 'click_button',
          suggestion: 'Task received by privacy-aware content script.',
          taskMatches: [],
          mlResult: null,
          hiddenTarget: { found: false }
        });
        return false;

      default:
        sendResponse({ success: false, error: 'Unknown message type: ' + message.type });
        return false;
    }
  });

  // ─── Initialization ─────────────────────────────────────────────────────────
  function init() {
    startObserver();
    console.log('[Privacy Vision Agent] Content script v' + PVA_VERSION + ' loaded on ' + window.location.hostname);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
