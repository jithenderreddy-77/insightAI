// frontend/lib/agent/action-verifier.ts
// Empirical Action Verification Engine

import { AgentAction, ExpectedState, VerificationResult } from './agent-types';
import { uiPerceptionEngine } from '../automation/ui-perception';

export class ActionVerifier {
  /**
   * Empirically verify if an action completed successfully and achieved its expected state.
   */
  public async verify(action: AgentAction, expected?: ExpectedState): Promise<VerificationResult> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { success: true };
    }

    const exp = expected || action.expectedState;
    if (!exp) return { success: true };

    try {
      // 1. Verify URL pattern match
      if (exp.urlPattern) {
        const currentUrl = window.location.href.toLowerCase();
        if (!currentUrl.includes(exp.urlPattern.toLowerCase())) {
          return {
            success: false,
            actualState: currentUrl,
            mismatchReason: `URL "${currentUrl}" did not match expected pattern "${exp.urlPattern}"`,
          };
        }
      }

      // 2. Verify expected text presence
      if (exp.elementText) {
        const candidate = uiPerceptionEngine.findBestCandidate(exp.elementText);
        if (!candidate || candidate.confidence < 0.4) {
          return {
            success: false,
            actualState: 'Text not found',
            mismatchReason: `Expected visible text "${exp.elementText}" was not found on screen`,
          };
        }
      }

      // 3. Verify element selector existence
      if (exp.elementSelector) {
        const el = document.querySelector(exp.elementSelector);
        if (!el) {
          return {
            success: false,
            actualState: 'Selector missing',
            mismatchReason: `Expected element matching selector "${exp.elementSelector}" was missing`,
          };
        }
      }

      // 4. Verify focused input
      if (exp.focusedInput) {
        const active = document.activeElement;
        const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.getAttribute('contenteditable') === 'true');
        if (!isInput) {
          return {
            success: false,
            actualState: active ? active.tagName : 'none',
            mismatchReason: 'Expected input field to be focused',
          };
        }
      }

      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        actualState: 'error',
        mismatchReason: err.message || 'Verification failed with exception',
      };
    }
  }
}

export const actionVerifier = new ActionVerifier();
