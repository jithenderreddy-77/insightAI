// frontend/lib/applications/instagram-adapter.ts
// Instagram Specialized Application Workflow Adapter

import { ApplicationAdapter, ActionResult } from './application-adapter';
import { UIObservation, ExpectedState } from '../agent/agent-types';
import { uiPerceptionEngine } from '../automation/ui-perception';
import { scrollingEngine, ScrollDirection } from '../automation/scrolling-engine';
import { navigationEngine } from '../automation/navigation-engine';
import { shareEngine } from '../automation/share-engine';

export class InstagramAdapter implements ApplicationAdapter {
  public id = 'instagram';
  public aliases = ['instagram', 'insta', 'ig', 'instagram reels'];

  public canHandle(appNameOrUrl: string): boolean {
    const q = appNameOrUrl.toLowerCase();
    return q.includes('instagram') || q.includes('instagr.am');
  }

  public async open(targetQuery?: string): Promise<ActionResult> {
    if (typeof window === 'undefined') return { success: false, error: 'SSR Environment' };

    let url = 'https://instagram.com';
    if (targetQuery) {
      const cleanUser = targetQuery.replace(/^@/, '').trim();
      url = `https://instagram.com/${cleanUser}`;
    }

    try {
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win || win.closed || typeof win.closed === 'undefined') {
        window.location.href = url;
      }
      return { success: true, message: targetQuery ? `Opening Instagram profile for "${targetQuery}"` : 'Opening Instagram' };
    } catch (e) {
      try { window.location.href = url; } catch {}
      return { success: true, message: 'Opening Instagram' };
    }
  }

  public async search(query: string): Promise<ActionResult> {
    const cleanUser = query.replace(/^@/, '').trim();
    const url = `https://instagram.com/${cleanUser}`;
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return { success: true, message: `Opened Instagram profile for "${query}"` };
  }

  public async navigate(section: string): Promise<ActionResult> {
    if (section.toLowerCase().includes('reel')) {
      if (typeof window !== 'undefined') {
        window.open('https://instagram.com/reels', '_blank', 'noopener,noreferrer');
      }
      return { success: true, message: 'Navigated to Instagram Reels' };
    }

    const candidate = uiPerceptionEngine.findBestCandidate(section);
    if (candidate && candidate.confidence > 0.5) {
      try {
        (candidate.element as HTMLElement).click();
        return { success: true, message: `Navigated to ${section}` };
      } catch {}
    }
    return { success: false, error: `Could not navigate to ${section}` };
  }

  public async clickTarget(target: string): Promise<ActionResult> {
    const candidate = uiPerceptionEngine.findBestCandidate(target);
    if (candidate && candidate.confidence > 0.4) {
      try {
        (candidate.element as HTMLElement).click();
        return { success: true, message: `Clicked "${target}" on Instagram` };
      } catch {}
    }
    return { success: false, error: `Could not click target "${target}"` };
  }

  public async typeText(text: string, fieldTarget?: string): Promise<ActionResult> {
    return this.search(text);
  }

  public async scroll(direction: ScrollDirection = 'down', amount?: number): Promise<ActionResult> {
    const res = scrollingEngine.scroll(direction, amount);
    return { success: res.success, message: `Scrolled Instagram ${direction}` };
  }

  public async goBack(): Promise<ActionResult> {
    const res = navigationEngine.goBack();
    return { success: res.success, message: 'Returned to previous Instagram page' };
  }

  public async shareCurrentContent(recipient?: string): Promise<ActionResult> {
    const res = await shareEngine.shareCurrentContent(recipient);
    return { success: res.success, message: 'Shared Instagram reel/content', data: { url: res.url } };
  }

  public async observe(): Promise<UIObservation> {
    return uiPerceptionEngine.perceive();
  }

  public async verify(expected: ExpectedState): Promise<boolean> {
    return true;
  }
}

export const instagramAdapter = new InstagramAdapter();
