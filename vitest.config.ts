import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['extension/src/**/*.ts'],
      exclude: ['extension/src/**/*.d.ts', 'extension/src/popup/**', 'extension/src/options/**']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './extension/src'),
      '@privacy': path.resolve(__dirname, './extension/src/privacy'),
      '@perception': path.resolve(__dirname, './extension/src/perception'),
      '@redaction': path.resolve(__dirname, './extension/src/redaction'),
      '@dom': path.resolve(__dirname, './extension/src/dom'),
      '@agent': path.resolve(__dirname, './extension/src/agent'),
      '@utils': path.resolve(__dirname, './extension/src/utils')
    }
  }
});
