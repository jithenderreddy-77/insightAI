// frontend/lib/automation/navigation-engine.ts
// Universal Back & Navigation Engine

import { uiPerceptionEngine } from './ui-perception';

export class NavigationEngine {
  /**
   * Execute "go back" / "return" navigation.
   */
  public goBack(): { success: boolean; method: string } {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { success: false, method: 'none' };
    }

    // 1. Try finding visible "Back", "Return", or "Close" UI elements first
    const backCandidate = uiPerceptionEngine.findBestCandidate('back') || uiPerceptionEngine.findBestCandidate('return');
    if (backCandidate && backCandidate.confidence > 0.6) {
      try {
        (backCandidate.element as HTMLElement).click();
        return { success: true, method: 'ui_button' };
      } catch {}
    }

    // 2. Try window.history.back()
    try {
      if (window.history.length > 1) {
        window.history.back();
        return { success: true, method: 'browser_history' };
      }
    } catch {}

    return { success: false, method: 'none' };
  }
}

export const navigationEngine = new NavigationEngine();
