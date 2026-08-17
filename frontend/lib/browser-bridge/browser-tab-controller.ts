// frontend/lib/browser-bridge/browser-tab-controller.ts
// TargetTabLock Controller & Tab Recovery Engine (TARGET_MISMATCH)

import { TargetTabLock } from './browser-bridge-interface';
import { ExtensionPageState } from './browser-perception-types';

export class BrowserTabController {
  private activeLock: TargetTabLock | null = null;

  public getLockedTab(): TargetTabLock | null {
    return this.activeLock;
  }

  public setLockedTab(tab: TargetTabLock) {
    this.activeLock = { ...tab, lockedForCurrentTask: true, lastInteractionTimestamp: Date.now() };
  }

  public updateObservedState(state: ExtensionPageState) {
    if (this.activeLock) {
      this.activeLock.lastObservedState = state;
      this.activeLock.url = state.url || this.activeLock.url;
      this.activeLock.title = state.title || this.activeLock.title;
      this.activeLock.lastInteractionTimestamp = Date.now();
    }
  }

  /**
   * Check for TARGET_MISMATCH (e.g. expected Instagram tab, but user manually switched to YouTube).
   */
  public verifyTargetMatch(currentObservedApp?: string): { isMatch: boolean; expectedApp?: string; actualApp?: string } {
    if (!this.activeLock) return { isMatch: true };

    const expected = this.activeLock.application.toLowerCase();
    const actual = (currentObservedApp || '').toLowerCase();

    if (actual && !actual.includes(expected) && !expected.includes(actual)) {
      return {
        isMatch: false,
        expectedApp: this.activeLock.application,
        actualApp: currentObservedApp,
      };
    }

    return { isMatch: true };
  }

  public clearLock() {
    this.activeLock = null;
  }
}

export const browserTabController = new BrowserTabController();
