// browser-extension/content/page-state-observer.ts
// Live Page State Observer executing inside target browser tab

import { ExtensionPageState } from '../shared/message-types';

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

  private detectAppName(url: string): string {
    const q = url.toLowerCase();
    if (q.includes('youtube.com')) return 'YouTube';
    if (q.includes('instagram.com')) return 'Instagram';
    if (q.includes('whatsapp.com')) return 'WhatsApp Web';
    return 'Web';
  }
}

export const pageStateObserver = new PageStateObserver();
