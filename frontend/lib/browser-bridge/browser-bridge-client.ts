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

  private async sendBridgeMessage(type: string, payload?: any, timeoutMs: number = 8000): Promise<any> {
    // 1. Direct chrome.runtime.sendMessage if available
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const directRes = await new Promise<any>((resolve) => {
          chrome.runtime.sendMessage({ type, payload }, (res: any) => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(res);
          });
        });
        if (directRes) return directRes;
      } catch {}
    }

    // 2. Window postMessage bridge to content-script
    if (typeof window !== 'undefined') {
      const nonce = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      return new Promise<any>((resolve) => {
        const handler = (evt: MessageEvent) => {
          if (evt.data && evt.data.type === `${type}_RESPONSE` && evt.data.nonce === nonce) {
            window.removeEventListener('message', handler);
            resolve(evt.data.response);
          }
        };
        window.addEventListener('message', handler);
        window.postMessage({ type, payload, nonce }, '*');

        setTimeout(() => {
          window.removeEventListener('message', handler);
          resolve(null);
        }, timeoutMs);
      });
    }

    return null;
  }

  public async discoverTabs(): Promise<Array<{ tabId: number; title: string; url: string; appName: string }>> {
    if (!this.isConnected()) return [];
    const res = await this.sendBridgeMessage('INSIGHT_DISCOVER_TABS', {}, 3000);
    return res?.tabs || res?.payload?.tabs || [];
  }

  public async lockTargetTab(tabId: number, appName: string): Promise<TargetTabLock | null> {
    if (!this.isConnected()) return null;
    const res = await this.sendBridgeMessage('INSIGHT_SELECT_TARGET_TAB', { tabId, appName }, 4000);
    const targetTab = res?.targetTab || res?.payload?.targetTab;
    if (targetTab) {
      browserTabController.setLockedTab(targetTab);
      return targetTab;
    }
    return null;
  }

  public async openTab(url: string, appName?: string): Promise<TargetTabLock | null> {
    if (!this.isConnected()) return null;
    const res = await this.sendBridgeMessage('INSIGHT_OPEN_TAB', { url, appName }, 5000);
    const targetTab = res?.targetTab || res?.payload?.targetTab;
    if (targetTab) {
      browserTabController.setLockedTab(targetTab);
      return targetTab;
    }
    return null;
  }

  public async getDOMSnapshot(): Promise<Record<number, any> | null> {
    if (!this.isConnected()) return null;
    const res = await this.sendBridgeMessage('INSIGHT_GET_DOM_SNAPSHOT', {}, 5000);
    const rawList = res?.snapshot || res?.payload?.snapshot || (Array.isArray(res) ? res : null);
    if (!rawList || !Array.isArray(rawList)) return null;

    const selectorMap: Record<number, any> = {};
    for (const item of rawList) {
      if (typeof item.index === 'number') {
        selectorMap[item.index] = item;
      }
    }
    return Object.keys(selectorMap).length > 0 ? selectorMap : null;
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

    const timeoutMs = payload.timeoutMs || 8000;
    const res = await this.sendBridgeMessage('INSIGHT_EXECUTE_ACTION', payload, timeoutMs);

    if (res && res.evidence && res.evidence.pageState) {
      browserTabController.updateObservedState(res.evidence.pageState);
    }

    if (res && typeof res.success === 'boolean') {
      return res;
    }

    return {
      actionId: payload.actionId,
      lifecycle: res?.lifecycle || 'ACTION_COMPLETED',
      success: res?.success ?? true,
      message: res?.message || `Executed action ${payload.type}`,
      evidence: res?.evidence,
    };
  }

  public async cancelAction(actionId: string): Promise<boolean> {
    await this.sendBridgeMessage('INSIGHT_CANCEL_ACTION', { actionId }, 2000);
    return true;
  }

  private initHandshake() {
    if (typeof window !== 'undefined') {
      this.performHandshake();
    }
  }
}

export const browserBridgeClient = new BrowserBridgeClient();
