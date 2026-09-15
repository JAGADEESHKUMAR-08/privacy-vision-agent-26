/* Privacy Vision Agent - Automatic screenshot persistence to the local
 * download folder. Whenever a before/after pair is stored in IndexedDB, the
 * service worker fires chrome.downloads.download for both PNGs so a copy is
 * written to the browser's download directory (which the user may point at
 * any local folder). On-device only; no network egress. */
'use strict';
(function (global) {
  var PVA_AutoExport = {};

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function dateFolder(ts) {
    var d = ts ? new Date(ts) : new Date();
    return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-');
  }

  function recordFilename(id, sink) {
    return 'privacy-vision-agent-screenshots/' + dateFolder() + '/' + id + '_' + sink + '.png';
  }

  /* Build the single redacted (after) file to write for a stored record.
   * Only the visually redacted image ever lands on disk: the raw "before"
   * capture stays inside IndexedDB and never crosses to the filesystem. */
  function buildRedactedFile(record) {
    if (!record || !record.redactedDataUrl) return null;
    return {
      filename: recordFilename(String(record.id || ('shot-' + Date.now())), 'after'),
      url: record.redactedDataUrl
    };
  }

  /* Fire-and-forget write of a record's redacted image to the download
   * folder. Returns the number of files dispatched (0 or 1). */
  function autoExportRecord(downloadsApi, record) {
    var file = buildRedactedFile(record);
    if (!file) return 0;
    try {
      downloadsApi.download({ url: file.url, filename: file.filename, conflictAction: 'overwrite' });
      return 1;
    } catch (e) {
      return 0;
    }
  }

  PVA_AutoExport.dateFolder = dateFolder;
  PVA_AutoExport.recordFilename = recordFilename;
  PVA_AutoExport.buildRedactedFile = buildRedactedFile;
  PVA_AutoExport.autoExportRecord = autoExportRecord;

  global.PVA_AutoExport = PVA_AutoExport;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PVA_AutoExport;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);