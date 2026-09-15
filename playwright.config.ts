import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
});