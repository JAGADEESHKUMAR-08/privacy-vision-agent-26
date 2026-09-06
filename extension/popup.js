/**
 * Privacy Vision Agent - Popup Script
 * Handles all UI interactions, messaging with content/background scripts,
 * and display of scan results.
 */
(function () {
  'use strict';

  // ─── DOM Elements ──────────────────────────────────────────────────────────
  var statusBadge = document.getElementById('statusBadge');
  var riskCard = document.getElementById('riskCard');
  var riskLevel = document.getElementById('riskLevel');
  var emailCount = document.getElementById('emailCount');
  var phoneCount = document.getElementById('phoneCount');
  var passwordCount = document.getElementById('passwordCount');
  var tokenCount = document.getElementById('tokenCount');
  var otherCount = document.getElementById('otherCount');
  var redactedCount = document.getElementById('redactedCount');
  var accessStatus = document.getElementById('accessStatus');
  var inferenceMode = document.getElementById('inferenceMode');
  var latencyValue = document.getElementById('latencyValue');
  var pageTypeValue = document.getElementById('pageTypeValue');
  var entitiesList = document.getElementById('entitiesList');
  var reportPanel = document.getElementById('reportPanel');
  var scanBtn = document.getElementById('scanBtn');
  var previewBtn = document.getElementById('previewBtn');
  var reportBtn = document.getElementById('reportBtn');
  var settingsBtn = document.getElementById('settingsBtn');
  var agentInstruction = document.getElementById('agentInstruction');
  var askAgentBtn = document.getElementById('askAgentBtn');
  var agentResult = document.getElementById('agentResult');

  var lastResult = null;
  var settingsPanel = null;

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function getCurrentTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        resolve(tabs && tabs.length > 0 ? tabs[0] : null);
      });
    });
  }

  function sendMessageToContent(message) {
    return new Promise(function (resolve, reject) {
      getCurrentTab().then(function (tab) {
        if (!tab || !tab.id) {
          reject(new Error('No active tab'));
          return;
        }
        chrome.tabs.sendMessage(tab.id, message, function (response) {
          var err = chrome.runtime.lastError;
          if (err) {
            reject(new Error(err.message));
          } else {
            resolve(response || { success: false });
          }
        });
      });
    });
  }

  // ─── Update UI ─────────────────────────────────────────────────────────────
  function updateRiskDisplay(risk) {
    riskLevel.textContent = risk || '--';
    riskCard.className = 'risk-card' + (risk ? ' risk-' + risk : '');
    riskLevel.className = 'risk-level' + (risk ? ' risk-' + risk : '');
  }

  function updateCounts(counts) {
    var c = counts || {};
    setStatValue(emailCount, c.EMAIL || 0);
    setStatValue(phoneCount, c.PHONE || 0);
    setStatValue(passwordCount, (c.PASSWORD || 0) + (c.API_KEY || 0));
    setStatValue(tokenCount, c.AUTH_TOKEN || 0);

    var otherTotal = (c.NAME || 0) + (c.ADDRESS || 0) + (c.USERNAME || 0) +
      (c.CREDIT_CARD || 0) + (c.BANK_ACCOUNT || 0) + (c.GOVERNMENT_ID || 0) +
      (c.MEDICAL_ID || 0) + (c.DATE_OF_BIRTH || 0) + (c.FINANCIAL_DATA || 0) +
      (c.OTHER || 0);
    setStatValue(otherCount, otherTotal);
  }

  function setStatValue(el, value) {
    el.textContent = value;
    if (value > 0) {
      el.classList.add('nonzero');
    } else {
      el.classList.remove('nonzero');
    }
  }

  function updateMetrics(result) {
    if (result && result.processingTime) {
      latencyValue.textContent = result.processingTime.total + ' ms';
    }
    if (result && result.pageType) {
      pageTypeValue.textContent = result.pageType.replace(/_/g, ' ');
    }
    if (result && result.totalEntities > 0) {
      redactedCount.textContent = result.totalEntities;
    }
  }

  function renderEntitiesList(entities, risks) {
    if (!entities || entities.length === 0) {
      entitiesList.style.display = 'none';
      return;
    }

    var riskMap = {};
    for (var i = 0; i < risks.length; i++) {
      riskMap[risks[i].entityId] = risks[i];
    }

    // Sort by risk level descending
    var RISK_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
    var sorted = entities.slice().sort(function (a, b) {
      var ra = riskMap[a.id] ? RISK_ORDER[riskMap[a.id].level] : 0;
      var rb = riskMap[b.id] ? RISK_ORDER[riskMap[b.id].level] : 0;
      return rb - ra;
    });

    var html = '';
    var maxDisplay = 30;
    var display = sorted.slice(0, maxDisplay);

    for (var j = 0; j < display.length; j++) {
      var entity = display[j];
      var risk = riskMap[entity.id];
      var level = risk ? risk.level : entity.risk;
      var maskedValue = maskValue(entity.value, entity.type);

      html += '<div class="entity-item">' +
        '<span class="entity-type ' + level + '">' + escapeHtml(level) + '</span>' +
        '<span class="entity-value" title="' + escapeHtml(entity.type + ': ' + entity.value) + '">' +
          escapeHtml(entity.type) + ': ' + escapeHtml(maskedValue) +
        '</span>' +
        '<span class="entity-conf">' + Math.round(entity.confidence * 100) + '%</span>' +
      '</div>';
    }

    if (sorted.length > maxDisplay) {
      html += '<div class="entity-item"><span class="entity-conf">... and ' + (sorted.length - maxDisplay) + ' more</span></div>';
    }

    entitiesList.innerHTML = html;
    entitiesList.style.display = 'block';
  }

  function maskValue(value, type) {
    if (!value) return '';
    if (type === 'PASSWORD' || type === 'API_KEY' || type === 'AUTH_TOKEN') {
      if (value.length <= 8) return '****';
      return value.substring(0, 4) + '****' + value.substring(value.length - 4);
    }
    if (type === 'EMAIL') {
      var parts = value.split('@');
      if (parts.length === 2) {
        var name = parts[0];
        if (name.length <= 2) return name[0] + '***@' + parts[1];
        return name.substring(0, 2) + '***@' + parts[1];
      }
    }
    if (type === 'CREDIT_CARD') {
      var stripped = value.replace(/\D/g, '');
      if (stripped.length >= 8) {
        return '****-****-****-' + stripped.substring(stripped.length - 4);
      }
    }
    if (type === 'PHONE') {
      var ph = value.replace(/\D/g, '');
      if (ph.length >= 6) {
        return '***-***-' + ph.substring(ph.length - 4);
      }
    }
    if (type === 'GOVERNMENT_ID') {
      if (value.length >= 6) {
        return '***-' + value.substring(value.length - 4);
      }
    }
    // Default: show first 4 and last 2 chars
    if (value.length > 8) {
      return value.substring(0, 4) + '...' + value.substring(value.length - 2);
    }
    if (value.length > 4) {
      return value.substring(0, 2) + '***' + value.substring(value.length - 1);
    }
    return '****';
  }

  function renderReport(result) {
    if (!result || !result.entities) {
      reportPanel.style.display = 'none';
      return;
    }

    var counts = result.counts || {};
    var total = result.totalEntities || 0;
    var processingTime = result.processingTime ? result.processingTime.total : '--';

    var entityTypes = [
      { key: 'EMAIL', label: 'Emails' },
      { key: 'PHONE', label: 'Phones' },
      { key: 'PASSWORD', label: 'Passwords' },
      { key: 'CREDIT_CARD', label: 'Credit Cards' },
      { key: 'API_KEY', label: 'API Keys' },
      { key: 'AUTH_TOKEN', label: 'Auth Tokens' },
      { key: 'GOVERNMENT_ID', label: 'Gov IDs' },
      { key: 'BANK_ACCOUNT', label: 'Bank Accounts' },
      { key: 'ADDRESS', label: 'Addresses' },
      { key: 'NAME', label: 'Names' }
    ];

    var html = '<div class="report-title">Privacy Report</div>';

    html += '<div class="report-section">';
    html += '<div class="report-section-title">Detection Summary</div>';
    html += '<div class="report-row"><span>Total Entities</span><span>' + total + '</span></div>';
    html += '<div class="report-row"><span>Overall Risk</span><span style="color:' + getRiskColor(result.overallRisk) + '">' + (result.overallRisk || 'LOW') + '</span></div>';
    html += '<div class="report-row"><span>Page Type</span><span>' + escapeHtml((result.pageType || 'unknown').replace(/_/g, ' ')) + '</span></div>';
    html += '<div class="report-row"><span>Processing Time</span><span>' + processingTime + ' ms</span></div>';
    html += '<div class="report-row"><span>DOM Elements</span><span>' + (result.pageContext ? result.pageContext.domElementCount : '--') + '</span></div>';
    html += '<div class="report-row"><span>Form Fields</span><span>' + (result.pageContext ? result.pageContext.formFieldCount : '--') + '</span></div>';
    html += '</div>';

    html += '<div class="report-divider"></div>';

    html += '<div class="report-section">';
    html += '<div class="report-section-title">Entities by Type</div>';
    for (var i = 0; i < entityTypes.length; i++) {
      var et = entityTypes[i];
      var count = counts[et.key] || 0;
      if (count > 0) {
        var pct = total > 0 ? (count / total * 100) : 0;
        html += '<div class="report-row"><span>' + et.label + '</span><span>' + count + '</span></div>';
        html += '<div class="report-bar"><div class="report-bar-fill ' + getBarClass(pct) + '" style="width:' + Math.max(pct, 5) + '%"></div></div>';
      }
    }
    html += '</div>';

    // Safety assessment
    var safeLevel = 'safe';
    var safeText = 'This page has minimal PII exposure.';
    if (total > 5 || result.overallRisk === 'CRITICAL') {
      safeLevel = 'danger';
      safeText = 'High PII exposure detected. Review before sharing with AI agents.';
    } else if (total > 2 || result.overallRisk === 'HIGH') {
      safeLevel = 'warning';
      safeText = 'Moderate PII detected. Use sanitized context for AI access.';
    }

    html += '<div class="report-divider"></div>';
    html += '<div class="report-section">';
    html += '<div class="report-section-title">Safety Assessment</div>';
    html += '<div class="report-row"><span>Status</span><span style="color:' + (safeLevel === 'safe' ? '#4ade80' : safeLevel === 'warning' ? '#fbbf24' : '#f87171') + '">' + (safeLevel === 'safe' ? 'SAFE' : safeLevel === 'warning' ? 'CAUTION' : 'HIGH RISK') + '</span></div>';
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:4px;">' + safeText + '</div>';
    html += '</div>';

    reportPanel.innerHTML = html;
    reportPanel.style.display = 'block';
  }

  function getRiskColor(risk) {
    switch (risk) {
      case 'LOW': return '#60a5fa';
      case 'MEDIUM': return '#fbbf24';
      case 'HIGH': return '#f97316';
      case 'CRITICAL': return '#ef4444';
      default: return '#94a3b8';
    }
  }

  function getBarClass(pct) {
    if (pct < 30) return 'safe';
    if (pct < 60) return 'warning';
    return 'danger';
  }

  // ─── Button Handlers ───────────────────────────────────────────────────────
  function showLoading(btn, loading) {
    if (loading) {
      btn.classList.add('loading');
      btn.disabled = true;
    } else {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  async function handleScan() {
    showLoading(scanBtn, true);
    reportPanel.style.display = 'none';

    try {
      var response = await sendMessageToContent({ type: 'SCAN_PAGE' });

      if (response && response.success) {
        lastResult = response;

        updateRiskDisplay(response.overallRisk);
        updateCounts(response.counts);
        updateMetrics(response);
        renderEntitiesList(response.entities, response.risks);

        // Update access status
        if (response.totalEntities > 0) {
          accessStatus.innerHTML = '<span class="access-icon">&#9989;</span> AI Access: SANITIZED ONLY';
          accessStatus.style.background = 'rgba(34, 197, 94, 0.08)';
          accessStatus.style.borderColor = 'rgba(34, 197, 94, 0.2)';
          accessStatus.style.color = '#4ade80';
        } else {
          accessStatus.innerHTML = '<span class="access-icon">&#9989;</span> AI Access: CLEAR';
          accessStatus.style.background = 'rgba(59, 130, 246, 0.08)';
          accessStatus.style.borderColor = 'rgba(59, 130, 246, 0.2)';
          accessStatus.style.color = '#60a5fa';
        }

        // Increment scan count in background
        chrome.runtime.sendMessage({ type: 'INCREMENT_SCAN_COUNT' });
        chrome.runtime.sendMessage({
          type: 'LOG_EVENT',
          level: 'info',
          message: 'Manual scan completed',
          data: { entityCount: response.totalEntities, risk: response.overallRisk }
        });
      } else {
        updateRiskDisplay('--');
        accessStatus.innerHTML = '<span class="access-icon">&#10060;</span> Scan Failed: ' + escapeHtml(response ? response.error : 'No response');
        accessStatus.style.background = 'rgba(220, 38, 38, 0.08)';
        accessStatus.style.borderColor = 'rgba(220, 38, 38, 0.2)';
        accessStatus.style.color = '#f87171';
      }
    } catch (err) {
      updateRiskDisplay('--');
      accessStatus.innerHTML = '<span class="access-icon">&#10060;</span> Error: ' + escapeHtml(err.message);
      accessStatus.style.background = 'rgba(220, 38, 38, 0.08)';
      accessStatus.style.borderColor = 'rgba(220, 38, 38, 0.2)';
      accessStatus.style.color = '#f87171';
    } finally {
      showLoading(scanBtn, false);
    }
  }

  async function handlePreview() {
    // Ensure we have scan results first.
    if (!lastResult || !lastResult.entities || lastResult.entities.length === 0) {
      await handleScan();
    }

    // Opening the full privacy visualizer requires detected entities.
    if (lastResult && lastResult.entities && lastResult.entities.length > 0) {
      try {
        await sendMessageToContent({ type: 'TOGGLE_PRIVACY_VISUALIZER' });
        previewBtn.textContent = 'Visualizer Open';
      } catch (err) {
        previewBtn.textContent = 'Unavailable';
      }
      setTimeout(function () {
        previewBtn.textContent = 'Preview Redaction';
      }, 2000);
    } else {
      previewBtn.textContent = 'Nothing to Preview';
      setTimeout(function () {
        previewBtn.textContent = 'Preview Redaction';
      }, 2000);
    }
  }

  function handleReport() {
    if (reportPanel.style.display === 'none' || !reportPanel.style.display) {
      if (lastResult) {
        renderReport(lastResult);
      } else {
        reportPanel.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128269;</div>No scan data yet. Run a scan first.</div>';
        reportPanel.style.display = 'block';
      }
    } else {
      reportPanel.style.display = 'none';
    }
  }

  async function handleAskAgent() {
    var instruction = agentInstruction.value.trim();
    if (!instruction) {
      agentResult.hidden = false;
      agentResult.textContent = 'Enter an instruction first.';
      return;
    }

    askAgentBtn.disabled = true;
    askAgentBtn.textContent = 'Checking and asking...';
    agentResult.hidden = false;
    agentResult.textContent = 'Scanning locally and preparing sanitized context...';

    try {
      if (!lastResult || !lastResult.sanitizedContext) await handleScan();
      if (!lastResult || !lastResult.sanitizedContext) throw new Error('A successful local scan is required.');
      var response = await new Promise(function (resolve) {
        chrome.runtime.sendMessage({ type: 'CLOUD_AGENT_REQUEST', instruction: instruction, context: lastResult.sanitizedContext }, resolve);
      });
      if (!response || !response.success) throw new Error(response && response.error ? response.error : 'Cloud AI request failed.');
      agentResult.textContent = response.answer;
    } catch (err) {
      agentResult.textContent = err.message;
    } finally {
      askAgentBtn.disabled = false;
      askAgentBtn.textContent = 'Ask Open-Source AI';
    }
  }

  async function handleSettings() {
    if (settingsPanel) {
      settingsPanel.remove();
      settingsPanel = null;
      return;
    }

    settingsPanel = document.createElement('div');
    settingsPanel.className = 'report-panel';

    try {
      var response = await new Promise(function (resolve) {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, resolve);
      });

      var settings = response.settings || {};

      var html = '<div class="report-title">Settings</div>';
      html += '<div class="settings-section">';

      var toggles = [
        { key: 'enabled', label: 'Extension Enabled' },
        { key: 'autoScan', label: 'Auto Scan on Page Load' },
        { key: 'enableOCR', label: 'OCR Detection' },
        { key: 'enableDOM', label: 'DOM Detection' },
        { key: 'enableFirewall', label: 'Outbound Firewall' },
        { key: 'enableLogging', label: 'Audit Logging' }
      ];

      for (var i = 0; i < toggles.length; i++) {
        var t = toggles[i];
        var active = settings[t.key] ? ' active' : '';
        html += '<div class="setting-row">' +
          '<span class="setting-label">' + t.label + '</span>' +
          '<div class="setting-toggle' + active + '" data-key="' + t.key + '"></div>' +
        '</div>';
      }

      html += '</div>';
      settingsPanel.innerHTML = html;

      var container = document.getElementById('app');
      container.appendChild(settingsPanel);

      // Attach toggle handlers
      var toggleEls = settingsPanel.querySelectorAll('.setting-toggle');
      for (var j = 0; j < toggleEls.length; j++) {
        toggleEls[j].addEventListener('click', function () {
          var key = this.getAttribute('data-key');
          var isActive = this.classList.contains('active');
          this.classList.toggle('active');

          // Update settings
          settings[key] = !isActive;
          chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: settings });

          // Update badge if enabled changed
          if (key === 'enabled') {
            if (isActive) {
              statusBadge.textContent = 'DISABLED';
              statusBadge.classList.add('disabled');
            } else {
              statusBadge.textContent = 'ACTIVE';
              statusBadge.classList.remove('disabled');
            }
          }
        });
      }
    } catch (err) {
      settingsPanel.innerHTML = '<div class="report-title">Settings</div><div class="empty-state">Failed to load settings.</div>';
      var container = document.getElementById('app');
      container.appendChild(settingsPanel);
    }
  }

  // ─── Event Listeners ───────────────────────────────────────────────────────
  scanBtn.addEventListener('click', handleScan);
  previewBtn.addEventListener('click', handlePreview);
  reportBtn.addEventListener('click', handleReport);
  settingsBtn.addEventListener('click', handleSettings);
  askAgentBtn.addEventListener('click', handleAskAgent);

  // ─── Initialize ────────────────────────────────────────────────────────────
  function init() {
    // Try to load last scan result from content script
    sendMessageToContent({ type: 'GET_LAST_SCAN' })
      .then(function (response) {
        if (response && response.success && response.result) {
          lastResult = response.result;
          updateRiskDisplay(lastResult.overallRisk);
          updateCounts(lastResult.counts);
          updateMetrics(lastResult);
          renderEntitiesList(lastResult.entities, lastResult.risks);
        }
      })
      .catch(function () {
        // Content script not available, that's fine
      });

    // Get page context for page type display
    sendMessageToContent({ type: 'GET_PAGE_CONTEXT' })
      .then(function (response) {
        if (response && response.success) {
          pageTypeValue.textContent = (response.pageType || 'unknown').replace(/_/g, ' ');
        }
      })
      .catch(function () {});

    // Load settings
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, function (response) {
      if (response && response.success) {
        var settings = response.settings || {};
        if (settings.enabled === false) {
          statusBadge.textContent = 'DISABLED';
          statusBadge.classList.add('disabled');
        }
      }
    });
  }

  init();
})();
