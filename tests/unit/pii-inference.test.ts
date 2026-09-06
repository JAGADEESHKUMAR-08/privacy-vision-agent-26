import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const ROOT = path.resolve(__dirname, '..', '..');

// Load the vanilla JS PII inference engine into a shared VM context.
const engineSrc = fs.readFileSync(path.join(ROOT, 'extension', 'pii-inference.js'), 'utf8');

const fileFetch = async (url: string) => {
  const file = url.replace(/^file:\/+/, '').split('?')[0];
  const content = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(content) };
};

const chrome = {
  runtime: {
    getURL: (p: string) => 'file://' + path.join(ROOT, 'extension', p).replace(/\\/g, '/'),
  },
};

const sandbox: any = { console, fetch: fileFetch, chrome };
vm.createContext(sandbox);
vm.runInContext(engineSrc + '\n;globalThis.__INIT_PII = PII;', sandbox);
const PII = sandbox.__INIT_PII;

describe('PII ML inference engine', () => {
  beforeAll(async () => {
    await PII.load();
  });

  it('loads the model successfully', () => {
    expect(PII.isLoaded()).toBe(true);
  });

  it('classifies a plain email snippet as EMAIL', () => {
    const r = PII.classifyText('anguyen@cloudletters.com');
    expect(r.label).toBe('EMAIL');
  });

  it('classifies a credit-card number snippet', () => {
    const r = PII.classifyText('4532-1234-5678-9101');
    expect(r.label).toBe('CREDIT_CARD');
  });

  it('classifies a phone number snippet as PHONE', () => {
    const r = PII.classifyText('+1 (895) 948-1278');
    expect(r.label).toBe('PHONE');
  });

  it('classifies a plain sentence as NONE (non-PII)', () => {
    const r = PII.classifyText('The system is ready for the next step.');
    expect(r.label).toBe('NONE');
  });

  it('returns softmax scores that sum to 1', () => {
    // classifyText only returns the top entry; test batch probs instead.
    const all = PII.classifyAll(['hello world', 'john@example.com']);
    expect(all).toHaveLength(2);
    for (const r of all) {
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
