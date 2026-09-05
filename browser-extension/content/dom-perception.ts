// browser-extension/content/dom-perception.ts
// Real DOM Perception Engine executing inside target browser tabs

import { ExtensionPerceptionCandidate } from '../shared/message-types';

// ─────────────────────────────────────────────────────────
// SELECTOR MAP TYPES (for DOM Accessibility Snapshot)
// ─────────────────────────────────────────────────────────

export interface SelectorMapEntry {
  index: number;
  role: string;
  label: string;
  selector: string;
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
}

// Interactive roles to include in the accessibility snapshot
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio',
  'menuitem', 'tab', 'option', 'combobox', 'select', 'slider',
  'spinbutton', 'switch', 'treeitem',
]);

// Tags that are inherently interactive
const INTERACTIVE_TAGS = new Set([
  'button', 'a', 'input', 'select', 'textarea',
]);

export class ContentDomPerception {
  /**
   * Capture the DOM's accessibility tree filtered to interactive elements only.
   * Assigns stable numeric indices in DOM order.
   *
   * Returns: Array of SelectorMapEntry with index, role, label, selector, text, bounds.
   */
  public getAccessibilitySnapshot(): SelectorMapEntry[] {
    if (typeof document === 'undefined') return [];

    const entries: SelectorMapEntry[] = [];
    let index = 0;

    // Query all potentially interactive elements
    const elements = Array.from(
      document.querySelectorAll(
        'button, a, input, select, textarea, ' +
        '[role="button"], [role="link"], [role="tab"], [role="menuitem"], ' +
        '[role="checkbox"], [role="radio"], [role="combobox"], [role="searchbox"], ' +
        '[role="textbox"], [role="option"], [role="switch"], [role="slider"], ' +
        '[role="treeitem"], [contenteditable="true"]'
      )
    );

    for (const el of elements) {
      const rect = el.getBoundingClientRect();

      // Skip invisible/zero-size elements
      const isVisible = rect.width > 0 && rect.height > 0 &&
        window.getComputedStyle(el).visibility !== 'hidden' &&
        window.getComputedStyle(el).display !== 'none';
      if (!isVisible) continue;

      // Skip elements that are completely off-screen (beyond the viewport + 1 screen)
      const viewportH = window.innerHeight;
      if (rect.top > viewportH * 2 || rect.bottom < -viewportH) continue;

      // Determine role
      const ariaRole = el.getAttribute('role');
      const tagName = el.tagName.toLowerCase();
      const inputType = (el as HTMLInputElement).type?.toLowerCase();
      let role = ariaRole || tagName;

      // Refine role for <input> types
      if (tagName === 'input') {
        if (inputType === 'text' || inputType === 'search' || inputType === 'email' ||
            inputType === 'tel' || inputType === 'url' || inputType === 'number') {
          role = inputType === 'search' ? 'searchbox' : 'textbox';
        } else if (inputType === 'checkbox') {
          role = 'checkbox';
        } else if (inputType === 'radio') {
          role = 'radio';
        } else if (inputType === 'submit' || inputType === 'button') {
          role = 'button';
        }
      }

      // Filter: only interactive roles
      if (!INTERACTIVE_ROLES.has(role) && !INTERACTIVE_TAGS.has(tagName)) continue;

      // Determine label (priority: aria-label > aria-labelledby > textContent > placeholder > title)
      const ariaLabel = el.getAttribute('aria-label') || '';
      const ariaLabelledBy = el.getAttribute('aria-labelledby');
      let label = ariaLabel;

      if (!label && ariaLabelledBy) {
        const labelEl = document.getElementById(ariaLabelledBy);
        if (labelEl) label = (labelEl.textContent || '').trim();
      }

      if (!label) {
        // For inputs, check associated <label>
        if (el.id) {
          const associatedLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (associatedLabel) label = (associatedLabel.textContent || '').trim();
        }
      }

      if (!label) label = (el.getAttribute('placeholder') || '').trim();
      if (!label) label = (el.getAttribute('title') || '').trim();
      if (!label) label = (el.textContent || '').trim().slice(0, 80);

      // Get stable selector
      const selector = this.getStableSelector(el);

      // Get visible text (truncated)
      const text = (el.textContent || '').trim().slice(0, 80);

      entries.push({
        index,
        role,
        label: label.slice(0, 120),
        selector,
        text,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });

      index++;
    }

    return entries;
  }

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
    if (role && ariaLabel) return `[role="${role}"][aria-label="${CSS.escape(ariaLabel)}"]`;
    if (el.getAttribute('name')) return `[name="${CSS.escape(el.getAttribute('name')!)}"]`;
    if (el.getAttribute('placeholder')) return `[placeholder="${CSS.escape(el.getAttribute('placeholder')!)}"]`;

    // Build a more specific selector using tag + nth-child
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el) + 1;
        return `${tag}:nth-of-type(${idx})`;
      }
    }

    return tag;
  }
}

export const contentDomPerception = new ContentDomPerception();
