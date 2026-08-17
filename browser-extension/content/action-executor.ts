// browser-extension/content/action-executor.ts
// Real DOM Action Executor executing inside live target browser tab

import { ExtensionActionPayload, ExtensionActionStatusReport } from '../shared/message-types';
import { contentDomPerception } from './dom-perception';
import { pageStateObserver } from './page-state-observer';

export class ContentActionExecutor {
  /**
   * Execute action on real live DOM target tab element.
   */
  public async executeAction(payload: ExtensionActionPayload): Promise<ExtensionActionStatusReport> {
    const startTime = Date.now();
    const actionId = payload.actionId;

    try {
      if (payload.type === 'GO_BACK') {
        if (typeof window !== 'undefined') window.history.back();
        await new Promise((r) => setTimeout(r, 500));
        return {
          actionId,
          lifecycle: 'ACTION_COMPLETED',
          success: true,
          evidence: {
            pageState: pageStateObserver.getPageState(),
            executionTimeMs: Date.now() - startTime,
          },
        };
      }

      if (payload.type === 'NAVIGATE' && payload.targetQuery) {
        if (typeof window !== 'undefined') window.location.href = payload.targetQuery;
        await new Promise((r) => setTimeout(r, 600));
        return {
          actionId,
          lifecycle: 'ACTION_COMPLETED',
          success: true,
          evidence: {
            pageState: pageStateObserver.getPageState(),
            executionTimeMs: Date.now() - startTime,
          },
        };
      }

      // Locate real DOM candidate element
      const candidate = contentDomPerception.findBestTarget(payload.targetQuery || payload.value || '');
      if (!candidate && payload.type !== 'SCROLL') {
        return {
          actionId,
          lifecycle: 'ACTION_FAILED',
          success: false,
          error: `Target "${payload.targetQuery}" not found on active page`,
          evidence: { pageState: pageStateObserver.getPageState() },
        };
      }

      const targetElem = candidate ? (document.querySelector(candidate.selector) as HTMLElement) : null;

      if (payload.type === 'CLICK' && targetElem) {
        targetElem.focus();
        targetElem.click();
        await new Promise((r) => setTimeout(r, 400));
        return {
          actionId,
          lifecycle: 'ACTION_COMPLETED',
          success: true,
          evidence: {
            pageState: pageStateObserver.getPageState(),
            matchedCandidate: candidate || undefined,
            executionTimeMs: Date.now() - startTime,
          },
        };
      }

      if (payload.type === 'TYPE' && targetElem) {
        const inputEl = targetElem as HTMLInputElement;
        inputEl.focus();
        inputEl.value = payload.value || '';
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        await new Promise((r) => setTimeout(r, 500));
        return {
          actionId,
          lifecycle: 'ACTION_COMPLETED',
          success: true,
          evidence: {
            pageState: pageStateObserver.getPageState(),
            matchedCandidate: candidate || undefined,
            executionTimeMs: Date.now() - startTime,
          },
        };
      }

      return {
        actionId,
        lifecycle: 'ACTION_COMPLETED',
        success: true,
        evidence: {
          pageState: pageStateObserver.getPageState(),
          executionTimeMs: Date.now() - startTime,
        },
      };
    } catch (err: any) {
      return {
        actionId,
        lifecycle: 'ACTION_FAILED',
        success: false,
        error: err.message || 'Execution error in target tab',
      };
    }
  }
}

export const contentActionExecutor = new ContentActionExecutor();
