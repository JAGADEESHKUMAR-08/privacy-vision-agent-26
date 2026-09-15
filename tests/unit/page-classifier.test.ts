import { describe, it, expect } from 'vitest';
import { PageClassifier } from '../../extension/src/privacy/page-classifier';
import type { DOMElementInfo } from '../../extension/src/types';

function el(partial: Partial<DOMElementInfo>): DOMElementInfo {
  return {
    tagName: 'div',
    text: '',
    selector: '',
    rect: { x: 0, y: 0, width: 0, height: 0 },
    isVisible: true,
    isInput: false,
    isButton: false,
    isLink: false,
    ...partial,
  };
}

describe('PageClassifier', () => {
  const classifier = new PageClassifier();

  it('classifies a login page from URL and password field', () => {
    const type = classifier.classifyPage(
      'https://example.com/login',
      'Sign in to your account',
      [el({ tagName: 'input', isInput: true, inputType: 'password', type: 'password' })],
      'remember me password',
    );
    expect(type).toBe('login');
  });

  it('classifies a banking transfer page', () => {
    const type = classifier.classifyPage(
      'https://netbank.example.com/transfer',
      'Fund Transfer',
      [
        el({ tagName: 'input', isInput: true, name: 'account', type: 'text' }),
        el({ tagName: 'input', isInput: true, name: 'ifsc', type: 'text' }),
        el({ tagName: 'input', isInput: true, name: 'amount', type: 'number' }),
      ],
      'transfer funds to beneficiary',
    );
    expect(type).toBe('banking');
  });

  it('classifies a checkout page', () => {
    const type = classifier.classifyPage(
      'https://shop.example.com/checkout',
      'Checkout',
      [el({ tagName: 'input', isInput: true, name: 'card_number', type: 'text' }), el({ tagName: 'input', isInput: true, name: 'cvv', type: 'text' })],
      'credit card billing address pay now',
    );
    expect(type).toBe('payment');
  });

  it('classifies an ecommerce product page', () => {
    const type = classifier.classifyPage(
      'https://shop.example.com/product/42',
      'Wireless Headphones',
      [el({ tagName: 'div', className: 'product-card' }), el({ tagName: 'div', className: 'price' })],
      'add to cart buy now price product',
    );
    expect(type).toBe('ecommerce');
  });

  it('classifies a healthcare patient portal', () => {
    const type = classifier.classifyPage(
      'https://portal.clinic.example/patient',
      'Patient Portal',
      [el({ tagName: 'input', isInput: true, name: 'diagnosis', type: 'text' })],
      'patient diagnosis appointment record',
    );
    expect(type).toBe('healthcare');
  });

  it('classifies a government tax portal', () => {
    const type = classifier.classifyPage(
      'https://incometax.gov.in/efiling',
      'Income Tax e-filing',
      [el({ tagName: 'input', isInput: true, name: 'pan', type: 'text' })],
      'income tax return pan card',
    );
    expect(type).toBe('government');
  });

  it('classifies a mail compose view', () => {
    const type = classifier.classifyPage(
      'https://mail.example.com/compose',
      'Compose',
      [el({ tagName: 'input', isInput: true, name: 'to', type: 'text' }), el({ tagName: 'input', isInput: true, name: 'subject', type: 'text' })],
      'inbox compose email reply',
    );
    expect(type).toBe('email');
  });

  it('maps a className/name-based DOM signal to a matching element', () => {
    const type = classifier.classifyPage(
      'https://admin.example.com/panel',
      'Admin Panel',
      [el({ tagName: 'div', className: 'admin-sidebar' })],
      'dashboard analytics users settings',
    );
    expect(type).toBe('admin_dashboard');
  });

  it('falls back to unknown for low-signal pages', () => {
    const type = classifier.classifyPage(
      'https://almanac.example.com/message',
      'A Quiet Wall',
      [el({ tagName: 'div' })],
      'nothing here of note',
    );
    expect(type).toBe('unknown');
  });

  it('government wins via fallback for .gov domains', () => {
    const type = classifier.classifyPage(
      'https://forms.irs.gov/efile-home',
      'Welcome',
      [],
      'welcome to the portal',
    );
    expect(type).toBe('government');
  });

  it('payment outranks ecommerce when both signals present', () => {
    const type = classifier.classifyPage(
      'https://shop.example.com/checkout',
      'Secure Checkout',
      [el({ tagName: 'div', className: 'product-card' }), el({ tagName: 'input', isInput: true, name: 'cvv', type: 'text' })],
      'checkout payment method credit card pay now',
    );
    expect(type).toBe('payment');
  });

  it('handles unmatched selector patterns without throwing', () => {
    const type = classifier.classifyPage(
      'https://example.com/',
      '',
      [],
      '',
    );
    expect(['unknown', 'login', 'payment', 'banking', 'healthcare']).toContain(type);
  });
});