/**
 * Privacy Vision Agent - Background Service Worker
 * Handles extension lifecycle, screenshot capture, OCR, settings, audit logging,
 * firewall checks on outbound requests, and message routing.
 */

var PVA_VERSION = '1.0.0';
var MAX_LOG_ENTRIES = 200;
var DEFAULT_SETTINGS = {
  enabled: true,
  autoScan: true,
  scanInterval: 30000,
  riskThreshold: 'HIGH',
  enableOCR: true,
  enableDOM: true,
  enableVision: true,
  enableFirewall: true,
  enableLogging: true,
  maxLogEntries: 200,
  theme: 'dark',
  cloudAi: {
    enabled: false,
    endpoint: 'https://api-inference.huggingface.co/models/Qwen/Qwen2.5-7B-Instruct',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    token: ''
  }
};

var DEFAULT_REDACTION_METHODS = {
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
  PRIVATE_DOCUMENT_CONTENT: 'mask'
};

// ─── Extension Install ───────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(function (details) {
  console.log('[PVA Background] Extension installed. Version:', PVA_VERSION);

  // Set default settings
  chrome.storage.local.get(['settings'], function (result) {
    if (!result.settings) {
      chrome.storage.local.set({
        settings: DEFAULT_SETTINGS,
        redactionMethods: DEFAULT_REDACTION_METHODS,
        auditLog: [],
        scanCount: 0,
        installTime: Date.now()
      });
      console.log('[PVA Background] Default settings initialized.');
    }
  });
});

// ─── Screenshot Capture ──────────────────────────────────────────────────────
function captureScreenshot() {
  return new Promise(function (resolve, reject) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!tabs || tabs.length === 0 || !tabs[0].id) {
        reject(new Error('No active tab found'));
        return;
      }

      chrome.tabs.captureVisibleTab(tabs[0].id, { format: 'png' }, function (dataUrl) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (dataUrl) {
          resolve(dataUrl);
        } else {
          reject(new Error('captureVisibleTab returned undefined'));
        }
      });
    });
  });
}

// ─── OCR Processing ──────────────────────────────────────────────────────────
// Tesseract.js would be loaded dynamically here. For the demo, we provide a
// stub that returns an indication OCR is not available without the library.
function runOCR(imageDataUrl) {
  return new Promise(function (resolve, reject) {
    // Check if Tesseract is available (loaded via web worker or script injection)
    if (typeof Tesseract !== 'undefined') {
      Tesseract.recognize(imageDataUrl, 'eng', {}).then(function (result) {
        resolve({
          text: result.data.text,
          confidence: result.data.confidence,
          words: (result.data.words || []).map(function (w) {
            return {
              text: w.text,
              bbox: {
                x: w.bbox.x0,
                y: w.bbox.y0,
                width: w.bbox.x1 - w.bbox.x0,
                height: w.bbox.y1 - w.bbox.y0
              },
              confidence: w.confidence
            };
          })
        });
      }).catch(function (err) {
        reject(err);
      });
    } else {
      // OCR not available - return empty result
      resolve({
        text: '',
        confidence: 0,
        words: [],
        note: 'Tesseract.js not loaded. OCR unavailable in this build.'
      });
    }
  });
}

// ─── Settings Management ─────────────────────────────────────────────────────
function getSettings() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(['settings', 'redactionMethods'], function (result) {
      var settings = Object.assign({}, DEFAULT_SETTINGS, result.settings || {});
      var redactionMethods = Object.assign({}, DEFAULT_REDACTION_METHODS, result.redactionMethods || {});
      resolve({ settings: settings, redactionMethods: redactionMethods });
    });
  });
}

function saveSettings(settings) {
  return new Promise(function (resolve) {
    chrome.storage.local.set({ settings: settings }, function () {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ success: true });
      }
    });
  });
}

// ─── Audit Log ───────────────────────────────────────────────────────────────
function logEvent(level, message, data) {
  return new Promise(function (resolve) {
    chrome.storage.local.get(['auditLog', 'settings'], function (result) {
      var settings = result.settings || DEFAULT_SETTINGS;
      if (!settings.enableLogging) {
        resolve({ success: true, skipped: true });
        return;
      }

      var log = result.auditLog || [];
      var entry = {
        timestamp: Date.now(),
        level: level,
        message: message,
        data: sanitizeLogData(data)
      };

      log.push(entry);

      // Keep only the last N entries
      var maxEntries = settings.maxLogEntries || MAX_LOG_ENTRIES;
      if (log.length > maxEntries) {
        log = log.slice(log.length - maxEntries);
      }

      chrome.storage.local.set({ auditLog: log }, function () {
        resolve({ success: true });
      });
    });
  });
}

function sanitizeLogData(data) {
  if (!data || typeof data !== 'object') return data;

  var sanitized = {};
  var sensitiveKeys = ['value', 'password', 'token', 'key', 'secret', 'ssn', 'credit_card', 'card_number'];

  for (var key in data) {
    if (!data.hasOwnProperty(key)) continue;
    if (sensitiveKeys.indexOf(key.toLowerCase()) !== -1) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = data[key];
    }
  }
  return sanitized;
}

function getAuditLog() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(['auditLog'], function (result) {
      resolve(result.auditLog || []);
    });
  });
}

// ─── Outbound Firewall Check ─────────────────────────────────────────────────
var FIREWALL_PATTERNS = [
  { pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, label: 'EMAIL' },
  { pattern: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, label: 'CREDIT_CARD' },
  { pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g, label: 'SSN' },
  { pattern: /\b(?:sk|pk|ak|ghp|gho|github_pat|xox[baprs])[_\-]?[A-Za-z0-9\-]{16,}\b/g, label: 'API_KEY' },
  { pattern: /Bearer\s+[A-Za-z0-9_\-\.]+/gi, label: 'AUTH_TOKEN' },
  { pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi, label: 'PASSWORD' },
  { pattern: /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, label: 'JWT' },
  { pattern: /\b\d{12}\b/g, label: 'POSSIBLE_GOV_ID' }
];

function firewallCheck(payload) {
  var payloadStr = JSON.stringify(payload.data || payload);
  var detectedFields = [];

  for (var i = 0; i < FIREWALL_PATTERNS.length; i++) {
    var fp = FIREWALL_PATTERNS[i];
    // Reset lastIndex for global regex
    fp.pattern.lastIndex = 0;
    if (fp.pattern.test(payloadStr)) {
      detectedFields.push(fp.label);
    }
  }

  if (detectedFields.length > 0) {
    logEvent('block', 'Outbound request contains sensitive data: ' + detectedFields.join(', '), {
      type: payload.type,
      source: payload.source,
      detectedFields: detectedFields
    });

    return {
      safe: false,
      reason: 'Sensitive data detected: ' + detectedFields.join(', '),
      detectedFields: detectedFields
    };
  }

  return {
    safe: true,
    reason: 'No sensitive data detected',
    detectedFields: []
  };
}

function redactForCloud(value) {
  var text = typeof value === 'string' ? value : JSON.stringify(value || '');
  var patterns = [
    { re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, label: 'EMAIL' },
    { re: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, label: 'CREDIT_CARD' },
    { re: /\b\d{3}-?\d{2}-?\d{4}\b/g, label: 'GOVERNMENT_ID' },
    { re: /Bearer\s+[A-Za-z0-9_\-.]+/gi, label: 'AUTH_TOKEN' },
    { re: /\b(?:password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*[^\s,}]+/gi, label: 'SECRET' }
  ];
  patterns.forEach(function (entry) {
    text = text.replace(entry.re, '[' + entry.label + '_REDACTED]');
  });
  return text;
}

function requestCloudAgent(message) {
  return getSettings().then(function (config) {
    var settings = config.settings || {};
    var cloud = settings.cloudAi || {};
    if (!cloud.enabled) {
      throw new Error('Cloud AI is disabled. Configure it in extension settings first.');
    }
    if (!cloud.endpoint || !/^https:\/\/api-inference\.huggingface\.co\//.test(cloud.endpoint)) {
      throw new Error('Only the Hugging Face Inference API endpoint is allowed.');
    }
    if (!cloud.token) {
      throw new Error('Hugging Face access token is missing. Add it in extension settings.');
    }

    var safeInstruction = redactForCloud(message.instruction || '');
    var safeContext = redactForCloud(message.context || {});
    var prompt = [
      'You are a privacy-safe browser assistant.',
      'The page context below has already been redacted locally. Never ask for or infer the hidden values.',
      'Give concise, actionable next steps for the user instruction.',
      'USER INSTRUCTION:', safeInstruction,
      'SANITIZED PAGE CONTEXT:', safeContext
    ].join('\n');

    var firewall = firewallCheck({ type: 'cloud_ai_prompt', data: { prompt: prompt }, source: cloud.endpoint });
    if (!firewall.safe) {
      throw new Error('Cloud request blocked by privacy firewall: ' + firewall.reason);
    }

    return fetch(cloud.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cloud.token
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { max_new_tokens: 300, temperature: 0.2, return_full_text: false }
      })
    }).then(function (response) {
      return response.text().then(function (body) {
        var data;
        try { data = JSON.parse(body); } catch { data = {}; }
        if (!response.ok) {
          throw new Error(data.error || 'Cloud AI request failed (' + response.status + ')');
        }
        var answer = Array.isArray(data) && data[0] ? data[0].generated_text : data.generated_text;
        if (!answer && data.choices && data.choices[0]) answer = data.choices[0].message?.content || data.choices[0].text;
        return { success: true, answer: answer || 'The model returned no guidance.' };
      });
    });
  });
}

// ─── Message Router ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  switch (message.type) {
    case 'CAPTURE_SCREENSHOT':
      captureScreenshot()
        .then(function (dataUrl) {
          sendResponse({ success: true, dataUrl: dataUrl });
        })
        .catch(function (err) {
          sendResponse({ success: false, error: err.message });
        });
      return true;

    case 'RUN_OCR':
      runOCR(message.imageData)
        .then(function (result) {
          sendResponse({ success: true, result: result });
        })
        .catch(function (err) {
          sendResponse({ success: false, error: err.message });
        });
      return true;

    case 'SAVE_SETTINGS':
      saveSettings(message.settings)
        .then(function (result) {
          sendResponse(result);
        });
      return true;

    case 'GET_SETTINGS':
      getSettings()
        .then(function (result) {
          sendResponse({ success: true, settings: result.settings, redactionMethods: result.redactionMethods });
        });
      return true;

    case 'FIREWALL_CHECK':
      var fwResult = firewallCheck(message.payload);
      sendResponse({ success: true, safe: fwResult.safe, reason: fwResult.reason, detectedFields: fwResult.detectedFields });
      return false;

    case 'CLOUD_AGENT_REQUEST':
      requestCloudAgent(message)
        .then(function (result) { sendResponse(result); })
        .catch(function (err) { sendResponse({ success: false, error: err.message }); });
      return true;

    case 'LOG_EVENT':
      logEvent(message.level || 'info', message.message, message.data)
        .then(function (result) {
          sendResponse(result);
        });
      return true;

    case 'GET_AUDIT_LOG':
      getAuditLog()
        .then(function (log) {
          sendResponse({ success: true, log: log });
        });
      return true;

    case 'GET_SCAN_COUNT':
      chrome.storage.local.get(['scanCount'], function (result) {
        sendResponse({ success: true, count: result.scanCount || 0 });
      });
      return true;

    case 'INCREMENT_SCAN_COUNT':
      chrome.storage.local.get(['scanCount'], function (result) {
        var newCount = (result.scanCount || 0) + 1;
        chrome.storage.local.set({ scanCount: newCount });
        sendResponse({ success: true, count: newCount });
      });
      return true;

    case 'AGENT_ACTION':
      // Forward action to the appropriate content script
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (!tabs || tabs.length === 0 || !tabs[0].id) {
          sendResponse({ success: false, error: 'No active tab' });
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'EXECUTE_ACTION',
          action: message.action,
          target: message.target,
          value: message.value,
          direction: message.direction,
          amount: message.amount
        }, function (response) {
          sendResponse(response || { success: false });
        });
      });
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown message type: ' + message.type });
      return false;
  }
});

// ─── WebRequest Listener (Outbound Monitoring) ───────────────────────────────
// Monitor outbound requests for PII leakage when webRequest permission is available
if (typeof chrome !== 'undefined' && chrome.webRequest && chrome.webRequest.onBeforeSendHeaders) {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    function (details) {
      // Check request headers and body for sensitive data
      if (details.requestHeaders) {
        for (var i = 0; i < details.requestHeaders.length; i++) {
          var header = details.requestHeaders[i];
          if (header.value && header.value.length > 20) {
            var result = firewallCheck({ type: 'header', data: header.value, source: details.url });
            if (!result.safe) {
              logEvent('block', 'Outbound header contains PII', {
                url: details.url,
                headerName: header.name,
                detectedFields: result.detectedFields
              });
            }
          }
        }
      }
    },
    { urls: ['<all_urls>'] },
    ['requestHeaders', 'extraHeaders']
  );
}

// ─── Tab Update Listener ─────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete' && tab.url) {
    // Notify content script that page has loaded
    chrome.storage.local.get(['settings'], function (result) {
      var settings = result.settings || DEFAULT_SETTINGS;
      if (settings.autoScan) {
        try {
          chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTEXT' }, function (response) {
            if (chrome.runtime.lastError) {
              // Content script may not be injected yet, that's fine
            }
          });
        } catch (e) {
          // Ignore errors from tabs where content script isn't loaded
        }
      }
    });
  }
});

console.log('[PVA Background] Service worker v' + PVA_VERSION + ' initialized.');
