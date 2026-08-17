// browser-extension/content/scrolling-controller.ts
// Real Scrolling Controller executing inside target browser tabs

import { contentDomPerception } from './dom-perception';

export class ContentScrollingController {
  public scroll(direction: 'down' | 'up' | 'top' | 'bottom' = 'down', amount?: number): { success: boolean; scrollTop: number } {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { success: false, scrollTop: 0 };
    }

    const scrollStep = amount || Math.floor(window.innerHeight * 0.75);

    // 1. Check for scrollable container element first
    const scrollables = Array.from(document.querySelectorAll('*')).filter((el) => {
      const style = window.getComputedStyle(el);
      return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });

    const targetEl = scrollables.length > 0 ? (scrollables[0] as HTMLElement) : null;

    if (targetEl) {
      if (direction === 'down') targetEl.scrollBy({ top: scrollStep, behavior: 'smooth' });
      else if (direction === 'up') targetEl.scrollBy({ top: -scrollStep, behavior: 'smooth' });
      else if (direction === 'top') targetEl.scrollTop = 0;
      else if (direction === 'bottom') targetEl.scrollTop = targetEl.scrollHeight;
      return { success: true, scrollTop: targetEl.scrollTop };
    }

    // 2. Viewport window scroll
    if (direction === 'down') window.scrollBy({ top: scrollStep, behavior: 'smooth' });
    else if (direction === 'up') window.scrollBy({ top: -scrollStep, behavior: 'smooth' });
    else if (direction === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
    else if (direction === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });

    return { success: true, scrollTop: window.scrollY || document.documentElement.scrollTop };
  }

  public async scrollUntilCondition(query: string, maxScrolls = 8): Promise<{ found: boolean; count: number }> {
    for (let i = 0; i < maxScrolls; i++) {
      const candidate = contentDomPerception.findBestTarget(query);
      if (candidate && candidate.confidence > 0.5) {
        return { found: true, count: i };
      }
      this.scroll('down');
      await new Promise((r) => setTimeout(r, 600));
    }
    return { found: false, count: maxScrolls };
  }
}

export const contentScrollingController = new ContentScrollingController();
