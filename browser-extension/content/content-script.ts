// browser-extension/content/content-script.ts
// Primary Content Script Entrypoint

declare const chrome: any;

import { contentDomPerception } from './dom-perception';
import { contentActionExecutor } from './action-executor';
import { contentScrollingController } from './scrolling-controller';
import { pageStateObserver } from './page-state-observer';

class ContentScriptController {
  constructor() {
    this.initListeners();
    this.observePageStateChanges();
    this.startDisturbanceSweeper();
  }

  private initListeners() {
    // Expose extension presence to host web page
    try {
      const script = document.createElement('script');
      script.textContent = 'window.__INSIGHT_EXTENSION_PRESENT__ = true; window.dispatchEvent(new CustomEvent("INSIGHT_EXTENSION_READY"));';
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch {}

    // Listen for window postMessage from Insight AI web application
    if (typeof window !== 'undefined') {
      window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || typeof event.data !== 'object') return;
        const { type, nonce, payload } = event.data;

        if (type === 'INSIGHT_HANDSHAKE_REQUEST') {
          window.postMessage({ type: 'INSIGHT_HANDSHAKE_RESPONSE', nonce, version: '1.0.0' }, '*');
          return;
        }

        if (
          type === 'INSIGHT_EXECUTE_ACTION' ||
          type === 'INSIGHT_OPEN_TAB' ||
          type === 'INSIGHT_GET_DOM_SNAPSHOT' ||
          type === 'INSIGHT_DISCOVER_TABS' ||
          type === 'INSIGHT_SELECT_TARGET_TAB'
        ) {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage(
              {
                source: 'INSIGHT_WEB_APP',
                type,
                nonce,
                origin: window.location.origin,
                timestamp: Date.now(),
                payload,
              },
              (response: any) => {
                window.postMessage({ type: `${type}_RESPONSE`, nonce, response }, '*');
              }
            );
          }
        }
      });
    }

    if (typeof chrome === 'undefined' || !chrome.runtime) return;

    chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
      this.handleIncomingMessage(message, sendResponse);
      return true; // Async response
    });
  }

  private async handleIncomingMessage(message: any, sendResponse: (res: any) => void) {
    if (!message) {
      sendResponse({ success: false, error: 'Empty Message' });
      return;
    }

    if (message.type === 'EXECUTE_CONTENT_ACTION' && message.payload) {
      const result = await contentActionExecutor.executeAction(message.payload);
      sendResponse(result);
      return;
    }

    if (message.type === 'PERCEIVE_CONTENT_PAGE') {
      const candidate = contentDomPerception.findBestTarget(message.query || '');
      sendResponse({ success: true, candidate, pageState: pageStateObserver.getPageState() });
      return;
    }

    if (message.type === 'SCROLL_CONTENT_PAGE') {
      const scrollRes = contentScrollingController.scroll(message.direction, message.amount);
      sendResponse({ success: scrollRes.success, scrollRes, pageState: pageStateObserver.getPageState() });
      return;
    }

    if (message.type === 'GET_DOM_SNAPSHOT') {
      const snapshot = contentDomPerception.getAccessibilitySnapshot();
      sendResponse({
        success: true,
        snapshot,
        pageState: pageStateObserver.getPageState(),
        elementCount: snapshot.length,
      });
      return;
    }

    if (message.type === 'SWEEP_DISTURBANCES') {
      const count = contentActionExecutor.dismissDisturbances();
      sendResponse({ success: true, count });
      return;
    }

    sendResponse({ success: false, error: 'Unknown Action Type' });
  }

  private startDisturbanceSweeper() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    // Run sweep on initial load
    setTimeout(() => contentActionExecutor.dismissDisturbances(), 500);
    setTimeout(() => contentActionExecutor.dismissDisturbances(), 1500);

    // Continuous background sweep on DOM mutations (debounced)
    let debounceTimer: any = null;
    try {
      const observer = new MutationObserver(() => {
        if (debounceTimer) return;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          contentActionExecutor.dismissDisturbances();
        }, 800);
      });
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    } catch {}
  }

  private observePageStateChanges() {
    if (typeof window === 'undefined') return;

    // Report initial load state
    this.reportStateToBackground();

    // Listen for navigation state changes
    window.addEventListener('popstate', () => this.reportStateToBackground());
  }

  private reportStateToBackground() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
    try {
      const state = pageStateObserver.getPageState();
      chrome.runtime.sendMessage({ type: 'PAGE_STATE_CHANGED', state });
    } catch {}
  }
}

new ContentScriptController();
