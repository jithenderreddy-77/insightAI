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
  }

  private initListeners() {
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

    sendResponse({ success: false, error: 'Unknown Action Type' });
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
