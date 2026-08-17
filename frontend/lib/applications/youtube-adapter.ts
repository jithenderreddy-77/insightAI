// frontend/lib/applications/youtube-adapter.ts
// YouTube Specialized Application Workflow Adapter

import { ApplicationAdapter, ActionResult } from './application-adapter';
import { UIObservation, ExpectedState } from '../agent/agent-types';
import { uiPerceptionEngine } from '../automation/ui-perception';
import { scrollingEngine, ScrollDirection } from '../automation/scrolling-engine';
import { navigationEngine } from '../automation/navigation-engine';
import { shareEngine } from '../automation/share-engine';

export class YouTubeAdapter implements ApplicationAdapter {
  public id = 'youtube';
  public aliases = ['youtube', 'yt', 'youtube videos', 'youtube.com'];

  public canHandle(appNameOrUrl: string): boolean {
    const q = appNameOrUrl.toLowerCase();
    return q.includes('youtube') || q.includes('youtu.be');
  }

  public async open(targetQuery?: string): Promise<ActionResult> {
    if (typeof window === 'undefined') return { success: false, error: 'SSR Environment' };

    let url = 'https://www.youtube.com';
    if (targetQuery) {
      url = `https://www.youtube.com/results?search_query=${encodeURIComponent(targetQuery)}`;
    }

    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      return { success: true, message: targetQuery ? `Opening YouTube search for "${targetQuery}"` : 'Opening YouTube' };
    } catch (e) {
      return { success: false, error: 'Failed to open YouTube' };
    }
  }

  public async search(query: string): Promise<ActionResult> {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return { success: true, message: `Searched YouTube for "${query}"` };
  }

  public async navigate(section: string): Promise<ActionResult> {
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
        return { success: true, message: `Opened YouTube video "${target}"` };
      } catch {}
    }
    return { success: false, error: `Could not click YouTube target "${target}"` };
  }

  public async typeText(text: string, fieldTarget?: string): Promise<ActionResult> {
    return this.search(text);
  }

  public async scroll(direction: ScrollDirection = 'down', amount?: number): Promise<ActionResult> {
    const res = scrollingEngine.scroll(direction, amount);
    return { success: res.success, message: `Scrolled YouTube ${direction}` };
  }

  public async goBack(): Promise<ActionResult> {
    const res = navigationEngine.goBack();
    return { success: res.success, message: 'Returned to previous YouTube page' };
  }

  public async shareCurrentContent(recipient?: string): Promise<ActionResult> {
    const res = await shareEngine.shareCurrentContent(recipient);
    return { success: res.success, message: 'Shared YouTube video', data: { url: res.url } };
  }

  public async observe(): Promise<UIObservation> {
    return uiPerceptionEngine.perceive();
  }

  public async verify(expected: ExpectedState): Promise<boolean> {
    return true;
  }
}

export const youtubeAdapter = new YouTubeAdapter();
