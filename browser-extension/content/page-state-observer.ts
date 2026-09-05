// browser-extension/content/page-state-observer.ts
// Live Page State Observer executing inside target browser tab

import { ExtensionPageState } from '../shared/message-types';

// ─────────────────────────────────────────────────────────
// SUCCESS INDICATOR PATTERNS
// ─────────────────────────────────────────────────────────

const SUCCESS_PATTERNS = [
  /order\s*(#|number|id)/i,
  /order\s+confirmed/i,
  /order\s+placed/i,
  /payment\s+successful/i,
  /thank\s+you\s+for\s+(your\s+)?purchase/i,
  /thank\s+you\s+for\s+(your\s+)?order/i,
  /confirmation\s+number/i,
  /order\s+has\s+been\s+placed/i,
  /your\s+order\s+is/i,
  /transaction\s+successful/i,
  /payment\s+received/i,
  /successfully\s+placed/i,
  /form\s+submitted\s+successfully/i,
  /your\s+response\s+has\s+been\s+recorded/i, // Google Forms
  /thanks?\s+for\s+(submitting|filling|your\s+response)/i,
];

export class PageStateObserver {
  public getPageState(): ExtensionPageState {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return {
        url: '',
        title: '',
        application: 'Unknown',
        visibleText: '',
        scrollPosition: { top: 0, total: 0 },
        loadingState: 'complete',
        loginState: 'logged_in',
        captchaState: 'clean',
        timestamp: Date.now(),
      };
    }

    const url = window.location.href;
    const title = document.title;
    const application = this.detectAppName(url);
    const visibleText = (document.body ? document.body.innerText || '' : '').slice(0, 1000);
    const scrollPosition = {
      top: window.scrollY || document.documentElement.scrollTop,
      total: document.documentElement.scrollHeight,
    };

    const loadingState = document.readyState === 'complete' ? 'complete' : 'loading';

    // Detect login requirement barrier
    const isLogin = !!document.querySelector('input[type="password"], form[action*="login"], a[href*="login"]');
    const loginState = isLogin && !url.includes('home') ? 'login_required' : 'logged_in';

    // Detect CAPTCHA barrier
    const hasCaptcha = !!document.querySelector('.g-recaptcha, iframe[src*="captcha"], #captcha');
    const captchaState = hasCaptcha ? 'captcha_detected' : 'clean';

    return {
      url,
      title,
      application,
      visibleText,
      scrollPosition,
      loadingState,
      loginState,
      captchaState,
      timestamp: Date.now(),
    };
  }

  /**
   * Scan visible page text for success indicators (order confirmation, form submission, etc.)
   * Returns matched patterns, or empty array if no success indicators found.
   */
  public detectSuccessIndicators(): string[] {
    if (typeof document === 'undefined') return [];

    const visibleText = (document.body?.innerText || '').slice(0, 3000);
    const matches: string[] = [];

    for (const pattern of SUCCESS_PATTERNS) {
      const match = visibleText.match(pattern);
      if (match) {
        matches.push(match[0]);
      }
    }

    return matches;
  }

  /**
   * Detect rate-limiting or anti-bot page indicators.
   */
  public detectRateLimitOrBlock(): string | null {
    if (typeof document === 'undefined') return null;

    const text = (document.body?.innerText || '').toLowerCase().slice(0, 2000);
    const title = document.title.toLowerCase();

    if (text.includes('robot') || text.includes('automated') || title.includes('robot')) {
      return 'Bot detection page detected';
    }
    if (text.includes('too many requests') || text.includes('rate limit')) {
      return 'Rate limit detected';
    }
    if (text.includes('access denied') || title.includes('403') || title.includes('blocked')) {
      return 'Access denied / blocked';
    }

    return null;
  }

  private detectAppName(url: string): string {
    const q = url.toLowerCase();
    if (q.includes('youtube.com')) return 'YouTube';
    if (q.includes('instagram.com')) return 'Instagram';
    if (q.includes('whatsapp.com')) return 'WhatsApp Web';
    if (q.includes('amazon.in') || q.includes('amazon.com')) return 'Amazon';
    if (q.includes('flipkart.com')) return 'Flipkart';
    if (q.includes('docs.google.com/forms')) return 'Google Forms';
    if (q.includes('google.com')) return 'Google';
    if (q.includes('gmail.com')) return 'Gmail';
    if (q.includes('spotify.com')) return 'Spotify';
    if (q.includes('github.com')) return 'GitHub';
    return 'Web';
  }
}

export const pageStateObserver = new PageStateObserver();
