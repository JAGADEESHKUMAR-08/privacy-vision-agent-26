import { PageContext, DOMElementInfo, FormFieldInfo, PageType, BoundingBox } from '../types/index';

const INTERACTIVE_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA',
]);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'textbox', 'combobox', 'slider',
]);

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH',
]);

const SENSITIVE_AUTOCOMPLETE_PREFIXES = [
  'cc-', 'email', 'name', 'tel', 'address-line', 'address-city',
  'address-state', 'address-zip', 'address-country', 'postal-code',
  'organization', 'username', 'new-password', 'current-password',
];

const PAGE_TYPE_SIGNALS: Record<PageType, { urlPatterns: RegExp[]; keywords: string[]; formHints: string[] }> = {
  banking: {
    urlPatterns: [/bank/i, /account\/?(?:overview|balance|summary)/i, /wire/i, /transfer/i, /loan/i, /mortgage/i, /invest/i, /wealth/i],
    keywords: ['account balance', 'transfer funds', 'wire transfer', 'routing number', 'iban', 'account number', 'sort code'],
    formHints: ['routing', 'account number', 'iban', 'swift', 'bic'],
  },
  ecommerce: {
    urlPatterns: [/shop/i, /store/i, /cart/i, /checkout/i, /product/i, /buy/i, /purchase/i, /order/i, /catalog/i, /market/i],
    keywords: ['add to cart', 'checkout', 'shipping address', 'billing', 'payment method', 'subtotal', 'total price', 'order summary'],
    formHints: ['card number', 'cvv', 'expiry', 'billing', 'shipping'],
  },
  social_media: {
    urlPatterns: [/feed/i, /timeline/i, /profile/i, /friend/i, /follow/i, /post/i, /message/i, /inbox/i, /story/i, /reel/i],
    keywords: ['friends', 'followers', 'posts', 'stories', 'share', 'like', 'comment', 'direct message', 'chat'],
    formHints: ['bio', 'about me', 'website link'],
  },
  login: {
    urlPatterns: [/login/i, /signin/i, /sign-in/i, /auth/i, /sso/i, /oauth/i, /log-in/i],
    keywords: ['sign in', 'log in', 'forgot password', 'remember me', 'create account', 'or continue with'],
    formHints: ['username', 'password', 'email address'],
  },
  registration: {
    urlPatterns: [/register/i, /signup/i, /sign-up/i, /create.?account/i, /join/i, /new.?user/i],
    keywords: ['create account', 'sign up', 'register', 'confirm password', 'agree to terms', 'accept terms'],
    formHints: ['confirm password', 'agree', 'terms'],
  },
  profile: {
    urlPatterns: [/profile/i, /account\/?(?:settings|edit|info)/i, /my-?account/i, /personal/i, /user\/?.*\/edit/i],
    keywords: ['profile', 'personal information', 'display name', 'avatar', 'bio', 'edit profile', 'update'],
    formHints: ['display name', 'bio', 'avatar', 'photo'],
  },
  healthcare: {
    urlPatterns: [/health/i, /medical/i, /patient/i, /clinic/i, /hospital/i, /diagnos/i, /prescri/i, /pharma/i, /telemed/i],
    keywords: ['patient', 'diagnosis', 'prescription', 'medical record', 'appointment', 'health insurance', 'symptom', 'doctor'],
    formHints: ['medical history', 'allergies', 'medication', 'insurance id', 'diagnosis'],
  },
  government: {
    urlPatterns: [/gov\./i, /\.gov/i, /tax/i, /irs/i, /ssa/i, /benefit/i, /license/i, /permit/i, /census/i, /citizen/i],
    keywords: ['social security', 'tax return', 'benefit', 'citizen', 'government id', 'license number', 'taxpayer'],
    formHints: ['ssn', 'taxpayer id', 'license number', 'passport'],
  },
  job_portal: {
    urlPatterns: [/job/i, /career/i, /hire/i, /recruit/i, /resume/i, /application/i, /linkedin.*job/i, /indeed/i],
    keywords: ['resume', 'job application', 'work experience', 'education', 'skills', 'cover letter', 'salary expectation'],
    formHints: ['resume', 'cover letter', 'experience', 'education', 'salary'],
  },
  admin_dashboard: {
    urlPatterns: [/admin/i, /dashboard/i, /panel/i, /console/i, /manage/i, /cms/i, /backoffice/i],
    keywords: ['dashboard', 'analytics', 'settings', 'users', 'admin', 'manage', 'metrics', 'overview', 'kpi'],
    formHints: ['api key', 'secret', 'token', 'webhook'],
  },
  email: {
    urlPatterns: [/mail/i, /inbox/i, /email/i, /compose/i, /outlook/i, /gmail/i, /yahoo.*mail/i, /webmail/i],
    keywords: ['inbox', 'compose', 'sent', 'draft', 'archive', 'subject', 'from', 'to', 'reply'],
    formHints: ['to', 'subject', 'message body'],
  },
  payment: {
    urlPatterns: [/pay/i, /billing/i, /invoice/i, /payment/i, /checkout/i, /stripe/i, /paypal/i],
    keywords: ['credit card', 'debit card', 'billing address', 'payment', 'charge', 'transaction', 'receipt'],
    formHints: ['card number', 'cvv', 'expiry', 'billing address'],
  },
  settings: {
    urlPatterns: [/settings/i, /preferences/i, /config/i, /options/i, /account/i, /privacy/i, /security/i],
    keywords: ['settings', 'preferences', 'notifications', 'privacy', 'security', 'password change', '2fa', 'two factor'],
    formHints: ['current password', 'new password', 'notification'],
  },
  saas_dashboard: {
    urlPatterns: [/app\.|dashboard\.|console\.|studio\.|app\/(?!product)/i, /workspace/i, /project/i],
    keywords: ['workspace', 'project', 'api', 'usage', 'plan', 'billing', 'team', 'integration', 'webhook'],
    formHints: ['api key', 'project name', 'webhook url'],
  },
  unknown: { urlPatterns: [], keywords: [], formHints: [] },
};

function cssSelector(el: Element): string {
  if (el.id) {
    return '#' + CSS.escape(el.id);
  }
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector = '#' + CSS.escape(current.id);
      parts.unshift(selector);
      break;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current!.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += ':nth-of-type(' + index + ')';
      }
    }
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).slice(0, 2);
      if (classes.length > 0) {
        selector += '.' + classes.map(c => CSS.escape(c)).join('.');
      }
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function getBoundingBox(el: Element): BoundingBox {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.x * 100) / 100,
    y: Math.round(rect.y * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
  };
}

function isElementVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) {
    return el instanceof SVGElement ? (el as SVGElement).ownerDocument !== null : false;
  }
  const style = window.getComputedStyle(el);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
  if (rect.right < 0 || rect.left > window.innerWidth) return false;
  return true;
}

function getElementText(el: Element): string {
  if (el instanceof HTMLInputElement) {
    return el.value || el.placeholder || el.getAttribute('aria-label') || '';
  }
  if (el instanceof HTMLSelectElement) {
    const selected = el.options[el.selectedIndex];
    return selected ? selected.text : '';
  }
  if (el instanceof HTMLTextAreaElement) {
    return el.value || el.placeholder || '';
  }
  if (el instanceof HTMLButtonElement) {
    return el.textContent?.trim() || el.getAttribute('aria-label') || '';
  }
  if (el instanceof HTMLAnchorElement) {
    return el.textContent?.trim() || el.title || el.getAttribute('aria-label') || '';
  }
  return el.textContent?.trim() || '';
}

function resolveLabelForField(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string | undefined {
  if (field.id) {
    const labelEl = document.querySelector('label[for="' + CSS.escape(field.id) + '"]');
    if (labelEl) return labelEl.textContent?.trim() || undefined;
  }
  let parent = field.parentElement;
  for (let depth = 0; depth < 5 && parent; depth++) {
    if (parent.tagName === 'LABEL') {
      return parent.textContent?.trim() || undefined;
    }
    const label = parent.querySelector('label');
    if (label) return label.textContent?.trim() || undefined;
    parent = parent.parentElement;
  }
  if (field.getAttribute('aria-label')) return field.getAttribute('aria-label')!;
  if (field.getAttribute('aria-labelledby')) {
    const labelId = field.getAttribute('aria-labelledby')!;
    const labelEl = document.getElementById(labelId);
    if (labelEl) return labelEl.textContent?.trim() || undefined;
  }
  if ('placeholder' in field && field.placeholder) return field.placeholder;
  const title = field.getAttribute('title');
  if (title) return title;
  return undefined;
}

function detectPageType(url: string, title: string, formHints: string[], bodyText: string): PageType {
  const lowerUrl = url.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const lowerBody = bodyText.slice(0, 5000).toLowerCase();
  const lowerFormHints = formHints.join(' ').toLowerCase();

  let bestType: PageType = 'unknown';
  let bestScore = 0;

  for (const [type, signals] of Object.entries(PAGE_TYPE_SIGNALS) as [PageType, typeof PAGE_TYPE_SIGNALS[PageType]][]) {
    if (type === 'unknown') continue;
    let score = 0;

    for (const pattern of signals.urlPatterns) {
      if (pattern.test(lowerUrl)) score += 3;
      if (pattern.test(lowerTitle)) score += 2;
    }

    for (const keyword of signals.keywords) {
      if (lowerBody.includes(keyword)) score += 1;
      if (lowerTitle.includes(keyword)) score += 1;
    }

    for (const hint of signals.formHints) {
      if (lowerFormHints.includes(hint)) score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  return bestType;
}

export class DOMExtractor {
  private observer: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private changeCallbacks: Array<(mutations: MutationRecord[]) => void> = [];
  private lastExtraction: PageContext | null = null;

  private INTERACTIVE_INPUT_TYPES = new Set([
    'text', 'email', 'tel', 'url', 'search', 'password', 'number',
    'date', 'datetime-local', 'month', 'week', 'time', 'color',
    'file', 'checkbox', 'radio', 'range', 'submit', 'button', 'reset',
  ]);

  private PII_AUTOCOMPLETE_MAP: Record<string, string> = {
    'email': 'EMAIL',
    'name': 'NAME',
    'given-name': 'NAME',
    'family-name': 'NAME',
    'additional-name': 'NAME',
    'honorific-prefix': 'NAME',
    'honorific-suffix': 'NAME',
    'tel': 'PHONE',
    'tel-national': 'PHONE',
    'tel-country-code': 'PHONE',
    'street-address': 'ADDRESS',
    'address-line1': 'ADDRESS',
    'address-line2': 'ADDRESS',
    'address-line3': 'ADDRESS',
    'address-level1': 'ADDRESS',
    'address-level2': 'ADDRESS',
    'address-level3': 'ADDRESS',
    'address-level4': 'ADDRESS',
    'postal-code': 'ADDRESS',
    'country': 'ADDRESS',
    'country-name': 'ADDRESS',
    'cc-name': 'CREDIT_CARD',
    'cc-number': 'CREDIT_CARD',
    'cc-exp': 'CREDIT_CARD',
    'cc-exp-month': 'CREDIT_CARD',
    'cc-exp-year': 'CREDIT_CARD',
    'cc-csc': 'CREDIT_CARD',
    'cc-type': 'CREDIT_CARD',
    'bday': 'DATE_OF_BIRTH',
    'bday-day': 'DATE_OF_BIRTH',
    'bday-month': 'DATE_OF_BIRTH',
    'bday-year': 'DATE_OF_BIRTH',
    'sex': 'GOVERNMENT_ID',
    'organization': 'NAME',
    'organization-title': 'NAME',
    'new-password': 'PASSWORD',
    'current-password': 'PASSWORD',
    'username': 'USERNAME',
  };

  extractPageContext(): PageContext {
    const domElements = this.extractElements();
    const formFields = this.extractFormFields();
    const visibleText = this.getVisibleText();
    const formHints = formFields.map(f => f.placeholder + ' ' + (f.label || '') + ' ' + f.name + ' ' + (f.autocomplete || ''));
    const pageType = detectPageType(window.location.href, document.title, formHints, visibleText);

    return {
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      pageType,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      domElements,
      formFields,
      visibleText,
    };
  }

  extractElements(): DOMElementInfo[] {
    const elements: DOMElementInfo[] = [];
    const allElements = document.querySelectorAll(
      'a, button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="textbox"], [role="combobox"], [role="tab"], [role="menuitem"], [role="slider"], [tabindex]'
    );

    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (el.closest('[hidden]') || el.hasAttribute('hidden')) continue;

      const isVisible = isElementVisible(el);
      const rect = getBoundingBox(el);
      const tag = el.tagName.toLowerCase();

      let isInput = false;
      let isButton = false;
      let isLink = false;
      let type: string | undefined;
      let name: string | undefined;
      let placeholder: string | undefined;
      let value: string | undefined;
      let autocomplete: string | undefined;
      let inputType: string | undefined;

      if (el instanceof HTMLInputElement) {
        isInput = true;
        inputType = el.type;
        type = 'input';
        name = el.name || undefined;
        placeholder = el.placeholder || undefined;
        autocomplete = el.autocomplete || undefined;
        if (['text', 'password', 'email', 'tel', 'url', 'search', 'number'].includes(el.type)) {
          value = el.value || undefined;
        } else if (el.type === 'checkbox' || el.type === 'radio') {
          value = el.checked ? 'true' : 'false';
        }
      } else if (el instanceof HTMLButtonElement) {
        isButton = true;
        type = 'button';
        name = el.name || undefined;
      } else if (el instanceof HTMLSelectElement) {
        isInput = true;
        type = 'select';
        name = el.name || undefined;
        const selected = el.options[el.selectedIndex];
        value = selected ? selected.text : undefined;
      } else if (el instanceof HTMLTextAreaElement) {
        isInput = true;
        type = 'textarea';
        name = el.name || undefined;
        placeholder = el.placeholder || undefined;
        value = el.value || undefined;
      } else if (el instanceof HTMLAnchorElement) {
        isLink = true;
        type = 'anchor';
        value = el.href || undefined;
      } else {
        const role = el.getAttribute('role');
        if (role === 'button' || role === 'menuitem' || role === 'tab' || role === 'switch') {
          isButton = true;
          type = 'role-button';
        } else if (role === 'link') {
          isLink = true;
          type = 'role-link';
        } else if (role === 'textbox' || role === 'combobox') {
          isInput = true;
          type = 'role-input';
          placeholder = el.getAttribute('aria-placeholder') || undefined;
        } else if (role === 'checkbox' || role === 'radio' || role === 'slider') {
          isInput = true;
          type = 'role-' + role;
        }
      }

      const text = getElementText(el);
      const id = el.id || undefined;
      const className = (typeof el.className === 'string' && el.className.trim()) ? el.className.trim() : undefined;

      elements.push({
        tagName: tag,
        text,
        type,
        name,
        placeholder,
        value,
        id,
        className,
        selector: cssSelector(el),
        rect,
        isVisible,
        isInput,
        isButton,
        isLink,
        autocomplete,
        ariaLabel: el.getAttribute('aria-label') || undefined,
        inputType,
      });
    }

    return elements;
  }

  extractFormFields(): FormFieldInfo[] {
    const fields: FormFieldInfo[] = [];
    const inputs = document.querySelectorAll('input, select, textarea');
    const processed = new Set<Element>();

    for (let i = 0; i < inputs.length; i++) {
      const el = inputs[i];
      if (processed.has(el)) continue;
      processed.add(el);

      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement) && !(el instanceof HTMLTextAreaElement)) continue;
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'reset' || el.type === 'image') continue;
      if (el.hasAttribute('hidden') || el.closest('[hidden]')) continue;

      let field: FormFieldInfo;
      if (el instanceof HTMLInputElement) {
        field = {
          selector: cssSelector(el),
          name: el.name || '',
          type: el.type,
          placeholder: el.placeholder || '',
          value: el.type === 'password' ? '' : (el.value || ''),
          label: resolveLabelForField(el),
          autocomplete: el.autocomplete || undefined,
          isPassword: el.type === 'password',
          rect: getBoundingBox(el),
        };
      } else if (el instanceof HTMLSelectElement) {
        const selected = el.options[el.selectedIndex];
        field = {
          selector: cssSelector(el),
          name: el.name || '',
          type: 'select',
          placeholder: '',
          value: selected ? selected.text : '',
          label: resolveLabelForField(el),
          autocomplete: el.autocomplete || undefined,
          isPassword: false,
          rect: getBoundingBox(el),
        };
      } else {
        field = {
          selector: cssSelector(el),
          name: el.name || '',
          type: 'textarea',
          placeholder: el.placeholder || '',
          value: el.value || '',
          label: resolveLabelForField(el),
          autocomplete: el.autocomplete || undefined,
          isPassword: false,
          rect: getBoundingBox(el),
        };
      }
      fields.push(field);
    }

    return fields;
  }

  detectSensitiveFields(): Array<{ field: FormFieldInfo; piiCategory: string; confidence: number }> {
    const formFields = this.extractFormFields();
    const sensitive: Array<{ field: FormFieldInfo; piiCategory: string; confidence: number }> = [];

    for (const field of formFields) {
      const lowerName = field.name.toLowerCase();
      const lowerPlaceholder = field.placeholder.toLowerCase();
      const lowerLabel = (field.label || '').toLowerCase();
      const lowerAutocomplete = (field.autocomplete || '').toLowerCase();
      const combined = lowerName + ' ' + lowerPlaceholder + ' ' + lowerLabel;

      if (field.isPassword || field.type === 'password') {
        sensitive.push({ field, piiCategory: 'PASSWORD', confidence: 0.99 });
        continue;
      }

      if (lowerAutocomplete) {
        for (const [autoVal, category] of Object.entries(this.PII_AUTOCOMPLETE_MAP)) {
          if (lowerAutocomplete === autoVal) {
            sensitive.push({ field, piiCategory: category, confidence: 0.95 });
            break;
          }
        }
        if (sensitive.some(s => s.field.selector === field.selector)) continue;
        for (const prefix of SENSITIVE_AUTOCOMPLETE_PREFIXES) {
          if (lowerAutocomplete.startsWith(prefix)) {
            for (const [autoVal, category] of Object.entries(this.PII_AUTOCOMPLETE_MAP)) {
              if (lowerAutocomplete.startsWith(autoVal)) {
                sensitive.push({ field, piiCategory: category, confidence: 0.90 });
                break;
              }
            }
            break;
          }
        }
        if (sensitive.some(s => s.field.selector === field.selector)) continue;
      }

      if (field.type === 'email' || /\bemail\b/.test(combined) || /\bmail\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'EMAIL', confidence: 0.95 });
        continue;
      }
      if (field.type === 'tel' || /\bphone\b/.test(combined) || /\bmobile\b/.test(combined) || /\btelephone\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'PHONE', confidence: 0.95 });
        continue;
      }
      if (/\bcredit.?card\b/.test(combined) || /\bcard.?number\b/.test(combined) || /\bcc-?\d/.test(combined) || /\bvisa\b/.test(combined) || /\bmastercard\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'CREDIT_CARD', confidence: 0.95 });
        continue;
      }
      if (/\bcvv\b/.test(combined) || /\bcvc\b/.test(combined) || /\bsecurity.?code\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'CREDIT_CARD', confidence: 0.93 });
        continue;
      }
      if (/\bexpir/.test(combined) || /\bexp\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'CREDIT_CARD', confidence: 0.88 });
        continue;
      }
      if (/\bssn\b/.test(combined) || /\bsocial.?security\b/.test(combined) || /\btax.?id\b/.test(combined) || /\btaxpayer\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'GOVERNMENT_ID', confidence: 0.95 });
        continue;
      }
      if (/\bpassport\b/.test(combined) || /\bdriver.?licen[sc]e\b/.test(combined) || /\blicense.?num\b/.test(combined) || /\bid.?num\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'GOVERNMENT_ID', confidence: 0.92 });
        continue;
      }
      if (/\b(first.?name|last.?name|full.?name|your.?name|name.?on)\b/.test(combined) || /\bsurname\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'NAME', confidence: 0.88 });
        continue;
      }
      if (/\baddress\b/.test(combined) || /\bstreet\b/.test(combined) || /\bzip.?code\b/.test(combined) || /\bpostal\b/.test(combined) || /\bcity\b/.test(combined) || /\bstate\b/.test(combined) || /\bcountry\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'ADDRESS', confidence: 0.88 });
        continue;
      }
      if (/\bdob\b/.test(combined) || /\bbirth.?date\b/.test(combined) || /\bbirthday\b/.test(combined) || /\bdate.?of.?birth\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'DATE_OF_BIRTH', confidence: 0.90 });
        continue;
      }
      if (/\bmedical\b/.test(combined) || /\bdiagnosis\b/.test(combined) || /\bprescription\b/.test(combined) || /\bhealth\b/.test(combined) || /\binsurance.?id\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'MEDICAL_ID', confidence: 0.88 });
        continue;
      }
      if (/\bapi.?key\b/.test(combined) || /\bsecret\b/.test(combined) || /\btoken\b/.test(combined) || /\baccess.?key\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'API_KEY', confidence: 0.85 });
        continue;
      }
      if (/\baccount.?num\b/.test(combined) || /\brouting\b/.test(combined) || /\biban\b/.test(combined) || /\bswift\b/.test(combined) || /\bbank\b/.test(combined)) {
        sensitive.push({ field, piiCategory: 'BANK_ACCOUNT', confidence: 0.90 });
        continue;
      }
    }

    return sensitive;
  }

  getVisibleText(): string {
    const textParts: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node: Node): number => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
          if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return NodeFilter.FILTER_REJECT;
          if (el.closest('script, style, noscript, template, svg, math')) return NodeFilter.FILTER_REJECT;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let lastBlockLevel = '';
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text && text.length > 0) {
          textParts.push(text);
        }
        continue;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tag = el.tagName;
        if (tag === 'BR') {
          textParts.push('\n');
          continue;
        }
        if (['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'MAIN', 'ASIDE', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION'].includes(tag)) {
          if (lastBlockLevel) {
            textParts.push('\n');
          }
          lastBlockLevel = tag;
          continue;
        }
        if (tag === 'TD' || tag === 'TH') {
          textParts.push('\t');
          continue;
        }
        const role = el.getAttribute('role');
        if (role === 'button' || role === 'link' || role === 'menuitem') {
          const label = el.getAttribute('aria-label');
          if (label) {
            textParts.push(label);
          }
        }
      }
    }

    const raw = textParts.join(' ');
    const cleaned = raw
      .replace(/(\n\s*){3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^\s+|\s+$/g, '');

    return cleaned;
  }

  observeChanges(callback: (mutations: MutationRecord[]) => void): void {
    this.changeCallbacks.push(callback);

    if (this.observer) return;

    this.observer = new MutationObserver((mutations: MutationRecord[]) => {
      const significant = mutations.some(m => {
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const added = m.addedNodes[i];
            if (added.nodeType === Node.ELEMENT_NODE) {
              const el = added as Element;
              if (INTERACTIVE_TAGS.has(el.tagName) || el.querySelector('input, button, select, textarea, a')) {
                return true;
              }
              if (el.getAttribute('role') && INTERACTIVE_ROLES.has(el.getAttribute('role')!)) {
                return true;
              }
            }
          }
          return m.addedNodes.length > 3;
        }
        if (m.type === 'attributes') {
          const target = m.target as Element;
          if (target instanceof HTMLElement) {
            if (m.attributeName === 'style' || m.attributeName === 'class') {
              const style = window.getComputedStyle(target);
              if (style.display === 'none' || style.visibility === 'hidden') {
                return true;
              }
            }
            if (m.attributeName === 'hidden') return true;
          }
          return m.attributeName === 'value' || m.attributeName === 'content';
        }
        if (m.type === 'characterData') {
          return (m.target.textContent || '').length > 50;
        }
        return false;
      });

      if (!significant) return;

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        for (const cb of this.changeCallbacks) {
          try {
            cb(mutations);
          } catch (e) {
            console.error('[DOMExtractor] Change callback error:', e);
          }
        }
      }, 300);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'value', 'content', 'aria-hidden', 'tabindex'],
      characterData: true,
    });
  }

  disconnect(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.changeCallbacks = [];
  }

  getLastExtraction(): PageContext | null {
    return this.lastExtraction;
  }

  extractAndCache(): PageContext {
    const ctx = this.extractPageContext();
    this.lastExtraction = ctx;
    return ctx;
  }
}
