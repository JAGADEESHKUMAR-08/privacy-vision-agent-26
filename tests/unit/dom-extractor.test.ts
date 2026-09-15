// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DOMExtractor } from '../../extension/src/dom/dom-extractor';

describe('DOMExtractor', () => {
  let extractor: DOMExtractor;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = '';
    extractor = new DOMExtractor();
  });

  it('extracts page context with URL, title and viewport', () => {
    document.title = 'Online Banking';
    const ctx = extractor.extractPageContext();
    expect(ctx.url).toBe(window.location.href);
    expect(ctx.title).toBe('Online Banking');
    expect(ctx.viewportWidth).toBe(window.innerWidth);
    expect(ctx.viewportHeight).toBe(window.innerHeight);
  });

  it('detects a banking page type from URL/form hints', () => {
    Object.defineProperty(window, 'location', {
      value: { href: 'https://secure.bank.example.com/account/overview' },
      writable: true,
      configurable: true,
    });
    document.title = 'Account Overview';
    document.body.innerHTML = `
      <form>
        <label for="acct">Account Number</label>
        <input id="acct" name="account_number" autocomplete="cc-number" type="text" value="1234567890">
        <input name="routing" type="text" placeholder="Routing number" value="021000021">
      </form>
    `;
    const ctx = extractor.extractPageContext();
    expect(ctx.pageType).toBe('banking');
  });

  it('extracts interactive elements and skips hidden/script/embed', () => {
    document.body.innerHTML = `
      <input id="uname" type="text" value="jsmith" autocomplete="username">
      <button id="submit">Login</button>
      <a id="home" href="/">Home</a>
      <input type="hidden" name="csrf" value="xyz">
      <script>var a = 1;</script>
    `;
    const els = extractor.extractElements();
    const ids = els.map((e) => e.id).filter(Boolean);
    expect(ids).toEqual(expect.arrayContaining(['uname', 'submit', 'home']));
    expect(ids).not.toContain('csrf');
  });

  it('classifies password inputs and email/phone autocomplete as sensitive', () => {
    document.body.innerHTML = `
      <input id="pw" type="password" name="password">
      <input id="em" type="email" name="email" autocomplete="email">
      <input id="ph" type="tel" name="phone">
    `;
    const sensitive = extractor.detectSensitiveFields();
    const byId: Record<string, string> = {};
    for (const s of sensitive) {
      byId[s.field.selector] = s.piiCategory;
    }
    expect(byId['#pw']).toBe('PASSWORD');
    expect(byId['#em']).toBe('EMAIL');
    expect(byId['#ph']).toBe('PHONE');
  });

  it('never leaks password values into field extraction', () => {
    document.body.innerHTML = `<input id="pw" type="password" name="password" value="superSecret123!">`;
    const fields = extractor.extractFormFields();
    expect(fields[0].value).toBe('');
    expect(fields[0].isPassword).toBe(true);
  });

  it('collects visible text but excludes script/style and hidden content', () => {
    document.body.innerHTML = `
      <p>First line</p>
      <div style="display:none">secret hidden text</div>
      <p>Second <b>line</b></p>
    `;
    const text = extractor.getVisibleText();
    expect(text).toContain('First line');
    expect(text).toContain('Second line');
    expect(text).not.toContain('secret hidden text');
  });

  it('detects sensitive fields by DOM features (card number, ssn, cvv)', () => {
    document.body.innerHTML = `
      <input id="card" name="card_number" placeholder="Card Number" value="4242 4242 4242 4242">
      <input id="cvv" name="cvv" placeholder="CVV" value="123">
      <input id="ssn" name="ssn" placeholder="SSN" value="123-45-6789">
    `;
    const sensitive = extractor.detectSensitiveFields();
    const byId: Record<string, string> = {};
    for (const s of sensitive) byId[s.field.selector] = s.piiCategory;
    expect(byId['#card']).toBe('CREDIT_CARD');
    expect(byId['#cvv']).toBe('CREDIT_CARD');
    expect(byId['#ssn']).toBe('GOVERNMENT_ID');
  });

  it('resolves form field labels via label[for] association', () => {
    document.body.innerHTML = `
      <label for="fname">Full Name</label>
      <input id="fname" name="full_name" type="text">
    `;
    const fields = extractor.extractFormFields();
    expect(fields[0].label).toBe('Full Name');
  });

  it('caches the last extraction via extractAndCache', () => {
    document.body.innerHTML = `<p>hi</p>`;
    const ctx = extractor.extractAndCache();
    expect(extractor.getLastExtraction()).toBe(ctx);
  });
});
