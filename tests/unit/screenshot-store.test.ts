import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// Provide IndexedDB + IDBKeyRange before the store is exercised.
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
(globalThis as any).indexedDB = indexedDB;
(globalThis as any).IDBKeyRange = IDBKeyRange;

import '../../extension/screenshot-store.js';
const store = (globalThis as any).PVA_ScreenshotStore as {
  save(record: any): Promise<{ success: boolean; id: string; count: number }>;
  list(): Promise<{ screenshots: any[]; count: number }>;
  get(id: string): Promise<any>;
  remove(id: string): Promise<{ success: boolean }>;
  clear(): Promise<{ success: boolean }>;
  MAX_ENTRIES: number;
};

function dataUrl(bytes: number): string {
  return 'data:image/png;base64,' + 'A'.repeat(bytes);
}

async function clearStore(): Promise<void> {
  await store.clear();
}

describe('ScreenshotStore', () => {
  beforeAll(async () => {
    await store.clear();
  });
  beforeEach(async () => {
    await clearStore();
  });

  it('exposes the store through globalThis', () => {
    expect(store).toBeTruthy();
    expect(store.MAX_ENTRIES).toBe(10);
  });

  it('saves a screenshot record and rounds it up via list()', async () => {
    const res = await store.save({
      url: 'https://example.com/',
      title: 'Example',
      pageType: 'banking',
      overallRisk: 'CRITICAL',
      entityCount: 3,
      originalDataUrl: dataUrl(100),
      redactedDataUrl: dataUrl(50),
    });
    expect(res.success).toBe(true);
    expect(res.id).toMatch(/^ss_/);

    const { screenshots, count } = await store.list();
    expect(count).toBe(1);
    expect(screenshots[0]).toMatchObject({
      url: 'https://example.com/',
      title: 'Example',
      pageType: 'banking',
      overallRisk: 'CRITICAL',
      entityCount: 3,
      hasRedacted: true,
    });
    // list() must NOT leak image data across the message boundary.
    expect(screenshots[0].originalDataUrl).toBeUndefined();
    expect(screenshots[0].redactedDataUrl).toBeUndefined();
  });

  it('rejects records without originalDataUrl', async () => {
    await expect(store.save({ title: 'no image' })).rejects.toThrow(/missing originalDataUrl/);
  });

  it('rejects oversized records (>6MiB)', async () => {
    await expect(store.save({ originalDataUrl: dataUrl(7 * 1024 * 1024) })).rejects.toThrow(
      /too large/,
    );
  });

  it('get() returns the full record including images', async () => {
    const { id } = await store.save({ url: 'https://a.test/', originalDataUrl: dataUrl(10) });
    const record = await store.get(id);
    expect(record).toBeTruthy();
    expect(record.id).toBe(id);
    expect(record.originalDataUrl).toBe('data:image/png;base64,' + 'A'.repeat(10));
  });

  it('get() returns null for a missing id', async () => {
    await expect(store.get('missing-id')).resolves.toBeNull();
  });

  it('remove() deletes a record', async () => {
    const { id } = await store.save({ url: 'https://a.test/', originalDataUrl: dataUrl(10) });
    await store.remove(id);
    const { count } = await store.list();
    expect(count).toBe(0);
  });

  it('clear() empties the store', async () => {
    await store.save({ url: 'https://a.test/', originalDataUrl: dataUrl(10) });
    await store.save({ url: 'https://b.test/', originalDataUrl: dataUrl(10) });
    await store.clear();
    const { count } = await store.list();
    expect(count).toBe(0);
  });

  it('lists newest-first by timestamp', async () => {
    const a = await store.save({ url: 'https://old.test/', timestamp: 100, originalDataUrl: dataUrl(4) });
    const b = await store.save({ url: 'https://new.test/', timestamp: 200, originalDataUrl: dataUrl(4) });
    const { screenshots } = await store.list();
    expect(screenshots.map((s: any) => s.id)).toEqual([b.id, a.id]);
  });

  it('prunes to MAX_ENTRIES keeping the newest', async () => {
    for (let i = 0; i < store.MAX_ENTRIES + 3; i++) {
      // timestamps must be truthy (>0) or the store falls back to Date.now()
      await store.save({ url: `https://p${i}.test/`, timestamp: i + 1, originalDataUrl: dataUrl(2) });
    }
    const { screenshots, count } = await store.list();
    expect(count).toBe(store.MAX_ENTRIES);
    // The three oldest (p0, p1, p2) are pruned; the newest ten survive.
    expect(screenshots.map((s: any) => s.url)).toEqual([
      `https://p${store.MAX_ENTRIES + 2}.test/`,
      `https://p${store.MAX_ENTRIES + 1}.test/`,
      `https://p${store.MAX_ENTRIES}.test/`,
      `https://p${store.MAX_ENTRIES - 1}.test/`,
      `https://p${store.MAX_ENTRIES - 2}.test/`,
      `https://p${store.MAX_ENTRIES - 3}.test/`,
      `https://p${store.MAX_ENTRIES - 4}.test/`,
      `https://p${store.MAX_ENTRIES - 5}.test/`,
      `https://p${store.MAX_ENTRIES - 6}.test/`,
      `https://p${store.MAX_ENTRIES - 7}.test/`,
    ]);
    expect(screenshots.some((s: any) => s.url === 'https://p0.test/')).toBe(false);
  });
});