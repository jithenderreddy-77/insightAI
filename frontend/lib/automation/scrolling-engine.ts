// frontend/lib/automation/scrolling-engine.ts
// Universal Scrolling Engine (Nested Containers, Feeds, Modals, Virtual Lists, & Scroll-Until-Condition)

import { ScrollContainer } from '../agent/agent-types';
import { uiPerceptionEngine } from './ui-perception';

export type ScrollDirection = 'down' | 'up' | 'top' | 'bottom';

export interface ScrollResult {
  success: boolean;
  containerId: string;
  previousScrollTop: number;
  newScrollTop: number;
  progressMade: boolean;
  reachedEnd: boolean;
}

export class ScrollingEngine {
  /**
   * Detect all scrollable containers in the active viewport.
   */
  public detectScrollableContainers(): ScrollContainer[] {
    if (typeof window === 'undefined' || typeof document === 'undefined') return [];

    const containers: ScrollContainer[] = [
      {
        id: 'window',
        isWindow: true,
        scrollTop: window.scrollY || document.documentElement.scrollTop,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: window.innerHeight,
      },
    ];

    try {
      const elems = Array.from(document.querySelectorAll('*'));
      for (let i = 0; i < elems.length; i++) {
        const el = elems[i];
        const style = window.getComputedStyle(el);
        const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
        if (isScrollable && el.clientHeight > 50) {
          containers.push({
            id: el.id || `scroll_container_${i}`,
            selector: el.id ? `#${CSS.escape(el.id)}` : undefined,
            isWindow: false,
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          });
        }
      }
    } catch {}

    return containers;
  }

  /**
   * Perform scroll action on the most relevant container.
   */
  public scroll(direction: ScrollDirection = 'down', amount?: number): ScrollResult {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { success: false, containerId: 'none', previousScrollTop: 0, newScrollTop: 0, progressMade: false, reachedEnd: false };
    }

    const containers = this.detectScrollableContainers();
    // Prefer non-window container if available (e.g. chat container, feed modal)
    const target = containers.length > 1 ? containers[1] : containers[0];
    const scrollStep = amount || (target.clientHeight ? Math.floor(target.clientHeight * 0.75) : 400);

    const prevTop = target.scrollTop;

    if (target.isWindow) {
      if (direction === 'down') window.scrollBy({ top: scrollStep, behavior: 'smooth' });
      else if (direction === 'up') window.scrollBy({ top: -scrollStep, behavior: 'smooth' });
      else if (direction === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      else if (direction === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    } else if (target.selector) {
      const el = document.querySelector(target.selector);
      if (el) {
        if (direction === 'down') el.scrollBy({ top: scrollStep, behavior: 'smooth' });
        else if (direction === 'up') el.scrollBy({ top: -scrollStep, behavior: 'smooth' });
        else if (direction === 'top') el.scrollTop = 0;
        else if (direction === 'bottom') el.scrollTop = el.scrollHeight;
      }
    }

    const newTop = target.isWindow
      ? window.scrollY || document.documentElement.scrollTop
      : (document.querySelector(target.selector || '')?.scrollTop || prevTop);

    const progressMade = Math.abs(newTop - prevTop) > 5 || direction === 'down';
    const reachedEnd = target.scrollHeight - (newTop + target.clientHeight) < 20;

    return {
      success: true,
      containerId: target.id,
      previousScrollTop: prevTop,
      newScrollTop: newTop,
      progressMade,
      reachedEnd,
    };
  }

  /**
   * Scroll until a specified text or element condition is met.
   */
  public async scrollUntilCondition(
    conditionText: string,
    maxScrolls: number = 8,
    onStep?: (scrollCount: number) => void
  ): Promise<{ found: boolean; scrollsExecuted: number }> {
    const query = conditionText.toLowerCase().trim();

    for (let count = 0; count < maxScrolls; count++) {
      onStep?.(count + 1);

      // Check current viewport
      const candidate = uiPerceptionEngine.findBestCandidate(query);
      if (candidate && candidate.confidence > 0.5) {
        return { found: true, scrollsExecuted: count };
      }

      // Perform scroll step
      const scrollRes = this.scroll('down');
      if (scrollRes.reachedEnd) {
        // One final check at bottom
        await new Promise((r) => setTimeout(r, 400));
        const finalCandidate = uiPerceptionEngine.findBestCandidate(query);
        return { found: !!(finalCandidate && finalCandidate.confidence > 0.5), scrollsExecuted: count + 1 };
      }

      await new Promise((r) => setTimeout(r, 600)); // Allow render
    }

    return { found: false, scrollsExecuted: maxScrolls };
  }
}

export const scrollingEngine = new ScrollingEngine();
