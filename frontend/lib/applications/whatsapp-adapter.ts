// frontend/lib/applications/whatsapp-adapter.ts
// WhatsApp Specialized Application Workflow Adapter

import { ApplicationAdapter, ActionResult } from './application-adapter';
import { UIObservation, ExpectedState } from '../agent/agent-types';
import { uiPerceptionEngine } from '../automation/ui-perception';
import { scrollingEngine, ScrollDirection } from '../automation/scrolling-engine';
import { navigationEngine } from '../automation/navigation-engine';
import { shareEngine } from '../automation/share-engine';

export class WhatsAppAdapter implements ApplicationAdapter {
  public id = 'whatsapp';
  public aliases = ['whatsapp', 'wa', 'whats app', 'whatsapp web'];

  public canHandle(appNameOrUrl: string): boolean {
    const q = appNameOrUrl.toLowerCase();
    return q.includes('whatsapp') || q.includes('web.whatsapp.com') || q.includes('wa.me');
  }

  public async open(targetQuery?: string): Promise<ActionResult> {
    if (typeof window === 'undefined') return { success: false, error: 'SSR Environment' };

    const webUrl = 'https://web.whatsapp.com';
    const nativeScheme = 'whatsapp://';

    try {
      window.open(webUrl, '_blank', 'noopener,noreferrer');
      return { success: true, message: 'Opening WhatsApp Web' };
    } catch (e) {
      return { success: false, error: 'Failed to open WhatsApp' };
    }
  }

  public async search(query: string): Promise<ActionResult> {
    // Look for WhatsApp chat search box
    const searchInput =
      uiPerceptionEngine.findBestCandidate('search or start new chat') ||
      uiPerceptionEngine.findBestCandidate('search') ||
      uiPerceptionEngine.findBestCandidate('chats');

    if (searchInput) {
      try {
        const el = searchInput.element as HTMLInputElement;
        el.focus();
        el.value = query;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true, message: `Searching WhatsApp for "${query}"` };
      } catch {}
    }

    // Direct WhatsApp web deep-link search fallback
    const waUrl = `https://web.whatsapp.com`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    return { success: true, message: `Opening WhatsApp search for "${query}"` };
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
        return { success: true, message: `Opened chat "${target}"` };
      } catch {}
    }
    return { success: false, error: `Could not open WhatsApp target "${target}"` };
  }

  public async typeText(text: string, fieldTarget?: string): Promise<ActionResult> {
    const msgInput =
      uiPerceptionEngine.findBestCandidate('type a message') ||
      uiPerceptionEngine.findBestCandidate('message');

    if (msgInput) {
      try {
        const el = msgInput.element as HTMLInputElement;
        el.focus();
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true, message: `Drafted message "${text}"` };
      } catch {}
    }

    return { success: false, error: 'Could not locate WhatsApp message input field' };
  }

  public async scroll(direction: ScrollDirection = 'down', amount?: number): Promise<ActionResult> {
    const res = scrollingEngine.scroll(direction, amount);
    return { success: res.success, message: `Scrolled WhatsApp ${direction}` };
  }

  public async goBack(): Promise<ActionResult> {
    const res = navigationEngine.goBack();
    return { success: res.success, message: 'Returned to chat list' };
  }

  public async shareCurrentContent(recipient?: string): Promise<ActionResult> {
    const res = await shareEngine.shareCurrentContent(recipient);
    return { success: res.success, message: `Shared via WhatsApp` };
  }

  public async observe(): Promise<UIObservation> {
    return uiPerceptionEngine.perceive();
  }

  public async verify(expected: ExpectedState): Promise<boolean> {
    if (expected.urlPattern && typeof window !== 'undefined') {
      return window.location.href.toLowerCase().includes(expected.urlPattern.toLowerCase());
    }
    return true;
  }
}

export const whatsappAdapter = new WhatsAppAdapter();
