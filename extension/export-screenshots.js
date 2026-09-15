/* Privacy Vision Agent - On-device folder export for stored screenshots.
 * Converts before/after screenshot data URLs into PNG files and a metadata
 * manifest, writing them into a user-chosen local folder via the File System
 * Access API. URL query strings are scrubbed from the manifest so no raw PII
 * is ever written beside the imagery. */
'use strict';
(function (global) {
  var PVA_Export = {};

  function dataUrlToBlob(dataUrl) {
    var comma = dataUrl.indexOf(',');
    var meta = dataUrl.slice(0, comma);
    var b64 = dataUrl.slice(comma + 1);
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    var mimeMatch = /data:([^;,]+)/.exec(meta);
    return new Blob([bytes], { type: mimeMatch ? mimeMatch[1] : 'image/png' });
  }

  function sanitizeUrlForManifest(rawUrl) {
    try {
      var u = new URL(rawUrl);
      var path = u.pathname;
      if (!path || path === '/') path = '';
      return u.origin + path;
    } catch (e) {
      return String(rawUrl || '').slice(0, 512);
    }
  }

  async function writeToWritable(writable, blob) {
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
  }

  /* records: array of { id, url, title, pageType, timestamp, overallRisk,
   * entityCount, originalDataUrl, redactedDataUrl } as returned by the store.
   * dirHandle: a FileSystemDirectoryHandle (readwrite).
   * Returns the list of files actually written. */
  async function exportRecordsToDir(dirHandle, records) {
    var written = [];
    var manifestRecords = [];
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (!rec || !rec.id) continue;
      var beforeName = rec.id + '_before.png';
      var afterName = rec.id + '_after.png';
      var files = [];
      if (rec.originalDataUrl) {
        await writeToWritable(await dirHandle.createWritable(beforeName), dataUrlToBlob(rec.originalDataUrl));
        files.push(beforeName);
      }
      if (rec.redactedDataUrl) {
        await writeToWritable(await dirHandle.createWritable(afterName), dataUrlToBlob(rec.redactedDataUrl));
        files.push(afterName);
      }
      if (files.length === 0) continue;
      written.push({ id: rec.id, files: files });
      manifestRecords.push({
        id: rec.id,
        url: sanitizeUrlForManifest(rec.url),
        pageType: rec.pageType || 'unknown',
        timestamp: rec.timestamp || 0,
        overallRisk: rec.overallRisk || 'UNKNOWN',
        entityCount: rec.entityCount || 0,
        redacted: !!rec.redactedDataUrl,
        files: files
      });
    }
    var manifest = {
      app: 'privacy-vision-agent',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      count: manifestRecords.length,
      note: 'Before/after screenshots stored on-device. Manifest contains metadata only - no raw PII values.',
      records: manifestRecords
    };
    await writeToWritable(await dirHandle.createWritable('manifest.json'), new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
    return manifestRecords;
  }

  PVA_Export.dataUrlToBlob = dataUrlToBlob;
  PVA_Export.sanitizeUrlForManifest = sanitizeUrlForManifest;
  PVA_Export.exportRecordsToDir = exportRecordsToDir;

  global.PVA_Export = PVA_Export;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PVA_Export;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);