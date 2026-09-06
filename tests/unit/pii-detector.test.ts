import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PIIDetector, PIIClassifier } from '../../extension/src/privacy/pii-detector';
import {
  createPageContext,
  formField,
  boundingBox,
  luhnCards,
  luhnInvalidCards,
} from '../helpers/fixtures';
import { PageContext, PageType, PIICategory, FormFieldInfo } from '../../extension/src/types/index';

function fields(...f: FormFieldInfo[]): FormFieldInfo[] {
  return f;
}

function normalizePhoneForTest(value: string): string {
  return value.replace(/[\s()+.\-]/g, '');
}

describe('PIIDetector - Email detection', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects a valid plain email address', () => {
    const entities = detector.detect('Contact john.doe@example.org for details.');
    const emails = entities.filter((e) => e.type === 'EMAIL');
    expect(emails.length).toBe(1);
    expect(emails[0].value).toBe('john.doe@example.org');
    expect(emails[0].type).toBe('EMAIL');
  });

  it('detects emails with special characters in the local part', () => {
    const text = 'Reach me at john+newsletter@example.co.uk or jane_doe-1@sub.example.net';
    const entities = detector.detect(text);
    const emails = entities.filter((e) => e.type === 'EMAIL');
    expect(emails.length).toBe(2);
    expect(emails.some((e) => e.value === 'john+newsletter@example.co.uk')).toBe(true);
    expect(emails.some((e) => e.value === 'jane_doe-1@sub.example.net')).toBe(true);
  });

  it('ignores emails from excluded/placeholder domains', () => {
    const entities = detector.detect('email me at foo@example.com or bar@test.com');
    const emails = entities.filter((e) => e.type === 'EMAIL');
    expect(emails.length).toBe(0);
  });

  it('ignores common no-reply / admin sender addresses', () => {
    const entities = detector.detect('sent from noreply@newsletter.io and test@example.org');
    const emails = entities.filter((e) => e.type === 'EMAIL');
    expect(emails.length).toBe(0);
  });

  it('detects multiple distinct emails in one string', () => {
    const text = 'a@a.org, b@b.org, c@c.org';
    const emails = detector.detect(text).filter((e) => e.type === 'EMAIL');
    expect(emails.length).toBe(3);
  });

  it('assigns higher confidence when email field context is present', () => {
    const page = createPageContext({
      pageType: 'login',
      formFields: fields(formField({ type: 'email', name: 'email', placeholder: 'Enter email' })),
    });
    const inCtx = detector.detect('user@example.org', page).filter((e) => e.type === 'EMAIL');
    const plain = detector.detect('user@example.org').filter((e) => e.type === 'EMAIL');
    expect(inCtx[0].confidence).toBeGreaterThanOrEqual(plain[0].confidence);
  });

  it('reduces confidence for emails on trusted infrastructure domains', () => {
    const entities = detector.detect('developer@google.com and contributor@github.com');
    const emails = entities.filter((e) => e.type === 'EMAIL');
    expect(emails.length).toBeGreaterThan(0);
    for (const e of emails) {
      expect(e.confidence).toBeLessThan(0.9);
    }
  });
});

describe('PIIDetector - Phone detection', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects US formatted phone numbers', () => {
    const entities = detector.detect('Call me at 555-123-4567 today.');
    const phones = entities.filter((e) => e.type === 'PHONE');
    expect(phones.length).toBe(1);
    expect(phones[0].value.replace(/\D/g, '')).toBe('5551234567');
  });

  it('detects US numbers with parentheses and country code', () => {
    const entities = detector.detect('Reach: (555) 123-4567 or +1-555-123-4567');
    const phones = entities.filter((e) => e.type === 'PHONE');
    expect(phones.map((p) => p.value.replace(/\D/g, ''))).toContain('5551234567');
  });

  it('detects international numbers with country code', () => {
    const entities = detector.detect('International: +91-9876543210');
    const phones = entities.filter((e) => e.type === 'PHONE');
    expect(phones.length).toBeGreaterThanOrEqual(1);
    expect(phones.some((p) => normalizePhoneForTest(p.value).includes('9876543210'))).toBe(true);
  });

  it('detects 10-digit phone numbers without country code', () => {
    const entities = detector.detect('My number is 9876543210');
    const phones = entities.filter((e) => e.type === 'PHONE');
    expect(phones.length).toBe(1);
  });

  it('detects space-separated international phone', () => {
    const entities = detector.detect('Reach +44 20 7946 0958 for help');
    const phones = entities.filter((e) => e.type === 'PHONE');
    expect(phones.length).toBe(1);
  });

  it('does not flag very short digit sequences as phones', () => {
    const entities = detector.detect('Pin code is 1234567');
    const phones = entities.filter((e) => e.type === 'PHONE');
    expect(phones.length).toBe(0);
  });

  it('deduplicates the same phone matched by multiple patterns', () => {
    const entities = detector.detect('555-123-4567 and again 555-123-4567');
    const phones = entities.filter((e) => e.type === 'PHONE');
    expect(phones.length).toBe(1);
  });

  it('boosts phone confidence in a tel field context', () => {
    const page = createPageContext({
      formFields: fields(formField({ type: 'tel', name: 'phone', placeholder: 'Phone number' })),
    });
    const inCtx = detector.detect('555-123-4567', page).filter((e) => e.type === 'PHONE');
    const plain = detector.detect('555-123-4567').filter((e) => e.type === 'PHONE');
    expect(inCtx[0].confidence).toBeGreaterThanOrEqual(plain[0].confidence);
  });
});

describe('PIIDetector - Credit card detection', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects a valid Visa card', () => {
    const entities = detector.detect(`Card: ${luhnCards.visa}`);
    const cards = entities.filter((e) => e.type === 'CREDIT_CARD');
    expect(cards.length).toBe(1);
    expect(cards[0].value.replace(/\D/g, '')).toBe(luhnCards.visa);
    expect(cards[0].risk).toBe('CRITICAL');
  });

  it('detects Mastercard and Discover cards', () => {
    const entities = detector.detect(`Multi: ${luhnCards.mastercard} ${luhnCards.discover}`);
    const cards = entities.filter((e) => e.type === 'CREDIT_CARD');
    expect(cards.length).toBe(2);
  });

  it('detects formatted credit cards with spaces or dashes', () => {
    const entities = detector.detect('Formatted: 4111 1111 1111 1111 and 4111-1111-1111-1111');
    const cards = entities.filter((e) => e.type === 'CREDIT_CARD');
    expect(cards.length).toBe(1);
  });

  it('does not flag invalid Luhn numbers', () => {
    const entities = detector.detect(`Bad: ${luhnInvalidCards[0]} ${luhnInvalidCards[1]}`);
    const cards = entities.filter((e) => e.type === 'CREDIT_CARD');
    expect(cards.length).toBe(0);
  });

  it('assigns CRITICAL risk to detected cards', () => {
    const entities = detector.detect(`Card: ${luhnCards.visa}`);
    const card = entities.find((e) => e.type === 'CREDIT_CARD');
    expect(card?.risk).toBe('CRITICAL');
  });
});

describe('PIIDetector - Government / SSN / national IDs', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects a US SSN format', () => {
    const entities = detector.detect('SSN: 123-45-6789');
    const gov = entities.filter((e) => e.type === 'GOVERNMENT_ID');
    expect(gov.length).toBe(1);
    expect(gov[0].value).toContain('123-45-6789');
  });

  it('detects SSN without dashes', () => {
    const entities = detector.detect('ID 123456789');
    const gov = entities.filter((e) => e.type === 'GOVERNMENT_ID');
    expect(gov.some((e) => e.value.includes('123456789'))).toBe(true);
  });

  it('detects an Aadhaar-like 12-digit number', () => {
    const entities = detector.detect('Aadhaar: 2345 6789 0123');
    const gov = entities.filter((e) => e.type === 'GOVERNMENT_ID');
    expect(gov.length).toBe(1);
    expect(gov[0].value.replace(/\s/g, '')).toBe('234567890123');
  });

  it('detects a PAN-like identifier', () => {
    const text = 'PAN: ABCDE1234F';
    const entities = detector.detect(text);
    const gov = entities.filter((e) => e.type === 'GOVERNMENT_ID');
    expect(gov.length).toBe(1);
    expect(gov[0].value).toBe('ABCDE1234F');
  });

  it('boosts government ID confidence in a government field context', () => {
    const page = createPageContext({
      formFields: fields(formField({ name: 'ssn', placeholder: 'Social Security Number' })),
    });
    const inCtx = detector.detect('123-45-6789', page).filter((e) => e.type === 'GOVERNMENT_ID');
    const plain = detector.detect('123-45-6789').filter((e) => e.type === 'GOVERNMENT_ID');
    expect(inCtx.length).toBe(1);
    expect(inCtx[0].confidence).toBeGreaterThanOrEqual(plain[0].confidence);
  });
});

describe('PIIDetector - API key detection', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects sk_-prefixed API keys', () => {
    const key = 'sk_live_' + 'a'.repeat(32);
    const entities = detector.detect(`Key: ${key}`);
    const apiKeys = entities.filter((e) => e.type === 'API_KEY');
    expect(apiKeys.length).toBe(1);
    expect(apiKeys[0].risk).toBe('CRITICAL');
  });

  it('detects GitHub personal access tokens', () => {
    const token = 'ghp_' + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ123456';
    const entities = detector.detect(token);
    const apiKeys = entities.filter((e) => e.type === 'API_KEY');
    expect(apiKeys.length).toBe(1);
  });

  it('detects Google AIza API keys', () => {
    const key = 'AIza' + 'a'.repeat(32) + 'bBc';
    const entities = detector.detect(`google key ${key}`);
    const apiKeys = entities.filter((e) => e.type === 'API_KEY');
    expect(apiKeys.length).toBe(1);
  });

  it('detects generic long strings as possible API keys', () => {
    const long = 'ak_' + 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
    const entities = detector.detect(`generic ${long}`);
    const apiKeys = entities.filter((e) => e.type === 'API_KEY');
    expect(apiKeys.length).toBeGreaterThan(0);
  });
});

describe('PIIDetector - Auth token detection', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects JWT tokens', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: '123' })).toString('base64url');
    const jwt = `${header}.${payload}.signature0123456789`;
    const entities = detector.detect(`token ${jwt}`);
    const tokens = entities.filter((e) => e.type === 'AUTH_TOKEN');
    expect(tokens.length).toBe(1);
    expect(tokens[0].risk).toBe('CRITICAL');
  });

  it('detects Bearer tokens', () => {
    const entities = detector.detect('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456');
    const tokens = entities.filter((e) => e.type === 'AUTH_TOKEN');
    expect(tokens.length).toBe(1);
  });

  it('detects session/sid-like tokens', () => {
    const entities = detector.detect('session cookie sid_abcdefghijklmnopqrstuvwxyz123456');
    const tokens = entities.filter((e) => e.type === 'AUTH_TOKEN');
    expect(tokens.length).toBeGreaterThan(0);
  });
});

describe('PIIDetector - Password detection through context', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects a password when a password field context is present', () => {
    const page = createPageContext({
      pageType: 'login',
      formFields: fields(
        formField({ name: 'username', type: 'text' }),
        formField({ name: 'password', type: 'password', isPassword: true }),
      ),
    });
    const entities = detector.detect('s3cr3tP@ss', page);
    const pw = entities.filter((e) => e.type === 'PASSWORD');
    expect(pw.length).toBe(1);
    expect(pw[0].value).toBe('s3cr3tP@ss');
    expect(pw[0].risk).toBe('CRITICAL');
  });

  it('does not treat random text as a password without password field context', () => {
    const entities = detector.detect('s3cr3tP@ss');
    const pw = entities.filter((e) => e.type === 'PASSWORD');
    expect(pw.length).toBe(0);
  });
});

describe('PIIDetector - Bank account detection', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects bank account numbers in a financial context', () => {
    const page = createPageContext({
      pageType: 'banking',
      formFields: fields(formField({ name: 'accountNumber', placeholder: 'Account number' })),
    });
    const entities = detector.detect('account number 1234567890', page);
    const acct = entities.filter((e) => e.type === 'BANK_ACCOUNT');
    expect(acct.length).toBe(1);
    expect(acct[0].value).toContain('1234567890');
  });

  it('detects routing numbers in a financial context', () => {
    const page = createPageContext({
      pageType: 'banking',
      formFields: fields(formField({ name: 'routing', placeholder: 'Routing number' })),
      visibleText: 'routing number account balance',
    });
    const entities = detector.detect('routing number 021000021 please', page);
    const acct = entities.filter((e) => e.type === 'BANK_ACCOUNT');
    expect(acct.length).toBeGreaterThanOrEqual(1);
    expect(acct.some((e) => e.value.includes('021000021'))).toBe(true);
    expect(acct.some((e) => e.value.includes('021000021'))).toBe(true);
  });

  it('does not flag a random number as a bank account without financial context', () => {
    const entities = detector.detect('Reference 1234567890 please');
    const acct = entities.filter((e) => e.type === 'BANK_ACCOUNT');
    expect(acct.length).toBe(0);
  });
});

describe('PIIDetector - Address detection', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects a street address with a zip code', () => {
    const entities = detector.detect('Ship to: 1600 Amphitheatre Pkwy, Mountain View 94043');
    const addr = entities.filter((e) => e.type === 'ADDRESS');
    expect(addr.length).toBe(1);
    expect(addr[0].confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('detects a PO Box address', () => {
    const entities = detector.detect('Delivery: P.O. Box 1234, Springfield');
    const addr = entities.filter((e) => e.type === 'ADDRESS');
    expect(addr.length).toBe(1);
  });

  it('does not flag short strings as addresses', () => {
    const entities = detector.detect('hello world test');
    const addr = entities.filter((e) => e.type === 'ADDRESS');
    expect(addr.length).toBe(0);
  });
});

describe('PIIDetector - Financial data / currency detection', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects currency amounts', () => {
    const entities = detector.detect('$1,250.00');
    const fin = entities.filter((e) => e.type === 'FINANCIAL_DATA');
    expect(fin.length).toBe(1);
  });

  it('detects currency with ISO codes', () => {
    const entities = detector.detect('1,250.00 USD');
    const fin = entities.filter((e) => e.type === 'FINANCIAL_DATA');
    expect(fin.length).toBeGreaterThan(0);
  });

  it('does not flag a bare number without currency context as financial data', () => {
    const entities = detector.detect('Amount 1250');
    const fin = entities.filter((e) => e.type === 'FINANCIAL_DATA');
    expect(fin.length).toBe(0);
  });

  it('flags low-confidence currency amounts at low confidence', () => {
    const entities = detector.detect('$5');
    const fin = entities.find((e) => e.type === 'FINANCIAL_DATA');
    expect(fin).toBeDefined();
    expect(fin!.confidence).toBeLessThan(0.6);
  });
});

describe('PIIDetector - Date of birth detection', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects DOB in MM/DD/YYYY format within DOB field context', () => {
    const page = createPageContext({
      formFields: fields(formField({ name: 'dob', placeholder: 'Date of Birth' })),
    });
    const entities = detector.detect('1990-07-15', page);
    const dob = entities.filter((e) => e.type === 'DATE_OF_BIRTH');
    expect(dob.length).toBe(1);
    expect(dob[0].confidence).toBeGreaterThan(0.4);
  });

  it('detects DOB in DD-MM-YYYY format', () => {
    const page = createPageContext({
      formFields: fields(formField({ name: 'dob', placeholder: 'Date of Birth' })),
    });
    const entities = detector.detect('15-07-1990', page);
    const dob = entities.filter((e) => e.type === 'DATE_OF_BIRTH');
    expect(dob.length).toBe(1);
  });

  it('detects date of birth only when confidence is meaningful', () => {
    const entities = detector.detect('random date 12/31/2020 unrelated text');
    const dob = entities.filter((e) => e.type === 'DATE_OF_BIRTH');
    expect(dob.length).toBe(0);
  });
});

describe('PIIDetector - Username detection', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects a username in a login context', () => {
    const page = createPageContext({
      pageType: 'login',
      formFields: fields(formField({ name: 'username', placeholder: 'Username' })),
    });
    const entities = detector.detect('john_doe', page);
    const users = entities.filter((e) => e.type === 'USERNAME');
    expect(users.length).toBe(1);
  });

  it('rejects values with invalid username characters', () => {
    const page = createPageContext({
      pageType: 'login',
      formFields: fields(formField({ name: 'username' })),
    });
    const entities = detector.detect('john doe!!', page);
    const users = entities.filter((e) => e.type === 'USERNAME');
    expect(users.length).toBe(0);
  });

  it('does not flag single short tokens as usernames', () => {
    const page = createPageContext({
      pageType: 'login',
      formFields: fields(formField({ name: 'username' })),
    });
    const entities = detector.detect('ab', page);
    const users = entities.filter((e) => e.type === 'USERNAME');
    expect(users.length).toBe(0);
  });
});

describe('PIIDetector - Risk level assignment', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('assigns CRITICAL to passwords, API keys, tokens and cards', () => {
    const page = createPageContext({
      pageType: 'login',
      formFields: fields(formField({ name: 'password', isPassword: true })),
    });
    const text = `pw s3cr3tP@ss api sk_live_${'a'.repeat(32)}`;
    const entities = detector.detect(text, page);
    for (const e of entities) {
      if (e.type === 'PASSWORD' || e.type === 'API_KEY') {
        expect(e.risk).toBe('CRITICAL');
      }
    }
  });

  it('assigns HIGH to email and phone', () => {
    const entities = detector.detect('Contact a@b.org or 555-123-4567');
    for (const e of entities) {
      expect(e.risk).toBe('HIGH');
    }
  });

  it('assigns MEDIUM to usernames and DOB', () => {
    const page = createPageContext({
      pageType: 'login',
      formFields: fields(formField({ name: 'username' }), formField({ name: 'dob', placeholder: 'Date of Birth' })),
    });
    const entities = detector.detect('Some text with john_doe and 1990-05-20', page);
    for (const e of entities) {
      if (e.type === 'USERNAME' || e.type === 'DATE_OF_BIRTH') {
        expect(e.risk).toBe('MEDIUM');
      }
    }
  });
});

describe('PIIDetector - Entity deduplication and boundary cases', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('returns an empty array for empty and whitespace input', () => {
    expect(detector.detect('')).toEqual([]);
    expect(detector.detect('   ')).toEqual([]);
    expect(detector.detect(null as unknown as string)).toEqual([]);
    expect(detector.detect(undefined as unknown as string)).toEqual([]);
  });

  it('returns an empty array when no PII is present', () => {
    expect(detector.detect('This is a harmless plain sentence with no data.')).toEqual([]);
  });

  it('generates unique ids for each detected entity', () => {
    const entities = detector.detect('a@a.org b@b.org c@c.org');
    const ids = entities.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('deduplicates the same entity detected multiple times across chunks via scanPage', async () => {
    const page = createPageContext({
      visibleText: 'Call 555-123-4567 for help or call 555-123-4567 anytime',
    });
    const entities = await detector.scanPage(page);
    const phones = entities.filter((e) => e.type === 'PHONE' && e.value.replace(/\D/g, '') === '5551234567');
    expect(phones.length).toBe(1);
  });

  it('respects disabled categories', () => {
    const limited = new PIIDetector({ enabledCategories: ['EMAIL'] });
    const entities = limited.detect('a@a.org 555-123-4567');
    expect(entities.some((e) => e.type === 'EMAIL')).toBe(true);
    expect(entities.some((e) => e.type === 'PHONE')).toBe(false);
  });

  it('can re-enable categories at runtime', () => {
    const limited = new PIIDetector({ enabledCategories: ['EMAIL'] });
    limited.setEnabledCategories(['EMAIL', 'PHONE']);
    const entities = limited.detect('a@a.org 555-123-4567');
    expect(entities.some((e) => e.type === 'EMAIL')).toBe(true);
    expect(entities.some((e) => e.type === 'PHONE')).toBe(true);
  });
});

describe('PIIDetector - Context-aware detection', () => {
  let detector: PIIDetector;

  beforeEach(() => {
    detector = new PIIDetector();
  });

  it('detects a bank account only on a banking page with financial field', () => {
    const page = createPageContext({
      pageType: 'banking',
      formFields: fields(formField({ name: 'accountNumber', placeholder: 'Account number' })),
    });
    const entities = detector.detect('account number 1234567890123456', page);
    expect(entities.some((e) => e.type === 'BANK_ACCOUNT')).toBe(true);
  });

  it('detects PII from page context form field values via scanPage', async () => {
    const page = createPageContext({
      pageType: 'login',
      formFields: fields(
        formField({ name: 'username', value: 'jane_doe', placeholder: 'Username', type: 'text' }),
        formField({ name: 'email', value: 'jane@example.org', type: 'email' }),
        formField({ name: 'password', value: 'hunter2secret', isPassword: true, type: 'password' }),
      ),
    });
    const entities = await detector.scanPage(page);
    const values = entities.map((e) => e.value);
    expect(values).toContain('jane@example.org');
    expect(values).toContain('jane_doe');
  });

  it('stores an entity context snippet from surrounding text', () => {
    const page = createPageContext({
      pageType: 'unknown',
      visibleText: 'Please contact the team at john@example.org for any questions.',
    });
    const entities = detector.detect('john@example.org', page);
    const email = entities.find((e) => e.type === 'EMAIL');
    expect(email?.context).toBeDefined();
    expect(email?.context).toContain('john@example.org');
  });
});

describe('PIIDetector - Classifier integration', () => {
  it('uses the classifier to add entities not caught by regex', async () => {
    const mockClassifier: PIIClassifier = {
      classify: vi.fn().mockResolvedValue('MEDICAL_ID' as PIICategory),
      isAvailable: vi.fn().mockReturnValue(true),
    };
    const detector = new PIIDetector({ classifier: mockClassifier });
    const text = 'Patient record with an unusual disease code XYZ12345';
    const entities = await detector.detectWithClassifier(text);
    expect(mockClassifier.classify).toHaveBeenCalledWith(text);
    expect(entities.some((e) => e.type === 'MEDICAL_ID')).toBe(true);
    expect(entities.find((e) => e.type === 'MEDICAL_ID')?.source).toBe('CLASSIFIER');
  });

  it('does not duplicate an entity already detected by regex', async () => {
    const mockClassifier: PIIClassifier = {
      classify: vi.fn().mockResolvedValue('EMAIL' as PIICategory),
      isAvailable: vi.fn().mockReturnValue(true),
    };
    const detector = new PIIDetector({ classifier: mockClassifier });
    const entities = await detector.detectWithClassifier('a@b.org');
    const emails = entities.filter((e) => e.type === 'EMAIL');
    expect(emails.length).toBe(1);
  });

  it('falls back gracefully when the classifier is unavailable', async () => {
    const mockClassifier: PIIClassifier = {
      classify: vi.fn().mockResolvedValue('PASSWORD' as PIICategory),
      isAvailable: vi.fn().mockReturnValue(false),
    };
    const detector = new PIIDetector({ classifier: mockClassifier });
    const entities = await detector.detectWithClassifier('some plain string here');
    expect(mockClassifier.classify).not.toHaveBeenCalled();
  });

  it('returns regex-only results when no classifier is configured', async () => {
    const detector = new PIIDetector();
    const entities = await detector.detectWithClassifier('a@b.org');
    expect(entities.length).toBe(1);
    expect(entities[0].type).toBe('EMAIL');
  });

  it('supports setting a classifier after construction', async () => {
    const detector = new PIIDetector();
    const mockClassifier: PIIClassifier = {
      classify: vi.fn().mockResolvedValue('GOVERNMENT_ID' as PIICategory),
      isAvailable: vi.fn().mockReturnValue(true),
    };
    detector.setClassifier(mockClassifier);
    const entities = await detector.detectWithClassifier('random government-like string xyz');
    expect(entities.some((e) => e.type === 'GOVERNMENT_ID' && e.source === 'CLASSIFIER')).toBe(true);
  });
});
