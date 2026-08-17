// frontend/lib/automation/share-engine.ts
// Universal Content Sharing Engine ("share this video", "share this reel", "send to Rahul")

import { uiPerceptionEngine } from './ui-perception';

export class ShareEngine {
  /**
   * Execute content sharing for the active page/media item.
   */
  public async shareCurrentContent(targetRecipient?: string): Promise<{ success: boolean; method: string; url?: string }> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { success: false, method: 'none' };
    }

    const currentUrl = window.location.href;

    // 1. Try finding Share button on current page
    const shareBtn = uiPerceptionEngine.findBestCandidate('share');
    if (shareBtn && shareBtn.confidence > 0.5) {
      try {
        (shareBtn.element as HTMLElement).click();
        return { success: true, method: 'ui_share_button', url: currentUrl };
      } catch {}
    }

    // 2. Web Share API fallback
    if ('navigator' in window && 'share' in navigator) {
      try {
        await (navigator as any).share({
          title: document.title,
          url: currentUrl,
        });
        return { success: true, method: 'web_share_api', url: currentUrl };
      } catch {}
    }

    // 3. Clipboard fallback
    if ('navigator' in window && 'clipboard' in navigator) {
      try {
        await navigator.clipboard.writeText(currentUrl);
        return { success: true, method: 'clipboard_copy', url: currentUrl };
      } catch {}
    }

    return { success: false, method: 'none', url: currentUrl };
  }
}

export const shareEngine = new ShareEngine();
