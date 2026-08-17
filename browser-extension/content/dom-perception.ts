// browser-extension/content/dom-perception.ts
// Real DOM Perception Engine executing inside target browser tabs

import { ExtensionPerceptionCandidate } from '../shared/message-types';

export class ContentDomPerception {
  /**
   * Perceive real DOM elements in the active browser tab.
   * Priority: Accessibility/ARIA -> Semantic HTML -> Role/Name -> Text -> Bounds.
   */
  public findBestTarget(query: string, targetRole?: string): ExtensionPerceptionCandidate | null {
    if (typeof document === 'undefined') return null;

    const q = query.toLowerCase().trim();
    const candidates: ExtensionPerceptionCandidate[] = [];

    const elements = Array.from(
      document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], div, span')
    );

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
      if (!isVisible) continue;

      const ariaLabel = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '').toLowerCase();
      const text = (el.textContent || '').toLowerCase().trim();
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      const role = el.getAttribute('role') || el.tagName.toLowerCase();

      let confidence = 0;

      // 1. ARIA match
      if (ariaLabel === q) confidence += 0.95;
      else if (ariaLabel.includes(q)) confidence += 0.8;

      // 2. Visible text match
      if (text === q) confidence += 0.9;
      else if (text.startsWith(q)) confidence += 0.75;
      else if (text.includes(q)) confidence += 0.6;

      // 3. Placeholder match
      if (placeholder === q) confidence += 0.85;
      else if (placeholder.includes(q)) confidence += 0.7;

      if (targetRole && role === targetRole) confidence += 0.1;

      if (confidence > 0.4) {
        candidates.push({
          role,
          name: ariaLabel || text || placeholder || title || role,
          text: text.slice(0, 100),
          selector: this.getStableSelector(el),
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          visible: true,
          enabled: !(el as HTMLButtonElement).disabled,
          confidence: Math.min(confidence, 1.0),
        });
      }
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates.length > 0 ? candidates[0] : null;
  }

  private getStableSelector(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const role = el.getAttribute('role');
    const ariaLabel = el.getAttribute('aria-label');
    if (role && ariaLabel) return `[role="${role}"][aria-label="${ariaLabel}"]`;
    if (el.getAttribute('name')) return `[name="${el.getAttribute('name')}"]`;
    if (el.getAttribute('placeholder')) return `[placeholder="${el.getAttribute('placeholder')}"]`;
    return el.tagName.toLowerCase();
  }
}

export const contentDomPerception = new ContentDomPerception();
