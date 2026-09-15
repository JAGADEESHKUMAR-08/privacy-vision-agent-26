/**
 * screenshot-store.js - Privacy Vision Agent
 * On-device local screenshot store backed by IndexedDB.
 *
 * Captured page screenshots (original + locally redacted) are persisted ONLY in
 * the browser extension's own IndexedDB database. They are never written to
 * chrome.storage.sync, never included in the audit log, and never transmitted
 * anywhere. External AI agents only ever receive the sanitized context built by
 * the content script - never the stored screenshots.
 *
 * The store exposes metadata-only `list()` so the popup can show a counter and
 * lightweight rows without shipping megabytes of image data through messages.
 * `get(id)` returns the full record (original + redacted data URLs) and is only
 * used locally by the popup visualizer.
 *
 * Privacy policy:
 *   - Records are pruned to the newest MAX_ENTRIES.
 *   - Individual records larger than MAX_RECORD_BYTES are rejected.
 *   - The audit log contains only counts, never screenshot data or PII values.
 */

'use strict';

var ScreenshotStore = (function () {
  var DB_NAME = 'pva_screenshot_store';
  var DB_VERSION = 1;
  var OBJECT_STORE = 'screenshots';
  var MAX_ENTRIES = 10;
  var MAX_RECORD_BYTES = 6 * 1024 * 1024; // ~6 MB per PNG data URL

  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(OBJECT_STORE)) {
          var store = db.createObjectStore(OBJECT_STORE, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = function (event) {
        resolve(event.target.result);
      };
      req.onerror = function () {
        dbPromise = null;
        reject(req.error || new Error('Failed to open screenshot store'));
      };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(OBJECT_STORE, mode);
        var done = fn(t.objectStore(OBJECT_STORE));
        t.oncomplete = function () {
          resolve(done && done.result !== undefined ? done.result : done);
        };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('tx aborted')); };
      });
    });
  }

  function generateId() {
    return 'ss_' + Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  /**
   * Persist a captured screenshot. `record` may contain:
   *   url, title, pageType, timestamp (auto), overallRisk, entityCount,
   *   originalDataUrl, redactedDataUrl, sizeBytes.
   * Sensitive *values* are never part of the record - only the imagery itself,
   * which stays on the device.
   */
  function save(record) {
    record = record || {};
    if (!record.originalDataUrl) {
      return Promise.reject(new Error('Screenshot store: missing originalDataUrl'));
    }
    var sizeBytes = record.sizeBytes ||
      (record.originalDataUrl.length + (record.redactedDataUrl || '').length);
    if (sizeBytes > MAX_RECORD_BYTES) {
      return Promise.reject(new Error('Screenshot store: record too large'));
    }

    var entry = {
      id: record.id || generateId(),
      url: String(record.url || '').slice(0, 512),
      title: String(record.title || '').slice(0, 256),
      pageType: record.pageType || 'unknown',
      timestamp: record.timestamp || Date.now(),
      overallRisk: record.overallRisk || 'UNKNOWN',
      entityCount: record.entityCount || 0,
      sizeBytes: sizeBytes,
      originalDataUrl: record.originalDataUrl,
      redactedDataUrl: record.redactedDataUrl || '',
    };

    return tx('readwrite', function (store) {
      var req = store.put(entry);
      req.onsuccess = function () { return { entry: entry }; };
      var req2 = store.count();
      req2.onsuccess = function () { return { count: req2.result }; };
      return req2;
    }).then(function () {
      return prune().then(function (count) {
        return { success: true, id: entry.id, count: count };
      });
    });
  }

  function prune() {
    return tx('readwrite', function (store) {
      return store.count();
    }).then(function (result) {
      var total = Number(result && result.count !== undefined ? result.count : result) || 0;
      if (total <= MAX_ENTRIES) return total;
      var overflow = total - MAX_ENTRIES;
      return tx('readwrite', function (store) {
        var idx = store.index('timestamp');
        var keyRange = IDBKeyRange.lowerBound(0);
        var keys = [];
        var req = idx.openCursor(keyRange, 'next');
        req.onsuccess = function (event) {
          var cursor = event.target.result;
          if (cursor) {
            keys.push(cursor.primaryKey);
            if (keys.length < overflow) cursor.continue();
          }
        };
        return { keys: keys };
      }).then(function (result) {
        var keys = (result && result.keys) || [];
        return tx('readwrite', function (store) {
          keys.forEach(function (key) { store.delete(key); });
          return { pruned: keys.length };
        }).then(function () { return total - keys.length; });
      });
    });
  }

  /** Metadata-only listing. No image data crosses this boundary. */
  function list() {
    return tx('readonly', function (store) {
      var all = [];
      var req = store.openCursor();
      req.onsuccess = function (event) {
        var cursor = event.target.result;
        if (cursor) {
          all.push(cursor.value);
          cursor.continue();
        }
      };
      return { all: all };
    }).then(function (result) {
      var all = (result && result.all) || [];
      var meta = all
        .sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); })
        .map(function (entry) {
          return {
            id: entry.id,
            url: entry.url,
            title: entry.title,
            pageType: entry.pageType,
            timestamp: entry.timestamp,
            overallRisk: entry.overallRisk,
            entityCount: entry.entityCount,
            sizeBytes: entry.sizeBytes,
            hasRedacted: !!entry.redactedDataUrl,
          };
        });
      return { screenshots: meta, count: meta.length };
    });
  }

  /** Full record including image data. Local retrieval only. */
  function get(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var txGet = db.transaction(OBJECT_STORE, 'readonly');
        var req = txGet.objectStore(OBJECT_STORE).get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      });
    });
  }

  function remove(id) {
    return tx('readwrite', function (store) {
      store.delete(id);
    }).then(function () { return { success: true }; });
  }

  function clear() {
    return tx('readwrite', function (store) {
      return store.clear();
    }).then(function () { return { success: true }; });
  }

  return {
    save: save,
    list: list,
    get: get,
    remove: remove,
    clear: clear,
    MAX_ENTRIES: MAX_ENTRIES,
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.PVA_ScreenshotStore = ScreenshotStore;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScreenshotStore;
}