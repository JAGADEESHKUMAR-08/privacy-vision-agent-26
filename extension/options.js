/**
 * Privacy Vision Agent - Options Page
 * Loads, displays, and saves extension settings stored in chrome.storage.local.
 */
(function () {
  'use strict';

  var SETTINGS_KEY = 'pva_settings';

  var DEFAULT_SETTINGS = {
    enabled: true,
    autoScan: true,
    scanInterval: 5000,
    riskThreshold: 'MEDIUM',
    redactionMethods: {
      EMAIL: 'replace',
      PHONE: 'blur',
      PASSWORD: 'mask',
      USERNAME: 'mask',
      NAME: 'replace',
      ADDRESS: 'replace',
      CREDIT_CARD: 'mask',
      BANK_ACCOUNT: 'mask',
      API_KEY: 'mask',
      AUTH_TOKEN: 'mask',
      DATE_OF_BIRTH: 'mask',
      GOVERNMENT_ID: 'mask',
      MEDICAL_ID: 'mask',
      FINANCIAL_DATA: 'mask',
      PRIVATE_DOCUMENT_CONTENT: 'tokenize'
    },
    enableOCR: true,
    enableDOM: true,
    enableVision: false,
    enableFirewall: true,
    enableLogging: true,
    maxLogEntries: 200,
    theme: 'dark'
  };

  var PII_CATEGORIES = [
    { key: 'EMAIL', label: 'Email' },
    { key: 'PHONE', label: 'Phone' },
    { key: 'PASSWORD', label: 'Password' },
    { key: 'USERNAME', label: 'Username' },
    { key: 'NAME', label: 'Name' },
    { key: 'ADDRESS', label: 'Address' },
    { key: 'CREDIT_CARD', label: 'Credit Card' },
    { key: 'BANK_ACCOUNT', label: 'Bank Account' },
    { key: 'API_KEY', label: 'API Key' },
    { key: 'AUTH_TOKEN', label: 'Auth Token' },
    { key: 'DATE_OF_BIRTH', label: 'Date of Birth' },
    { key: 'GOVERNMENT_ID', label: 'Govt ID' },
    { key: 'MEDICAL_ID', label: 'Medical ID' },
    { key: 'FINANCIAL_DATA', label: 'Financial Data' },
    { key: 'PRIVATE_DOCUMENT_CONTENT', label: 'Private Doc' }
  ];

  var REDACTION_METHODS = [
    { value: 'blur', label: 'Blur' },
    { value: 'pixelate', label: 'Pixelate' },
    { value: 'mask', label: 'Mask' },
    { value: 'replace', label: 'Replace' },
    { value: 'tokenize', label: 'Tokenize' }
  ];

  // ─── DOM Elements ─────────────────────────────────────────────────────────
  var enabledEl = document.getElementById('enabled');
  var autoScanEl = document.getElementById('autoScan');
  var scanIntervalEl = document.getElementById('scanInterval');
  var riskThresholdEl = document.getElementById('riskThreshold');
  var redactionMethodsEl = document.getElementById('redactionMethods');
  var themeEl = document.getElementById('theme');
  var enableOCREl = document.getElementById('enableOCR');
  var enableDOMEl = document.getElementById('enableDOM');
  var enableVisionEl = document.getElementById('enableVision');
  var enableFirewallEl = document.getElementById('enableFirewall');
  var enableLoggingEl = document.getElementById('enableLogging');
  var maxLogEntriesEl = document.getElementById('maxLogEntries');
  var saveBtn = document.getElementById('saveBtn');
  var resetBtn = document.getElementById('resetBtn');
  var exportBtn = document.getElementById('exportBtn');
  var statusMsg = document.getElementById('statusMsg');

  // ─── Utility ──────────────────────────────────────────────────────────────
  function showStatus(message, type, duration) {
    statusMsg.textContent = message || '';
    statusMsg.className = 'status visible' + (type ? ' ' + type : '');
    if (statusMsg.textContent) {
      clearTimeout(showStatus._timer);
      showStatus._timer = setTimeout(function () {
        statusMsg.className = 'status';
        statusMsg.textContent = '';
      }, duration || 3000);
    }
  }

  function setBusy(btn, busy) {
    if (busy) {
      btn.classList.add('loading');
      btn.disabled = true;
    } else {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  function deepMerge(base, override) {
    var result = {};
    var keys = Object.keys(base);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var baseVal = base[key];
      var overrideVal = override ? override[key] : undefined;
      if (typeof baseVal === 'object' && baseVal !== null && !Array.isArray(baseVal)) {
        result[key] = deepMerge(baseVal, overrideVal || {});
      } else {
        result[key] = (overrideVal !== undefined) ? overrideVal : baseVal;
      }
    }
    return result;
  }

  function loadFromStorage() {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get(SETTINGS_KEY, function (result) {
        var err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
        } else {
          var stored = result[SETTINGS_KEY] || {};
          resolve(deepMerge(DEFAULT_SETTINGS, stored));
        }
      });
    });
  }

  function saveToStorage(settings) {
    return new Promise(function (resolve, reject) {
      var obj = {};
      obj[SETTINGS_KEY] = settings;
      chrome.storage.local.set(obj, function () {
        var err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
        } else {
          resolve(settings);
        }
      });
    });
  }

  // ─── Populate Form From Settings ──────────────────────────────────────────
  function populateForm(settings) {
    enabledEl.checked = !!settings.enabled;
    autoScanEl.checked = !!settings.autoScan;
    scanIntervalEl.value = settings.scanInterval || 5000;
    riskThresholdEl.value = settings.riskThreshold || 'MEDIUM';
    enableOCREl.checked = !!settings.enableOCR;
    enableDOMEl.checked = !!settings.enableDOM;
    enableVisionEl.checked = !!settings.enableVision;
    enableFirewallEl.checked = !!settings.enableFirewall;
    enableLoggingEl.checked = !!settings.enableLogging;
    maxLogEntriesEl.value = settings.maxLogEntries || 200;

    var themes = ['dark', 'light', 'system'];
    var selectedTheme = settings.theme || 'dark';
    if (themes.indexOf(selectedTheme) === -1) selectedTheme = 'dark';
    themeEl.value = selectedTheme;
    document.documentElement.setAttribute('data-theme', selectedTheme);

    populateRedactionMethods(settings.redactionMethods || {});
  }

  function populateRedactionMethods(methods) {
    redactionMethodsEl.innerHTML = '';

    PII_CATEGORIES.forEach(function (category) {
      var row = document.createElement('div');
      row.className = 'redaction-method-row';

      // Left: category name
      var name = document.createElement('span');
      name.className = 'method-name';
      name.textContent = category.label;
      row.appendChild(name);

      // Right: dropdown
      var select = document.createElement('select');
      select.setAttribute('data-category', category.key);
      select.setAttribute('aria-label', 'Redaction method for ' + category.label);

      REDACTION_METHODS.forEach(function (m) {
        var option = document.createElement('option');
        option.value = m.value;
        option.textContent = m.label;
        select.appendChild(option);
      });

      select.value = methods[category.key] || 'mask';
      row.appendChild(select);

      redactionMethodsEl.appendChild(row);
    });
  }

  // ─── Collect Form Into Settings ───────────────────────────────────────────
  function collectForm(current) {
    var base = current || DEFAULT_SETTINGS;

    var methods = {};
    var selectEls = redactionMethodsEl.querySelectorAll('select[data-category]');
    for (var i = 0; i < selectEls.length; i++) {
      var sel = selectEls[i];
      var cat = sel.getAttribute('data-category');
      methods[cat] = sel.value;
    }

    return {
      enabled: enabledEl.checked,
      autoScan: autoScanEl.checked,
      scanInterval: clamp(parseInt(scanIntervalEl.value, 10), 1000, 30000, 5000),
      riskThreshold: riskThresholdEl.value,
      redactionMethods: methods,
      enableOCR: enableOCREl.checked,
      enableDOM: enableDOMEl.checked,
      enableVision: enableVisionEl.checked,
      enableFirewall: enableFirewallEl.checked,
      enableLogging: enableLoggingEl.checked,
      maxLogEntries: clamp(parseInt(maxLogEntriesEl.value, 10), 50, 1000, 200),
      theme: themeEl.value
    };
  }

  function clamp(val, min, max, fallback) {
    if (isNaN(val)) return fallback;
    return Math.min(max, Math.max(min, val));
  }

  // ─── Actions ──────────────────────────────────────────────────────────────
  function handleSave() {
    setBusy(saveBtn, true);

    loadFromStorage()
      .then(function (current) {
        var updated = deepMerge(DEFAULT_SETTINGS, collectForm(current));
        return saveToStorage(updated);
      })
      .then(function (saved) {
        document.documentElement.setAttribute('data-theme', saved.theme);
        showStatus('Settings saved successfully.', 'success');
        // Notify background service worker of the change
        try {
          chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings: saved });
        } catch (e) {
          // Background may not be available; ignore.
        }
      })
      .catch(function (err) {
        showStatus('Failed to save settings: ' + err.message, 'error');
      })
      .finally(function () {
        setBusy(saveBtn, false);
      });
  }

  function handleReset() {
    setBusy(resetBtn, true);

    saveToStorage(deepMerge(DEFAULT_SETTINGS, {}))
      .then(function () {
        populateForm(DEFAULT_SETTINGS);
        document.documentElement.setAttribute('data-theme', DEFAULT_SETTINGS.theme);
        showStatus('Settings reset to defaults.', 'success');
        try {
          chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings: DEFAULT_SETTINGS });
        } catch (e) {}
      })
      .catch(function (err) {
        showStatus('Failed to reset settings: ' + err.message, 'error');
      })
      .finally(function () {
        setBusy(resetBtn, false);
      });
  }

  function handleExport() {
    setBusy(exportBtn, true);

    loadFromStorage()
      .then(function (settings) {
        var blob = new Blob(
          [JSON.stringify(settings, null, 2)],
          { type: 'application/json' }
        );
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var date = new Date();
        var dateStr =
          date.getFullYear() + '-' +
          String(date.getMonth() + 1).padStart(2, '0') + '-' +
          String(date.getDate()).padStart(2, '0');
        a.href = url;
        a.download = 'privacy-vision-settings-' + dateStr + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showStatus('Settings exported as JSON.', 'success');
      })
      .catch(function (err) {
        showStatus('Failed to export settings: ' + err.message, 'error');
      })
      .finally(function () {
        setBusy(exportBtn, false);
      });
  }

  // ─── Live theme preview on dropdown change ───────────────────────────────
  themeEl.addEventListener('change', function () {
    document.documentElement.setAttribute('data-theme', themeEl.value);
  });

  // ─── Event Listeners ──────────────────────────────────────────────────────
  saveBtn.addEventListener('click', handleSave);
  resetBtn.addEventListener('click', handleReset);
  exportBtn.addEventListener('click', handleExport);

  // Pressing Enter in number inputs saves settings
  [scanIntervalEl, maxLogEntriesEl].forEach(function (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    });
  });

  // ─── Initialize ───────────────────────────────────────────────────────────
  function init() {
    loadFromStorage()
      .then(function (settings) {
        populateForm(settings);
      })
      .catch(function (err) {
        populateForm(DEFAULT_SETTINGS);
        showStatus('Using default settings: ' + err.message, 'error');
      });
  }

  init();
})();
