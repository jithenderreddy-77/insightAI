// browser-extension/content/action-executor.ts
// Real DOM Action Executor executing inside live target browser tab
//
// Supports: CLICK, TYPE, SCROLL, SELECT, PRESS_KEY, NAVIGATE, GO_BACK,
//           SCROLL_TO_ELEMENT, FILL_FORM
//
// STALE-INDEX GUARD: Before executing any action, re-verify the target element
// exists and is visible in the current DOM. Refuse to act on stale selectors.

import { ExtensionActionPayload, ExtensionActionStatusReport } from '../shared/message-types';
import { contentDomPerception } from './dom-perception';
import { pageStateObserver } from './page-state-observer';
import { contentScrollingController } from './scrolling-controller';

export class ContentActionExecutor {
  /**
   * Execute action on real live DOM target tab element.
   */
  public async executeAction(payload: ExtensionActionPayload): Promise<ExtensionActionStatusReport> {
    const startTime = Date.now();
    const actionId = payload.actionId;

    // Proactively clear disturbance overlays (cookie banners, delivery modals) before any action
    this.dismissDisturbances();

    try {
      // ── GO_BACK ──
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

      // ── NAVIGATE ──
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

      // ── SCROLL (viewport/container) ──
      if (payload.type === 'SCROLL') {
        const direction = payload.value === 'up' ? 'up' : 'down';
        const scrollRes = contentScrollingController.scroll(direction);
        await new Promise((r) => setTimeout(r, 300));
        return {
          actionId,
          lifecycle: 'ACTION_COMPLETED',
          success: scrollRes.success,
          evidence: {
            pageState: pageStateObserver.getPageState(),
            executionTimeMs: Date.now() - startTime,
          },
        };
      }

      // ── SCROLL_TO_ELEMENT ──
      if (payload.type === 'SCROLL_TO_ELEMENT' && payload.targetQuery) {
        const targetEl = this.findLiveElement(payload.targetQuery);
        if (!targetEl) {
          return this.staleIndexFailure(actionId, payload.targetQuery, startTime);
        }
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

      // ── FILL_FORM (batch fill) ──
      if (payload.type === 'FILL_FORM' && payload.value) {
        try {
          const fields: Array<{ selector: string; value: string }> = JSON.parse(payload.value);
          const results: Array<{ selector: string; success: boolean; error?: string }> = [];

          for (const field of fields) {
            const el = this.findLiveElement(field.selector) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
            if (!el) {
              results.push({ selector: field.selector, success: false, error: 'Element not found' });
              continue;
            }

            // Check if already has the desired value (idempotency)
            if ('value' in el && el.value === field.value) {
              results.push({ selector: field.selector, success: true });
              continue;
            }

            el.focus();
            if (el.tagName.toLowerCase() === 'select') {
              (el as HTMLSelectElement).value = field.value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              (el as HTMLInputElement).value = field.value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }

            results.push({ selector: field.selector, success: true });
            await new Promise((r) => setTimeout(r, 100)); // Brief delay between fields
          }

          const allSuccess = results.every(r => r.success);
          return {
            actionId,
            lifecycle: allSuccess ? 'ACTION_COMPLETED' : 'ACTION_FAILED',
            success: allSuccess,
            message: `Filled ${results.filter(r => r.success).length}/${results.length} fields`,
            evidence: {
              pageState: pageStateObserver.getPageState(),
              executionTimeMs: Date.now() - startTime,
            },
          };
        } catch (parseErr: any) {
          return {
            actionId,
            lifecycle: 'ACTION_FAILED',
            success: false,
            error: `FILL_FORM parse error: ${parseErr.message}`,
          };
        }
      }

      // ── Locate real DOM candidate element (for CLICK, TYPE, SELECT) ──
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

      // STALE-INDEX GUARD: verify the resolved element still exists and is visible
      if (targetElem) {
        const rect = targetElem.getBoundingClientRect();
        const isStillVisible = rect.width > 0 && rect.height > 0;
        if (!isStillVisible) {
          return this.staleIndexFailure(actionId, candidate?.selector || payload.targetQuery || '', startTime);
        }
      }

      // ── CLICK ──
      if (payload.type === 'CLICK' && targetElem) {
        // Clear any newly surfaced disturbances
        this.dismissDisturbances();

        // Ensure element is centered in the viewport
        try {
          targetElem.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
        } catch {
          targetElem.scrollIntoView(true);
        }

        // Bypass potential overlay blocking elementFromPoint
        try {
          const rect = targetElem.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const cx = Math.max(0, rect.left + rect.width / 2);
            const cy = Math.max(0, rect.top + rect.height / 2);
            const topEl = document.elementFromPoint(cx, cy) as HTMLElement | null;
            if (topEl && topEl !== targetElem && !targetElem.contains(topEl) && !topEl.contains(targetElem)) {
              if (topEl.matches?.('.modal-backdrop, .a-popover-modal, .a-modal-scroller, [class*="backdrop" i], [class*="overlay" i]')) {
                topEl.style.pointerEvents = 'none';
              }
            }
          }
        } catch {}

        // Complete event sequence: pointerdown -> mousedown -> focus -> pointerup -> mouseup -> click
        const evtInit: MouseEventInit = { bubbles: true, cancelable: true, view: window };
        try { targetElem.dispatchEvent(new PointerEvent('pointerdown', evtInit)); } catch {}
        try { targetElem.dispatchEvent(new MouseEvent('mousedown', evtInit)); } catch {}
        try { targetElem.focus(); } catch {}
        try { targetElem.dispatchEvent(new PointerEvent('pointerup', evtInit)); } catch {}
        try { targetElem.dispatchEvent(new MouseEvent('mouseup', evtInit)); } catch {}
        try { targetElem.click(); } catch {}
        try { targetElem.dispatchEvent(new MouseEvent('click', evtInit)); } catch {}

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

      // ── TYPE ──
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

      // ── SELECT (<select> dropdown) ──
      if (payload.type === 'SELECT' && targetElem) {
        const selectEl = targetElem as HTMLSelectElement;
        if (selectEl.tagName.toLowerCase() === 'select') {
          // Try to match by value first, then by visible text
          const targetValue = (payload.value || '').toLowerCase();
          let matched = false;

          for (const opt of Array.from(selectEl.options)) {
            if (opt.value.toLowerCase() === targetValue || opt.text.toLowerCase() === targetValue) {
              selectEl.value = opt.value;
              selectEl.dispatchEvent(new Event('change', { bubbles: true }));
              matched = true;
              break;
            }
          }

          if (!matched) {
            // Fuzzy match: find closest option text
            for (const opt of Array.from(selectEl.options)) {
              if (opt.text.toLowerCase().includes(targetValue)) {
                selectEl.value = opt.value;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                matched = true;
                break;
              }
            }
          }

          return {
            actionId,
            lifecycle: matched ? 'ACTION_COMPLETED' : 'ACTION_FAILED',
            success: matched,
            message: matched ? `Selected: ${selectEl.value}` : `No matching option for "${payload.value}"`,
            evidence: {
              pageState: pageStateObserver.getPageState(),
              matchedCandidate: candidate || undefined,
              executionTimeMs: Date.now() - startTime,
            },
          };
        }
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

  /**
   * Find a live element by CSS selector. Returns null if not found or not visible.
   */
  private findLiveElement(selector: string): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    try {
      const el = document.querySelector(selector) as HTMLElement;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      return el;
    } catch {
      return null;
    }
  }

  /**
   * Return a standardized stale-index failure report.
   */
  private staleIndexFailure(
    actionId: string,
    selector: string,
    startTime: number
  ): ExtensionActionStatusReport {
    return {
      actionId,
      lifecycle: 'ACTION_FAILED',
      success: false,
      error: `stale_selector: Element "${selector}" no longer exists or is not visible in the current DOM. Re-snapshot required.`,
      evidence: {
        pageState: pageStateObserver.getPageState(),
        executionTimeMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Automatically detect and dismiss disturbances (cookie banners, location popovers, newsletter dialogs, modal backdrops).
   * Returns count of disturbances dismissed.
   */
  public dismissDisturbances(): number {
    if (typeof document === 'undefined') return 0;
    let dismissed = 0;

    // 1. Cookie & Consent banners (Amazon, YouTube, Google, generic CMPs)
    const consentSelectors = [
      '#sp-cc-accept',
      '#sp-cc-accept-button',
      'input[name="acceptCookie"]',
      '[data-action="accept-cookies"]',
      '#onetrust-accept-btn-handler',
      '#didomi-notice-agree-button',
      'button#accept-choices',
      'button[aria-label*="accept all" i]',
      'button[aria-label*="accept cookie" i]',
      'button[aria-label*="agree" i]',
      'button[id*="cookie-accept" i]',
      'button[id*="accept-cookie" i]',
      'button[class*="cookie-accept" i]',
      '.cc-btn.cc-allow',
      'ytd-consent-bump-v2-lightbox button',
    ];

    for (const sel of consentSelectors) {
      try {
        const btn = document.querySelector(sel) as HTMLElement;
        if (btn && btn.offsetParent !== null) {
          btn.click();
          dismissed++;
        }
      } catch {}
    }

    // 2. Location & Delivery Dialogs (Amazon GLUX, toasters)
    const locationSelectors = [
      '#GLUXConfirmClose',
      '.glow-toaster-button-dismiss',
      'input[data-action-type="DISMISS"]',
      'button[name="glowDoneButton"]',
      '.a-popover-header .a-button-close',
      '.a-declarative[data-action="a-popover-close"]',
      '[data-action="a-modal-close"]',
    ];

    for (const sel of locationSelectors) {
      try {
        const btn = document.querySelector(sel) as HTMLElement;
        if (btn && btn.offsetParent !== null) {
          btn.click();
          dismissed++;
        }
      } catch {}
    }

    // 3. Generic modal/popup dismiss buttons
    const modalCloseSelectors = [
      'button[aria-label="Close" i]',
      'button[aria-label="Dismiss" i]',
      '[aria-label="Close dialog" i]',
      'button.a-button-close',
      '[data-dismiss="modal"]',
      '.modal-close-btn',
    ];

    for (const sel of modalCloseSelectors) {
      try {
        const elements = document.querySelectorAll(sel);
        elements.forEach((el) => {
          const btn = el as HTMLElement;
          const inModal = btn.closest('[role="dialog"], [role="alertdialog"], .modal, .a-popover, .a-modal, [class*="popup" i]');
          if (inModal && btn.offsetParent !== null) {
            btn.click();
            dismissed++;
          }
        });
      } catch {}
    }

    // 4. Stale high-z-index backdrops blocking pointer events
    try {
      const backdrops = document.querySelectorAll('.modal-backdrop, .a-popover-modal, .a-modal-scroller');
      backdrops.forEach((bd) => {
        const el = bd as HTMLElement;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const hasDialog = el.querySelector('[role="dialog"], form, input, button');
          if (!hasDialog) {
            el.style.pointerEvents = 'none';
            dismissed++;
          }
        }
      });
    } catch {}

    return dismissed;
  }
}

export const contentActionExecutor = new ContentActionExecutor();
