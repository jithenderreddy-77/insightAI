// frontend/lib/applications/generic-web-adapter.ts
// Universal Computer Interaction Layer Fallback Adapter

import { ApplicationAdapter, ActionResult } from './application-adapter';
import { UIObservation, ExpectedState } from '../agent/agent-types';
import { uiPerceptionEngine } from '../automation/ui-perception';
import { scrollingEngine, ScrollDirection } from '../automation/scrolling-engine';
import { navigationEngine } from '../automation/navigation-engine';
import { shareEngine } from '../automation/share-engine';
import { actionVerifier } from '../agent/action-verifier';

export class GenericWebAdapter implements ApplicationAdapter {
  public id = 'generic_web';
  public aliases = ['web', 'website', 'browser', 'page', 'internet'];

  public canHandle(appNameOrUrl: string): boolean {
    return true; // Fallback for any unknown website or web application
  }

  public async open(targetQuery?: string): Promise<ActionResult> {
    if (typeof window === 'undefined') return { success: false, error: 'SSR Environment' };

    if (targetQuery && targetQuery.startsWith('http')) {
      window.open(targetQuery, '_blank', 'noopener,noreferrer');
      return { success: true, message: `Opened URL ${targetQuery}` };
    }

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(targetQuery || 'web')}`;
    window.open(searchUrl, '_blank', 'noopener,noreferrer');
    return { success: true, message: `Opened search for ${targetQuery}` };
  }

  public async search(query: string): Promise<ActionResult> {
    const searchInput = uiPerceptionEngine.findBestCandidate('search') || uiPerceptionEngine.findBestCandidate('find');

    if (searchInput) {
      try {
        const el = searchInput.element as HTMLInputElement;
        el.focus();
        el.value = query;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        return { success: true, message: `Searched for "${query}"` };
      } catch {}
    }

    // Fallback: Google search
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    window.open(searchUrl, '_blank', 'noopener,noreferrer');
    return { success: true, message: `Launched web search for "${query}"` };
  }

  public async navigate(section: string): Promise<ActionResult> {
    const candidate = uiPerceptionEngine.findBestCandidate(section);
    if (candidate && candidate.confidence > 0.5) {
      try {
        (candidate.element as HTMLElement).click();
        return { success: true, message: `Navigated to ${section}` };
      } catch {}
    }
    return { success: false, error: `Could not locate navigation target "${section}"` };
  }

  public async clickTarget(target: string): Promise<ActionResult> {
    const candidate = uiPerceptionEngine.findBestCandidate(target);
    if (candidate && candidate.confidence > 0.4) {
      try {
        (candidate.element as HTMLElement).click();
        return { success: true, message: `Clicked "${target}"` };
      } catch {}
    }
    return { success: false, error: `Could not locate clickable target "${target}"` };
  }

  public async typeText(text: string, fieldTarget?: string): Promise<ActionResult> {
    const target = fieldTarget ? uiPerceptionEngine.findBestCandidate(fieldTarget) : undefined;
    const inputEl = (target?.element || document.activeElement) as HTMLInputElement;

    if (inputEl && (inputEl.tagName === 'INPUT' || inputEl.tagName === 'TEXTAREA' || inputEl.getAttribute('contenteditable') === 'true')) {
      try {
        inputEl.focus();
        inputEl.value = text;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true, message: `Typed "${text}"` };
      } catch {}
    }

    return { success: false, error: 'No editable input field currently focused' };
  }

  public async scroll(direction: ScrollDirection = 'down', amount?: number): Promise<ActionResult> {
    const res = scrollingEngine.scroll(direction, amount);
    return { success: res.success, message: `Scrolled ${direction}` };
  }

  public async goBack(): Promise<ActionResult> {
    const res = navigationEngine.goBack();
    return { success: res.success, message: `Navigated back via ${res.method}` };
  }

  public async shareCurrentContent(recipient?: string): Promise<ActionResult> {
    const res = await shareEngine.shareCurrentContent(recipient);
    return { success: res.success, message: `Shared via ${res.method}`, data: { url: res.url } };
  }

  public async observe(): Promise<UIObservation> {
    return uiPerceptionEngine.perceive();
  }

  public async verify(expected: ExpectedState): Promise<boolean> {
    const res = await actionVerifier.verify({ id: 'verify', type: 'WAIT', timeoutMs: 1000, riskLevel: 'LOW', description: 'verify' }, expected);
    return res.success;
  }
}

export const genericWebAdapter = new GenericWebAdapter();
