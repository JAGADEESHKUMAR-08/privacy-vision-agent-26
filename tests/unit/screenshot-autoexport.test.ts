// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import PVA_AutoExport from '../../extension/screenshot-autoexport.js';

const DUMMY = 'data:image/png;base64,AAAA';

describe('screenshot-autoexport (automatic redacted-only folder persistence)', () => {
  it('builds a dated subfolder path per PNG', () => {
    expect(PVA_AutoExport.recordFilename('rec_7', 'after')).toMatch(
      /^privacy-vision-agent-screenshots\/\d{4}-\d{2}-\d{2}\/rec_7_after\.png$/,
    );
    expect(PVA_AutoExport.dateFolder(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('exports ONLY the redacted image to disk (raw before never leaves the store)', () => {
    const file = PVA_AutoExport.buildRedactedFile({
      id: 'rec_9',
      originalDataUrl: DUMMY,
      redactedDataUrl: DUMMY,
    });
    expect(file).not.toBeNull();
    expect(file!.filename).toContain('_after.png');
    expect(file!.url).toBe(DUMMY);
    // No "before" file is produced at all.
    expect(PVA_AutoExport.buildRedactedFile({ id: 'rec_9', originalDataUrl: DUMMY })).toBeNull();
    expect(PVA_AutoExport.buildRedactedFile({ id: 'rec_0' })).toBeNull();
    expect(PVA_AutoExport.buildRedactedFile(null as never)).toBeNull();
  });

  it('dispatches one (redacted) download and reports the count', () => {
    const downloadsMock = {
      download: vi.fn(() => {}),
    };
    const copied = PVA_AutoExport.autoExportRecord(downloadsMock, {
      id: 'rec_3',
      originalDataUrl: DUMMY,
      redactedDataUrl: DUMMY,
    });
    expect(copied).toBe(1);
    expect(downloadsMock.download).toHaveBeenCalledTimes(1);
    const call = downloadsMock.download.mock.calls[0][0];
    expect(call.conflictAction).toBe('overwrite');
    expect(call.filename).toContain('_after.png');
    // Record without a redacted image dispatches nothing.
    downloadsMock.download.mockClear();
    expect(
      PVA_AutoExport.autoExportRecord(downloadsMock, { id: 'rec_3', originalDataUrl: DUMMY }),
    ).toBe(0);
    expect(downloadsMock.download).not.toHaveBeenCalled();
  });
});