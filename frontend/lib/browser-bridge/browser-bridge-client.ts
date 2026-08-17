// frontend/lib/browser-bridge/browser-bridge-client.ts
// Web Application Browser Bridge Client & Protocol Security Manager

declare const chrome: any;

import { BrowserBridgeInterface, TargetTabLock } from './browser-bridge-interface';

import { ExtensionActionPayload, ExtensionActionStatusReport } from './browser-action-types';
import { browserTabController } from './browser-tab-controller';

export class BrowserBridgeClient implements BrowserBridgeInterface {
  private connected: boolean = false;
  private extensionVersion?: string;
  private extensionId?: string;

  constructor() {
    this.initHandshake();
  }

  public isConnected(): boolean {
    if (typeof window !== 'undefined' && (window as any).__INSIGHT_EXTENSION_PRESENT__) {
      return true;
    }
    return this.connected;
  }

  public async performHandshake(): Promise<{ connected: boolean; extensionVersion?: string }> {
    if (typeof window === 'undefined') return { connected: false };

    // 1. Try Chrome extension runtime messaging first if extension ID is present or injected
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const res = await new Promise<any>((resolve) => {
          chrome.runtime.sendMessage({ type: 'INSIGHT_HANDSHAKE_REQUEST' }, (response: any) => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(response);
          });
        });
        if (res && res.connected) {
          this.connected = true;
          this.extensionVersion = res.extensionVersion || '1.0.0';
          (window as any).__INSIGHT_EXTENSION_PRESENT__ = true;
          return { connected: true, extensionVersion: this.extensionVersion };
        }
      } catch {}
    }

    // 2. Window postMessage handshake fallback
    return new Promise((resolve) => {
      const nonce = `handshake_${Date.now()}`;
      const handler = (evt: MessageEvent) => {
        if (evt.data && evt.data.type === 'INSIGHT_HANDSHAKE_RESPONSE') {
          window.removeEventListener('message', handler);
          this.connected = true;
          this.extensionVersion = evt.data.version || '1.0.0';
          (window as any).__INSIGHT_EXTENSION_PRESENT__ = true;
          resolve({ connected: true, extensionVersion: this.extensionVersion });
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'INSIGHT_HANDSHAKE_REQUEST', nonce }, '*');

      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ connected: this.connected, extensionVersion: this.extensionVersion });
      }, 1000);
    });
  }

  public async discoverTabs(): Promise<Array<{ tabId: number; title: string; url: string; appName: string }>> {
    if (!this.isConnected()) return [];
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'INSIGHT_DISCOVER_TABS' }, (res: any) => {
          resolve(res?.tabs || []);
        });
      } else {
        resolve([]);
      }
    });
  }

  public async lockTargetTab(tabId: number, appName: string): Promise<TargetTabLock | null> {
    if (!this.isConnected()) return null;
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'INSIGHT_SELECT_TARGET_TAB', payload: { tabId, appName } }, (res: any) => {
          if (res && res.targetTab) {
            browserTabController.setLockedTab(res.targetTab);
            resolve(res.targetTab);
          } else {
            resolve(null);
          }
        });
      } else {
        resolve(null);
      }
    });
  }

  public getActiveTargetTab(): TargetTabLock | null {
    return browserTabController.getLockedTab();
  }

  public async executeAction(
    payload: ExtensionActionPayload,
    signal?: AbortSignal
  ): Promise<ExtensionActionStatusReport> {
    if (signal?.aborted) {
      return {
        actionId: payload.actionId,
        lifecycle: 'ACTION_CANCELLED',
        success: false,
        error: 'Action cancelled by AbortSignal',
      };
    }

    if (!this.isConnected()) {
      return {
        actionId: payload.actionId,
        lifecycle: 'ACTION_FAILED',
        success: false,
        error: 'Chrome Companion Extension Not Connected',
      };
    }

    return new Promise((resolve) => {
      let timeoutId: NodeJS.Timeout | null = null;

      const abortHandler = () => {
        if (timeoutId) clearTimeout(timeoutId);
        this.cancelAction(payload.actionId);
        resolve({
          actionId: payload.actionId,
          lifecycle: 'ACTION_CANCELLED',
          success: false,
          error: 'Action cancelled by user',
        });
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      timeoutId = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', abortHandler);
        resolve({
          actionId: payload.actionId,
          lifecycle: 'ACTION_TIMEOUT',
          success: false,
          error: `Action execution timed out after ${payload.timeoutMs}ms`,
        });
      }, payload.timeoutMs || 5000);

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'INSIGHT_EXECUTE_ACTION', payload }, (res: any) => {
          if (timeoutId) clearTimeout(timeoutId);
          if (signal) signal.removeEventListener('abort', abortHandler);

          if (res && res.evidence && res.evidence.pageState) {
            browserTabController.updateObservedState(res.evidence.pageState);
          }

          resolve(res || {
            actionId: payload.actionId,
            lifecycle: 'ACTION_FAILED',
            success: false,
            error: 'No Response from Extension',
          });
        });
      } else {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          actionId: payload.actionId,
          lifecycle: 'ACTION_FAILED',
          success: false,
          error: 'Extension messaging unavailable',
        });
      }
    });
  }

  public async cancelAction(actionId: string): Promise<boolean> {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'INSIGHT_CANCEL_ACTION', payload: { actionId } }, () => {
          resolve(true);
        });
      });
    }
    return true;
  }

  private initHandshake() {
    if (typeof window !== 'undefined') {
      this.performHandshake();
    }
  }
}

export const browserBridgeClient = new BrowserBridgeClient();
