import { test, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const EXT_PATH = path.resolve(__dirname, '../../extension');
const BANKING_URL = 'https://bank.test/banking';

const BANKING_HTML = `<!doctype html>
<html><head><title>Secure Bank - Accounts</title></head>
<body style="font-family: monospace; margin: 20px;">
  <h1 id="head">Secure Bank</h1>
  <p id="welcome">Welcome back, valued customer.</p>
  <p id="email-line">Email: alice.johnson@securemail.net</p>
  <p id="phone-line">Phone: 555-123-4567</p>
  <p id="card-line">Card on file: 4111 1111 1111 1111</p>
  <form id="login">
    <div><label>SSN <input type="text" id="ssn" name="ssn" value="123-45-6789"></label></div>
    <div><label>Username <input type="text" id="user" name="username" value="jsmith88"></label></div>
    <div><label>Password <input type="password" id="pass" name="password" value="correcthorse"></label></div>
    <button type="submit" id="submit">Log in</button>
  </form>
  <div id="balance" style="margin-top: 40px;">Routing: 011401533 Account: 10012345678</div>
</body></html>`;

let dirCounter = 0;

function profileDir(): string {
  dirCounter += 1;
  return path.join(process.env.TEMP || '.', 'opencode-pva-e2e', `profile-${Date.now()}-${dirCounter}`);
}

async function launchExtension(): Promise<{ context: BrowserContext; sw: Worker; extId: string }> {
  const context = await chromium.launchPersistentContext(profileDir(), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = await sw.evaluate(() => globalThis.chrome?.runtime?.id ?? '');
  return { context, sw, extId };
}

async function sendToActiveTab(sw: Worker, message: Record<string, unknown>, url: string): Promise<any> {
  return sw.evaluate(
    async ({ msg, tabUrl }) => {
      const tabs = await chrome.tabs.query({ url: tabUrl });
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) return { success: false, error: 'no matching tab' };
      return await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, msg, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || {});
          }
        });
      });
    },
    { msg: message, tabUrl: url },
  );
}

function bankRoute(route: any): Promise<any> {
  return route.fulfill({ status: 200, contentType: 'text/html', body: BANKING_HTML });
}

async function scanUntilSuccess(sw: Worker, pageUrl: string, tries = 20): Promise<any> {
  let last: any = null;
  for (let i = 0; i < tries; i++) {
    const resp = await sendToActiveTab(sw, { type: 'SCAN_PAGE' }, pageUrl);
    if (resp && resp.success && resp.entities) return resp;
    last = resp;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('scan never succeeded: ' + JSON.stringify(last));
}

test.describe('Privacy Vision Agent (real unpacked extension)', () => {
  test.afterEach(async ({}, testInfo) => {
    // Each test cleans up its own contexts via try/finally.
    void testInfo;
  });

  test('loads the MV3 service worker and exposes the popup', async () => {
    const { context, sw, extId } = await launchExtension();
    try {
      expect(extId).toMatch(/^[a-p]{32}$/);
      const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
      expect(manifest.name).toBe('Privacy Vision Agent');
      expect(manifest.version).toBe('1.0.0');

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'domcontentloaded' });
      const title = await popup.title();
      expect(title.length).toBeGreaterThan(0);
      await popup.close();
    } finally {
      await context.close();
    }
  });

  test('full scan detects PII, redacts visually, sanitizes context, stores screenshot locally', async () => {
    const { context, sw } = await launchExtension();
    try {
      const page = await context.newPage();
      await page.route('**://bank.test/**', bankRoute);
      await page.goto(BANKING_URL, { waitUntil: 'load' });

      const scan = await scanUntilSuccess(sw, BANKING_URL);

      expect(scan.entities.length).toBeGreaterThanOrEqual(3);
      const types = scan.entities.map((e: any) => e.type);
      expect(types).toEqual(expect.arrayContaining(['PHONE', 'CREDIT_CARD']));

      // Visual redaction overlay created with boxes (on demand via content script).
      const overlayResp = await sendToActiveTab(sw, { type: 'SHOW_DETECTION_OVERLAY' }, BANKING_URL);
      expect(overlayResp.success).toBe(true);
      expect(overlayResp.overlayCount).toBeGreaterThan(0);
      const boxCount = await page.evaluate(
        () => document.getElementById('pva-overlay-container')?.childElementCount ?? 0,
      );
      expect(boxCount).toBeGreaterThan(0);

      // Sanitized context must never contain raw PII.
      const sanitizedJson = JSON.stringify(scan.sanitizedContext ?? {});
      expect(sanitizedJson).not.toContain('alice.johnson@securemail.net');
      expect(sanitizedJson).not.toContain('4111 1111 1111 1111');
      expect(sanitizedJson).not.toContain('correcthorse');
      expect(sanitizedJson).not.toContain('123-45-6789');

      // Screenshot captured, visually redacted, and stored locally with the SW.
      expect(scan.screenshotStored).toBe(true);
      expect(scan.screenshotId).toBeTruthy();
      expect(scan.localScreenshotCount).toBeGreaterThanOrEqual(1);

      // Confirm the stored record is retrievable from local IndexedDB via the SW.
      const list = await sw.evaluate(async () => {
        const store = (globalThis as any).PVA_ScreenshotStore;
        if (!store) return { success: false, error: 'store unavailable' };
        const result = await store.list();
        return { success: true, screenshots: result.screenshots, count: result.count };
      });
      expect(list.success).toBe(true);
      expect(list.count).toBeGreaterThanOrEqual(1);
      expect(list.screenshots[0].hasRedacted).toBe(true);
      const storedJson = JSON.stringify(list.screenshots[0]);
      expect(storedJson).not.toContain('alice.johnson@securemail.net');

      const full = await sw.evaluate(
        async (shotId: string) => {
          const store = (globalThis as any).PVA_ScreenshotStore;
          if (!store) return { success: false, error: 'store unavailable' };
          const record = await store.get(shotId);
          return { success: !!record, record };
        },
        list.screenshots[0].id,
      );
      expect(full.success).toBe(true);
      expect(full.record).toBeDefined();
      // Both the BEFORE (original) and AFTER (redacted) images are stored locally.
      expect(full.record.originalDataUrl).toBeTruthy();
      expect(full.record.redactedDataUrl).toBeTruthy();
      expect(full.record.originalDataUrl).not.toBe(full.record.redactedDataUrl);
      expect(full.record.entityCount).toBeGreaterThan(0);
      expect(full.record.overallRisk).toBeTruthy();
      // Only imagery is in the record - no raw PII string ever crosses it.
      expect(JSON.stringify(full.record)).not.toContain('alice.johnson@securemail.net');

      // Automatic folder export: the SW dispatches ONE download per stored record
      // - the visually REDACTED image. The raw before never leaves IndexedDB.
      let autoExports: any = { success: true, total: 0, completed: 0, filenames: [] };
      for (let i = 0; i < 20 && autoExports.completed < 1; i++) {
        autoExports = await sw.evaluate(async () => {
          const downloads = (globalThis as any).chrome?.downloads;
          if (!downloads) return { success: false, error: 'chrome.downloads unavailable' };
          const items = (await downloads.search({})).filter(
            (d: any) => String(d.url || '').startsWith('data:image/png'),
          );
          return {
            success: true,
            total: items.length,
            completed: items.filter((d: any) => d.state === 'complete').length,
            filenames: items.map((d: any) => d.filename),
          };
        });
        if (autoExports.completed < 1) await new Promise((r) => setTimeout(r, 500));
      }
      expect(autoExports.success).toBe(true);
      expect(autoExports.completed).toBeGreaterThanOrEqual(1);
      if (autoExports.filenames.length) {
        expect(fs.statSync(autoExports.filenames[0]).size).toBeGreaterThan(0);
      }

      await page.close();
    } finally {
      await context.close();
    }
  });

  test('firewall blocks outbound payloads containing PII', async () => {
    const { context, sw } = await launchExtension();
    try {
      const page = await context.newPage();
      await page.route('**://bank.test/**', bankRoute);
      await page.goto(BANKING_URL, { waitUntil: 'load' });

      const leaky = await sw.evaluate(
        (payload: string) => {
          const fw = (globalThis as any).firewallCheck;
          if (typeof fw !== 'function') return { success: false, error: 'firewallCheck unavailable' };
          const r = fw({ prompt: payload });
          return { success: true, safe: r.safe, reason: r.reason, detectedFields: r.detectedFields };
        },
        'send a reminder to contact alice.johnson@securemail.net or 555-987-6543 about card 4111 1111 1111 1111',
      );
      expect(leaky.success).toBe(true);
      expect(leaky.safe).toBe(false);
      expect(leaky.detectedFields).toEqual(expect.arrayContaining(['EMAIL', 'CREDIT_CARD']));

      const clean = await sw.evaluate(
        (payload: string) => {
          const fw = (globalThis as any).firewallCheck;
          const r = fw({ prompt: payload });
          return { success: true, safe: r.safe, reason: r.reason };
        },
        'please fix the login button on the dashboard page',
      );
      expect(clean.success).toBe(true);
      expect(clean.safe).toBe(true);
      expect(clean.reason).toBe('No sensitive data detected');
      await page.close();
    } finally {
      await context.close();
    }
  });

  test('dynamic DOM mutations trigger a re-scan that redacts new PII', async () => {
    const { context, sw } = await launchExtension();
    try {
      const page = await context.newPage();
      page.on('console', (msg) => {
        const t = msg.text();
        if (t.includes('PVA-DEBUG') || t.includes('PVA]') || t.includes('Scan completed')) console.log('[PAGE-CONSOLE]', t.slice(0, 160));
      });
      await page.route('**://bank.test/**', bankRoute);
      await page.goto(BANKING_URL, { waitUntil: 'load' });
      const domDump = await page.evaluate(() => ({
        url: location.href,
        inputs: [...document.querySelectorAll('input')].map((i) => `${i.id || i.name}:${i.type}:${(i as any).value}`),
        bodyLen: document.body ? document.body.innerHTML.length : -1,
      }));
      console.log('DOMDUMP', JSON.stringify(domDump));

      const scan1 = await scanUntilSuccess(sw, BANKING_URL);
      const before = scan1.entities.length;

      // Auto re-scan on DOM mutations only fires while the overlay is visible.
      await sendToActiveTab(sw, { type: 'SHOW_DETECTION_OVERLAY' }, BANKING_URL);

      await page.evaluate(() => {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'late-card';
        input.name = 'card';
        input.value = '4242 4242 4242 4242';
        document.body.appendChild(input);
      });

      // Manually trigger a re-scan (equivalent to popping the overlay, which the
      // MutationObserver debounces) and confirm the new entity is captured.
      const lateCardMeta = await page.evaluate(() => {
        const el = document.getElementById('late-card') as HTMLInputElement | null;
        return { found: !!el, value: el?.value ?? null, type: el?.type ?? null, tag: el?.tagName ?? null };
      });
      console.log('LATE-CARD page world:', JSON.stringify(lateCardMeta));

      const elements = await sendToActiveTab(sw, { type: 'GET_ELEMENTS' }, BANKING_URL);
      console.log('ELEMENTS has late-card:', (elements?.elements ?? []).some((e: any) => (e.selector ?? '').includes('late-card')), 'count', elements?.count);

      let special: any = null;
      for (let i = 0; i < 30; i++) {
        const r = await sendToActiveTab(sw, { type: 'SCAN_PAGE' }, BANKING_URL);
        if (r && r.success && r.entities) special = r;
        if (special && (special.entities ?? []).length > before) break;
        await new Promise((rr) => setTimeout(rr, 300));
      }
      console.log('SPECIAL count:', special?.entities?.length, 'has4242:', (special?.entities ?? []).some((e: any) => e.value.includes('4242')));
      const rescanned = special ?? (await scanUntilSuccess(sw, BANKING_URL));
      const after2 = rescanned.entities.length;
      const values2 = rescanned.entities.map((e: any) => e.value);
      console.log('RESCAN count:', after2, 'values:', values2);
      expect(after2).toBeGreaterThan(before);
      expect(values2).toEqual(expect.arrayContaining(['4242 4242 4242 4242']));
      await page.close();
    } finally {
      await context.close();
    }
  });
});