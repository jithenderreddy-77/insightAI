// browser-extension/background/service-worker.ts
// Manifest V3 Background Service Worker & TargetTabLock Registry

declare const chrome: any;

import { BridgeMessageEnvelope, ExtensionActionPayload } from '../shared/message-types';
import { ProtocolSecurity } from '../shared/protocol';

interface LockedTargetTab {
  tabId: number;
  windowId: number;
  url: string;
  application: string;
  lockedAt: number;
}

class ExtensionServiceWorker {
  private activeTargetTab: LockedTargetTab | null = null;
  private activeActions: Map<string, AbortController> = new Map();

  constructor() {
    this.initListeners();
  }

  private initListeners() {
    // Listen for external messages from web application (externally_connectable)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessageExternal) {
      chrome.runtime.onMessageExternal.addListener((message: any, sender: any, sendResponse: any) => {
        this.handleWebMessage(message, sender, sendResponse);
        return true; // Async response
      });
    }

    // Listen for internal messages from content scripts
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
        this.handleContentScriptMessage(message, sender, sendResponse);
        return true;
      });
    }
  }

  private async handleWebMessage(
    envelope: BridgeMessageEnvelope,
    sender: any,
    sendResponse: (res: any) => void
  ) {
    if (!ProtocolSecurity.isValidOrigin(envelope.origin)) {
      sendResponse({ success: false, error: 'Unauthorized Origin' });
      return;
    }

    if (ProtocolSecurity.isExpiredTimestamp(envelope.timestamp)) {
      sendResponse({ success: false, error: 'Message Expired' });
      return;
    }

    switch (envelope.type) {
      case 'INSIGHT_HANDSHAKE_REQUEST':
        sendResponse(
          ProtocolSecurity.createEnvelope(
            'INSIGHT_EXTENSION_SERVICE_WORKER',
            'INSIGHT_HANDSHAKE_RESPONSE',
            { connected: true, extensionVersion: '1.0.0' }
          )
        );
        break;

      case 'INSIGHT_DISCOVER_TABS':
        const tabs = await this.discoverTabs();
        sendResponse(
          ProtocolSecurity.createEnvelope(
            'INSIGHT_EXTENSION_SERVICE_WORKER',
            'INSIGHT_ACTION_STATUS',
            { tabs }
          )
        );
        break;

      case 'INSIGHT_SELECT_TARGET_TAB':
        const selected = await this.lockTargetTab(envelope.payload.tabId, envelope.payload.appName);
        sendResponse(
          ProtocolSecurity.createEnvelope(
            'INSIGHT_EXTENSION_SERVICE_WORKER',
            'INSIGHT_ACTION_STATUS',
            { success: !!selected, targetTab: selected }
          )
        );
        break;

      case 'INSIGHT_EXECUTE_ACTION':
        const actionResult = await this.relayActionToTargetTab(envelope.payload);
        sendResponse(actionResult);
        break;

      case 'INSIGHT_OPEN_TAB':
        const openedTab = await this.openAndLockTab(envelope.payload.url, envelope.payload.appName);
        sendResponse(
          ProtocolSecurity.createEnvelope(
            'INSIGHT_EXTENSION_SERVICE_WORKER',
            'INSIGHT_ACTION_STATUS',
            { success: !!openedTab, targetTab: openedTab }
          )
        );
        break;

      case 'INSIGHT_GET_DOM_SNAPSHOT':
        const snapshotResult = await this.getSnapshotFromTargetTab();
        sendResponse(
          ProtocolSecurity.createEnvelope(
            'INSIGHT_EXTENSION_SERVICE_WORKER',
            'INSIGHT_ACTION_STATUS',
            snapshotResult
          )
        );
        break;

      case 'INSIGHT_CANCEL_ACTION':
        const cancelResult = await this.cancelActiveAction(envelope.payload.actionId);
        sendResponse(cancelResult);
        break;

      default:
        sendResponse({ success: false, error: 'Unknown Message Type' });
    }
  }

  private async handleContentScriptMessage(message: any, sender: any, sendResponse: (res: any) => void) {
    if (message.type === 'PAGE_STATE_CHANGED' && sender.tab) {
      if (this.activeTargetTab && this.activeTargetTab.tabId === sender.tab.id) {
        this.activeTargetTab.url = sender.tab.url || this.activeTargetTab.url;
      }
    }
    sendResponse({ received: true });
  }

  private async discoverTabs(): Promise<Array<{ tabId: number; title: string; url: string; appName: string }>> {
    if (typeof chrome === 'undefined' || !chrome.tabs) return [];
    return new Promise((resolve) => {
      chrome.tabs.query({}, (tabs: any[]) => {
        const results = (tabs || []).map((t: any) => ({
          tabId: t.id || 0,
          title: t.title || '',
          url: t.url || '',
          appName: this.detectAppNameFromUrl(t.url || ''),
        }));
        resolve(results);
      });
    });
  }

  private async lockTargetTab(tabId: number, appName: string): Promise<LockedTargetTab | null> {
    if (typeof chrome === 'undefined' || !chrome.tabs) return null;
    return new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab: any) => {
        if (!tab) {
          resolve(null);
          return;
        }
        this.activeTargetTab = {
          tabId: tab.id || tabId,
          windowId: tab.windowId,
          url: tab.url || '',
          application: appName || this.detectAppNameFromUrl(tab.url || ''),
          lockedAt: Date.now(),
        };
        // Activate target tab in browser
        chrome.tabs.update(tabId, { active: true });
        resolve(this.activeTargetTab);
      });
    });
  }

  private async autoLockActiveTab(): Promise<LockedTargetTab | null> {
    if (typeof chrome === 'undefined' || !chrome.tabs) return null;
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs: any[]) => {
        const target = (tabs && tabs[0]) || null;
        if (target && target.id) {
          this.activeTargetTab = {
            tabId: target.id,
            windowId: target.windowId,
            url: target.url || '',
            application: this.detectAppNameFromUrl(target.url || ''),
            lockedAt: Date.now(),
          };
          resolve(this.activeTargetTab);
        } else {
          resolve(null);
        }
      });
    });
  }

  private async getSnapshotFromTargetTab(): Promise<any> {
    if (!this.activeTargetTab) {
      await this.autoLockActiveTab();
    }
    if (!this.activeTargetTab || typeof chrome === 'undefined' || !chrome.tabs) {
      return { success: false, error: 'No Target Tab Locked' };
    }

    const tabId = this.activeTargetTab.tabId;
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'GET_DOM_SNAPSHOT' }, (response: any) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { success: false, error: 'No Response from Content Script' });
      });
    });
  }

  private async relayActionToTargetTab(payload: ExtensionActionPayload): Promise<any> {
    if (!this.activeTargetTab) {
      await this.autoLockActiveTab();
    }
    if (!this.activeTargetTab || typeof chrome === 'undefined' || !chrome.tabs) {
      return { success: false, error: 'No Target Tab Locked' };
    }

    const tabId = this.activeTargetTab.tabId;

    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_CONTENT_ACTION', payload }, (response: any) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { success: false, error: 'No Response from Content Script' });
      });
    });
  }

  private async cancelActiveAction(actionId: string): Promise<any> {
    if (!this.activeTargetTab || typeof chrome === 'undefined' || !chrome.tabs) {
      return { success: true };
    }
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(this.activeTargetTab!.tabId, { type: 'CANCEL_CONTENT_ACTION', actionId }, (res: any) => {
        resolve(res || { success: true });
      });
    });
  }

  private async openAndLockTab(url: string, appName?: string): Promise<LockedTargetTab | null> {
    if (typeof chrome === 'undefined' || !chrome.tabs) return null;
    return new Promise((resolve) => {
      chrome.tabs.query({}, (tabs: any[]) => {
        let matchingTab: any = null;
        try {
          const targetHost = new URL(url).hostname.replace(/^www\./, '');
          matchingTab = (tabs || []).find((t: any) => {
            try {
              const tabHost = new URL(t.url || '').hostname.replace(/^www\./, '');
              return tabHost && targetHost && (tabHost === targetHost || tabHost.endsWith('.' + targetHost) || targetHost.endsWith('.' + tabHost));
            } catch {
              return false;
            }
          });
        } catch {}

        if (matchingTab && matchingTab.id) {
          chrome.tabs.update(matchingTab.id, { url, active: true }, (tab: any) => {
            this.activeTargetTab = {
              tabId: matchingTab.id,
              windowId: matchingTab.windowId,
              url: url,
              application: appName || this.detectAppNameFromUrl(url),
              lockedAt: Date.now(),
            };
            resolve(this.activeTargetTab);
          });
        } else {
          chrome.tabs.create({ url, active: true }, (newTab: any) => {
            if (!newTab || !newTab.id) {
              resolve(null);
              return;
            }
            this.activeTargetTab = {
              tabId: newTab.id,
              windowId: newTab.windowId,
              url: url,
              application: appName || this.detectAppNameFromUrl(url),
              lockedAt: Date.now(),
            };
            resolve(this.activeTargetTab);
          });
        }
      });
    });
  }

  private detectAppNameFromUrl(url: string): string {
    const q = url.toLowerCase();
    if (q.includes('amazon.')) return 'Amazon';
    if (q.includes('flipkart.com')) return 'Flipkart';
    if (q.includes('youtube.com')) return 'YouTube';
    if (q.includes('google.com')) return 'Google';
    if (q.includes('instagram.com')) return 'Instagram';
    if (q.includes('whatsapp.com')) return 'WhatsApp Web';
    return 'Web';
  }
}

new ExtensionServiceWorker();
