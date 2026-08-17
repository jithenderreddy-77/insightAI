// frontend/lib/automation/ui-perception.ts
// Multi-Tier UI Perception Engine (Accessibility Tree > ARIA > Semantic DOM > Visible Text > Bounds)

import { UIObservation, UIEntity, UIAction } from '../agent/agent-types';

export interface TargetCandidate {
  element: Element;
  selector: string;
  role: string;
  accessibleName: string;
  confidence: number; // 0.0 to 1.0
}

export class UIPerceptionEngine {
  /**
   * Perceive current UI state and construct a normalized UIObservation object.
   */
  public perceive(): UIObservation {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { elements: [], scrollContainers: [], dialogs: [], visibleText: '' };
    }

    const elements: UIObservation['elements'] = [];
    const interactiveQuery = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [tabindex]';

    try {
      const domElems = Array.from(document.querySelectorAll(interactiveQuery));

      for (const el of domElems.slice(0, 100)) {
        const rect = el.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
        if (!visible) continue;

        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const text = (el.textContent || '').trim().slice(0, 100);
        const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || undefined;
        const placeholder = el.getAttribute('placeholder') || undefined;
        const value = (el as HTMLInputElement).value || undefined;

        elements.push({
          role,
          text,
          ariaLabel,
          placeholder,
          value,
          selector: this.generateStableSelector(el),
          enabled: !(el as HTMLButtonElement).disabled,
          visible: true,
          clickable: role === 'button' || role === 'a' || role === 'input' || el.tagName === 'BUTTON' || el.tagName === 'A',
          editable: el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.getAttribute('contenteditable') === 'true',
        });
      }
    } catch {}

    const visibleText = document.body ? (document.body.innerText || '').slice(0, 2000) : '';

    return {
      url: window.location.href,
      title: document.title,
      elements,
      scrollContainers: [],
      dialogs: [],
      visibleText,
    };
  }

  /**
   * Find and rank target UI candidates before clicking (Perception BEFORE Action).
   */
  public findBestCandidate(query: string, targetRole?: string): TargetCandidate | null {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;

    const q = query.toLowerCase().trim();
    const candidates: TargetCandidate[] = [];

    const allElems = Array.from(
      document.querySelectorAll('button, a, input, [role="button"], [role="link"], [role="tab"], [role="menuitem"], div, span')
    );

    for (const el of allElems) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const text = (el.textContent || '').toLowerCase().trim();
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      const role = el.getAttribute('role') || el.tagName.toLowerCase();

      let score = 0;

      // 1. Accessibility / ARIA exact or partial match
      if (ariaLabel === q) score += 0.95;
      else if (ariaLabel.includes(q)) score += 0.8;

      // 2. Visible text exact or partial match
      if (text === q) score += 0.9;
      else if (text.startsWith(q)) score += 0.75;
      else if (text.includes(q)) score += 0.6;

      // 3. Placeholder match
      if (placeholder === q) score += 0.85;
      else if (placeholder.includes(q)) score += 0.7;

      // 4. Role match bonus
      if (targetRole && role === targetRole) score += 0.1;

      if (score > 0.4) {
        candidates.push({
          element: el,
          selector: this.generateStableSelector(el),
          role,
          accessibleName: ariaLabel || text || placeholder || title || role,
          confidence: Math.min(score, 1.0),
        });
      }
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates.length > 0 ? candidates[0] : null;
  }

  private generateStableSelector(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const role = el.getAttribute('role');
    const ariaLabel = el.getAttribute('aria-label');
    if (role && ariaLabel) return `[role="${role}"][aria-label="${ariaLabel}"]`;
    if (el.getAttribute('name')) return `[name="${el.getAttribute('name')}"]`;
    if (el.getAttribute('placeholder')) return `[placeholder="${el.getAttribute('placeholder')}"]`;
    return el.tagName.toLowerCase();
  }
}

export const uiPerceptionEngine = new UIPerceptionEngine();
