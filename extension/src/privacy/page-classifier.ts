import {
  DOMElementInfo,
  PageType,
} from '../types/index';

interface ClassificationRule {
  type: PageType;
  urlPatterns: RegExp[];
  titlePatterns: RegExp[];
  domSignals: Array<{ selector: string; weight: number }>;
  textKeywords: string[];
  weight: number;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    type: 'banking',
    urlPatterns: [
      /bank/i, /account/i, /transfer/i, /neft/i, /rtgs/i, /imps/i,
      /ifsc/i, /balance/i, /statement/i, /netbank/i, /ibanking/i,
    ],
    titlePatterns: [/bank/i, /account/i, /netbanking/i, /online.?banking/i],
    domSignals: [
      { selector: 'form[action*="transfer"]', weight: 0.9 },
      { selector: '[name*="account"]', weight: 0.7 },
      { selector: '[name*="ifsc"]', weight: 0.95 },
      { selector: '[name*="amount"]', weight: 0.6 },
    ],
    textKeywords: [
      'account balance', 'fund transfer', 'beneficiary',
      'transaction', 'net banking', 'debit', 'credit',
    ],
    weight: 1.0,
  },
  {
    type: 'login',
    urlPatterns: [
      /login/i, /signin/i, /sign-?in/i, /auth/i, /authenticate/i,
      /logon/i, /sso/i, /oauth/i,
    ],
    titlePatterns: [
      /sign.?in/i, /log.?in/i, /login/i, /authenticate/i,
      /welcome.?back/i,
    ],
    domSignals: [
      { selector: 'input[type="password"]', weight: 0.85 },
      { selector: 'form[action*="login"]', weight: 0.9 },
      { selector: 'form[action*="signin"]', weight: 0.9 },
      { selector: '[name*="password"]', weight: 0.85 },
    ],
    textKeywords: [
      'sign in', 'log in', 'login', 'password', 'remember me',
      'forgot password', 'forgot your password', 'credentials',
    ],
    weight: 1.0,
  },
  {
    type: 'registration',
    urlPatterns: [
      /register/i, /signup/i, /sign-?up/i, /create.?account/i,
      /new.?user/i, /join/i,
    ],
    titlePatterns: [
      /register/i, /sign.?up/i, /create.?account/i,
      /new.?account/i, /join/i,
    ],
    domSignals: [
      { selector: 'form[action*="register"]', weight: 0.9 },
      { selector: 'form[action*="signup"]', weight: 0.9 },
      { selector: '[name*="confirm"]', weight: 0.5 },
      { selector: '[name*="password_confirm"]', weight: 0.8 },
    ],
    textKeywords: [
      'create account', 'sign up', 'register', 'confirm password',
      'terms and conditions', 'agree', 'new here',
    ],
    weight: 1.0,
  },
  {
    type: 'payment',
    urlPatterns: [
      /checkout/i, /payment/i, /cart/i, /order/i, /billing/i,
      /pay/i, /razorpay/i, /stripe/i, /payu/i,
    ],
    titlePatterns: [
      /checkout/i, /payment/i, /cart/i, /billing/i, /order/i,
    ],
    domSignals: [
      { selector: '[name*="card"]', weight: 0.85 },
      { selector: '[name*="cvv"]', weight: 0.95 },
      { selector: '[name*="expiry"]', weight: 0.8 },
      { selector: '[name*="upi"]', weight: 0.7 },
    ],
    textKeywords: [
      'checkout', 'payment', 'credit card', 'debit card',
      'cvv', 'billing address', 'pay now', 'place order',
    ],
    weight: 1.0,
  },
  {
    type: 'healthcare',
    urlPatterns: [
      /health/i, /medical/i, /patient/i, /hospital/i, /clinic/i,
      /diagnostic/i, /pharmacy/i, /prescription/i, /doctor/i,
      /telemedicine/i,
    ],
    titlePatterns: [
      /health/i, /medical/i, /patient/i, /hospital/i, /clinic/i,
      /doctor/i, /appointment/i,
    ],
    domSignals: [
      { selector: '[name*="patient"]', weight: 0.9 },
      { selector: '[name*="diagnosis"]', weight: 0.85 },
      { selector: '[name*="prescription"]', weight: 0.8 },
    ],
    textKeywords: [
      'patient', 'medical record', 'prescription', 'diagnosis',
      'health', 'clinic', 'hospital', 'symptoms',
    ],
    weight: 1.0,
  },
  {
    type: 'government',
    urlPatterns: [
      /gov/i, /passport/i, /aadhaar/i, /pan.?card/i,
      /voter.?id/i, /ration/i, /income.?tax/i, /gst/i,
      /digilocker/i, /umang/i, /parivahan/i, /epfo/i,
    ],
    titlePatterns: [
      /passport/i, /aadhaar/i, /pan.?card/i, /voter/i,
      /government/i, /gov\.in/i, /tax/i,
    ],
    domSignals: [
      { selector: '[name*="aadhaar"]', weight: 0.95 },
      { selector: '[name*="pan"]', weight: 0.85 },
      { selector: '[name*="passport"]', weight: 0.9 },
    ],
    textKeywords: [
      'aadhaar', 'pan card', 'passport', 'voter id',
      'government', 'income tax', 'gst', 'identity',
    ],
    weight: 1.0,
  },
  {
    type: 'ecommerce',
    urlPatterns: [
      /shop/i, /store/i, /product/i, /buy/i, /catalog/i,
      /wishlist/i, /amazon/i, /flipkart/i, /myntra/i,
    ],
    titlePatterns: [
      /shop/i, /store/i, /product/i, /buy/i, /deal/i, /offer/i,
    ],
    domSignals: [
      { selector: '[class*="product"]', weight: 0.6 },
      { selector: '[class*="cart"]', weight: 0.7 },
      { selector: '[class*="price"]', weight: 0.5 },
    ],
    textKeywords: [
      'add to cart', 'buy now', 'price', 'product',
      'shop', 'store', 'delivery', 'offer',
    ],
    weight: 0.8,
  },
  {
    type: 'social_media',
    urlPatterns: [
      /facebook/i, /twitter/i, /instagram/i, /linkedin/i,
      /youtube/i, /tiktok/i, /reddit/i, /quora/i,
      /social/i, /feed/i, /timeline/i,
    ],
    titlePatterns: [
      /feed/i, /timeline/i, /social/i, /community/i, /posts/i,
    ],
    domSignals: [
      { selector: '[class*="post"]', weight: 0.6 },
      { selector: '[class*="comment"]', weight: 0.5 },
      { selector: '[class*="story"]', weight: 0.4 },
    ],
    textKeywords: [
      'post', 'share', 'like', 'comment', 'follow',
      'friend', 'timeline', 'feed',
    ],
    weight: 0.7,
  },
  {
    type: 'email',
    urlPatterns: [
      /mail/i, /inbox/i, /compose/i, /outlook/i, /gmail/i,
      /yahoo.?mail/i, /proton/i, /email/i,
    ],
    titlePatterns: [
      /inbox/i, /mail/i, /compose/i, /email/i, /message/i,
    ],
    domSignals: [
      { selector: '[name*="to"]', weight: 0.5 },
      { selector: '[name*="subject"]', weight: 0.4 },
      { selector: '[class*="compose"]', weight: 0.6 },
    ],
    textKeywords: [
      'inbox', 'compose', 'email', 'message', 'reply',
      'forward', 'sent', 'drafts',
    ],
    weight: 0.8,
  },
  {
    type: 'admin_dashboard',
    urlPatterns: [
      /admin/i, /dashboard/i, /panel/i, /console/i,
      /manage/i, /backend/i, /cms/i,
    ],
    titlePatterns: [
      /admin/i, /dashboard/i, /panel/i, /management/i, /console/i,
    ],
    domSignals: [
      { selector: '[class*="sidebar"]', weight: 0.4 },
      { selector: '[class*="admin"]', weight: 0.7 },
      { selector: '[class*="dashboard"]', weight: 0.6 },
    ],
    textKeywords: [
      'dashboard', 'admin', 'settings', 'management',
      'analytics', 'reports', 'users', 'configuration',
    ],
    weight: 0.7,
  },
  {
    type: 'saas_dashboard',
    urlPatterns: [
      /app/i, /workspace/i, /project/i, /team/i,
      /settings/i, /billing/i, /plan/i, /subscription/i,
    ],
    titlePatterns: [
      /dashboard/i, /workspace/i, /project/i, /settings/i,
    ],
    domSignals: [
      { selector: '[class*="sidebar"]', weight: 0.3 },
      { selector: '[class*="workspace"]', weight: 0.5 },
    ],
    textKeywords: [
      'workspace', 'project', 'team', 'billing',
      'subscription', 'plan', 'usage',
    ],
    weight: 0.5,
  },
  {
    type: 'job_portal',
    urlPatterns: [
      /job/i, /career/i, /resume/i, /hiring/i, /apply/i,
      /linkedin.?jobs/i, /indeed/i, /naukri/i,
    ],
    titlePatterns: [
      /job/i, /career/i, /hiring/i, /apply/i, /vacancy/i,
    ],
    domSignals: [
      { selector: '[name*="resume"]', weight: 0.6 },
      { selector: '[name*="experience"]', weight: 0.4 },
      { selector: '[name*="salary"]', weight: 0.5 },
    ],
    textKeywords: [
      'job', 'career', 'apply', 'resume', 'experience',
      'salary', 'hiring', 'vacancy',
    ],
    weight: 0.6,
  },
  {
    type: 'profile',
    urlPatterns: [
      /profile/i, /account/i, /me/i, /user/i, /member/i,
    ],
    titlePatterns: [
      /profile/i, /my.?account/i, /my.?info/i,
    ],
    domSignals: [
      { selector: '[class*="avatar"]', weight: 0.3 },
      { selector: '[name*="bio"]', weight: 0.4 },
    ],
    textKeywords: [
      'profile', 'my account', 'personal information',
      'edit profile', 'about me', 'settings',
    ],
    weight: 0.5,
  },
  {
    type: 'settings',
    urlPatterns: [
      /settings/i, /preferences/i, /config/i, /options/i,
    ],
    titlePatterns: [
      /settings/i, /preferences/i, /configuration/i,
    ],
    domSignals: [
      { selector: '[class*="settings"]', weight: 0.5 },
      { selector: 'input[type="toggle"]', weight: 0.3 },
    ],
    textKeywords: [
      'settings', 'preferences', 'configuration', 'options',
      'privacy', 'notifications', 'account settings',
    ],
    weight: 0.5,
  },
];

function elementMatchesSelector(el: DOMElementInfo, selector: string): boolean {
  const sel = selector.toLowerCase();
  const tag = el.tagName.toLowerCase();
  const cls = (el.className ?? '').toLowerCase();
  const id = (el.id ?? '').toLowerCase();
  const name = (el.name ?? '').toLowerCase();

  if (sel.startsWith('[class*="')) {
    const partial = sel.replace('[class*="', '').replace('"]', '');
    return cls.includes(partial);
  }
  if (sel.startsWith('[name*="')) {
    const partial = sel.replace('[name*="', '').replace('"]', '');
    return name.includes(partial);
  }
  if (sel.startsWith('input[')) {
    if (tag !== 'input') return false;
    const attr = sel.slice(sel.indexOf('[') + 1, sel.indexOf(']'));
    if (attr.startsWith('type="')) {
      const typeVal = attr.replace('type="', '').replace('"', '');
      return (el.inputType ?? el.type ?? '').toLowerCase() === typeVal;
    }
  }
  if (sel.startsWith('form[')) {
    return tag === 'form';
  }
  if (tag === sel) return true;

  return false;
}

export class PageClassifier {
  classifyPage(
    url: string,
    title: string,
    domElements: DOMElementInfo[],
    visibleText: string,
  ): PageType {
    const scores = new Map<PageType, number>();

    for (const rule of CLASSIFICATION_RULES) {
      let score = 0;

      for (const pattern of rule.urlPatterns) {
        if (pattern.test(url)) {
          score += 0.4 * rule.weight;
          break;
        }
      }

      for (const pattern of rule.titlePatterns) {
        if (pattern.test(title)) {
          score += 0.25 * rule.weight;
          break;
        }
      }

      let domMatchCount = 0;
      for (const signal of rule.domSignals) {
        const matched = domElements.some((el) =>
          elementMatchesSelector(el, signal.selector),
        );
        if (matched) {
          domMatchCount++;
          score += signal.weight * 0.15 * rule.weight;
        }
      }

      const textLower = visibleText.toLowerCase();
      let textMatchCount = 0;
      for (const keyword of rule.textKeywords) {
        if (textLower.includes(keyword)) {
          textMatchCount++;
        }
      }
      if (rule.textKeywords.length > 0) {
        const textRatio = textMatchCount / rule.textKeywords.length;
        score += Math.min(textRatio * 3, 1) * 0.2 * rule.weight;
      }

      scores.set(rule.type, (scores.get(rule.type) ?? 0) + score);
    }

    let bestType: PageType = 'unknown';
    let bestScore = 0;

    for (const [type, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    if (bestScore < 0.1) {
      return this.classifyFromFallback(url, title, visibleText);
    }

    if (bestScore > 0.3 && bestType === 'ecommerce') {
      const paymentScore = scores.get('payment') ?? 0;
      if (paymentScore > bestScore * 0.8) {
        return 'payment';
      }
    }

    return bestType;
  }

  private classifyFromFallback(
    url: string,
    title: string,
    visibleText: string,
  ): PageType {
    const combined = `${url} ${title}`.toLowerCase();

    if (/\.gov\.|\.mil\./i.test(combined)) return 'government';
    if (/\.edu\./i.test(combined)) return 'unknown';

    const textLower = visibleText.toLowerCase();
    const passwordFields = visibleText.includes('password');
    const hasEmailField = /\bemail\b/i.test(visibleText);

    if (passwordFields && hasEmailField) return 'login';
    if (passwordFields) return 'login';

    if (/checkout|payment|pay/i.test(combined)) return 'payment';
    if (/bank|account/i.test(combined)) return 'banking';
    if (/health|medical/i.test(combined)) return 'healthcare';

    return 'unknown';
  }
}
