// frontend/lib/browser-bridge/browser-bridge-interface.ts
// Browser Bridge Interface Specification

import { ExtensionActionPayload, ExtensionActionStatusReport } from './browser-action-types';
import { ExtensionPageState } from './browser-perception-types';

export interface TargetTabLock {
  tabId: number;
  windowId: number;
  url: string;
  application: string;
  title: string;
  lastObservedState?: ExtensionPageState;
  lastInteractionTimestamp: number;
  lockedForCurrentTask: boolean;
}

export interface BrowserBridgeInterface {
  isConnected(): boolean;
  performHandshake(): Promise<{ connected: boolean; extensionVersion?: string }>;
  discoverTabs(): Promise<Array<{ tabId: number; title: string; url: string; appName: string }>>;
  lockTargetTab(tabId: number, appName: string): Promise<TargetTabLock | null>;
  getActiveTargetTab(): TargetTabLock | null;
  executeAction(payload: ExtensionActionPayload, signal?: AbortSignal): Promise<ExtensionActionStatusReport>;
  cancelAction(actionId: string): Promise<boolean>;
}
