import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'path';

export const EXT_PATH = path.resolve(__dirname, '../../extension');

let dirCounter = 0;

export function profileDir(): string {
  dirCounter += 1;
  return path.join(process.env.TEMP || '.', 'opencode-pva-e2e', `profile-${Date.now()}-${dirCounter}`);
}

export async function launchExtension(): Promise<{ context: BrowserContext; sw: Worker; extId: string }> {
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

export async function sendToActiveTab(sw: Worker, message: Record<string, unknown>, url: string): Promise<any> {
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

export async function scanUntilSuccess(sw: Worker, pageUrl: string, tries = 20): Promise<any> {
  let last: any = null;
  for (let i = 0; i < tries; i++) {
    const resp = await sendToActiveTab(sw, { type: 'SCAN_PAGE' }, pageUrl);
    if (resp && resp.success && resp.entities) return resp;
    last = resp;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('scan never succeeded: ' + JSON.stringify(last));
}

export async function openPage(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  return page;
}