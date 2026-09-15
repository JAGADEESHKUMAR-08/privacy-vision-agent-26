// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import PVA_Export from '../../extension/export-screenshots.js';

const PNG_DUMMY =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function makeFakeDir(): {
  files: Map<string, Blob>;
  getDirectoryHandle: ReturnType<typeof vi.fn>;
  createWritable: ReturnType<typeof vi.fn>;
} {
  const files = new Map<string, Blob>();
  const subs = new Map<string, ReturnType<typeof makeFakeDir>>();
  return {
    files,
    getDirectoryHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
      if (subs.has(name)) return subs.get(name);
      if (opts && opts.create) {
        const child = makeFakeDir();
        subs.set(name, child);
        return child;
      }
      throw new Error(`Not a directory: ${name}`);
    }),
    createWritable: vi.fn(async (name: string) => {
      const stream = {
        saved: null as Blob | null,
        write: async (data: Blob) => {
          stream.saved = data;
        },
        close: async () => {
          if (stream.saved) files.set(name, stream.saved);
        },
      };
      return stream;
    }),
  };
}

function makeRecord(partial: Record<string, unknown> = {}) {
  return {
    id: 'rec_123',
    url: 'https://shop.example/checkout?hide=alice@example.com&x=1',
    title: 'Checkout — Alice',
    pageType: 'checkout',
    timestamp: 1725000000000,
    overallRisk: 'HIGH',
    entityCount: 1,
    originalDataUrl: PNG_DUMMY,
    redactedDataUrl: PNG_DUMMY,
    ...partial,
  };
}

describe('export-screenshots (on-disk folder writer)', () => {
  it('decodes a PNG data URL into a Blob', () => {
    const blob = PVA_Export.dataUrlToBlob(PNG_DUMMY);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('strips query strings (potential PII) from manifest URLs', () => {
    expect(PVA_Export.sanitizeUrlForManifest('https://shop.example/checkout?hide=alice@example.com')).toBe(
      'https://shop.example/checkout',
    );
    expect(PVA_Export.sanitizeUrlForManifest('https://shop.example/?a=1')).toBe('https://shop.example');
  });

  it('writes before + after PNGs and a metadata manifest into the folder', async () => {
    const dir = makeFakeDir();
    const record = makeRecord();
    const exported = await PVA_Export.exportRecordsToDir(dir as never, [record]);

    expect(dir.createWritable).toHaveBeenCalledWith('rec_123_before.png');
    expect(dir.createWritable).toHaveBeenCalledWith('rec_123_after.png');
    expect(dir.createWritable).toHaveBeenCalledWith('manifest.json');
    expect(dir.files.has('rec_123_before.png')).toBe(true);
    expect(dir.files.has('rec_123_after.png')).toBe(true);
    expect(dir.files.get('rec_123_before.png')!.type).toBe('image/png');

    const manifestBlob = dir.files.get('manifest.json')!;
    expect(manifestBlob.type).toBe('application/json');
    const manifest = JSON.parse(await manifestBlob.text());
    expect(manifest.count).toBe(1);
    expect(manifest.records[0]).toMatchObject({
      id: 'rec_123',
      url: 'https://shop.example/checkout',
      pageType: 'checkout',
      overallRisk: 'HIGH',
      entityCount: 1,
      redacted: true,
      files: ['rec_123_before.png', 'rec_123_after.png'],
    });
    // No raw PII anywhere in the exported metadata.
    expect(JSON.stringify(manifest)).not.toContain('alice@example.com');
    expect(exported).toHaveLength(1);
  });

  it('skips records with no imagery', async () => {
    const dir = makeFakeDir();
    const exported = await PVA_Export.exportRecordsToDir(dir as never, [
      makeRecord({ originalDataUrl: undefined, redactedDataUrl: undefined }),
    ]);
    expect(exported).toHaveLength(0);
    expect(dir.files.has('manifest.json')).toBe(true);
  });
});