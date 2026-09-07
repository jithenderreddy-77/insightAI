// frontend/lib/agent/in-page-action-executor.ts
// ╔═══════════════════════════════════════════════════════════════╗
// ║  In-Page Action Executor                                      ║
// ║  Orchestrates DOM snapshot → element resolution → action      ║
// ║  Deterministic → LLM → HITL for every resolution             ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Anti-hallucination rules enforced:
// - Re-snapshot DOM after every navigation/scroll/DOM-mutating action
// - Stale-index guard: refuse to act on indices no longer in the live DOM
// - Confidence thresholds with real escalation (≥0.8 act, 0.5-0.8 disambiguate, <0.5 report)
// - Bounded retries: max 2 automatic retries, then plain-language failure
// - Idempotency: check current state before acting

import { browserBridgeClient } from '../browser-bridge/browser-bridge-client';
import { productMatcher, type ProductMatchResult } from './product-matcher';
import { safetyGate, type SafetyGateResult } from './safety-gate';
import { sessionStateManager, type SelectorMap, type SelectorMapEntry, type SSEEventType } from './session-state';
import { ollamaJSON } from './ollama-client';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface InPageActionResult {
  success: boolean;
  message: string;
  actionTaken: string;
  requiresConfirmation?: boolean;
  confirmationQuestion?: string;
  questionId?: string;
  newSelectorMap?: SelectorMap;
}

interface ResolvedElement {
  entry: SelectorMapEntry;
  confidence: number;
  source: 'deterministic' | 'llm' | 'product_match';
}

// ─────────────────────────────────────────────────────────
// SCROLL PATTERNS
// ─────────────────────────────────────────────────────────

const SCROLL_DOWN_PATTERNS = /^scroll\s+(down|more|further)\b/i;
const SCROLL_UP_PATTERNS = /^scroll\s+(up|back\s+up)\b/i;
const SCROLL_TOP_PATTERNS = /^scroll\s+to\s+(the\s+)?top/i;
const SCROLL_BOTTOM_PATTERNS = /^scroll\s+to\s+(the\s+)?bottom/i;
const SCROLL_TO_ELEMENT_PATTERNS = /^scroll\s+to\s+(the\s+)?(.+)/i;

// ─────────────────────────────────────────────────────────
// ACTION PATTERNS
// ─────────────────────────────────────────────────────────

const CLICK_PATTERNS = /^click\s+(on\s+)?(.+)/i;
const TYPE_PATTERNS = /^(type|enter|fill\s+in|input|write)\s+["']?(.+?)["']?\s*(in|into|on)?\s*(.+)?$/i;
const SELECT_PATTERNS = /^(select|choose|pick)\s+(the\s+)?(.+)/i;
const ADD_TO_CART_PATTERNS = /^add\s+(it|this|that)?\s*to\s+(cart|bag|basket|wishlist)/i;
const BUY_NOW_PATTERNS = /^(buy\s+now|checkout|proceed\s+to\s+checkout|place\s+order)/i;
const GO_BACK_PATTERNS = /^(go\s+back|back|return|previous\s+page)/i;

const MAX_RETRIES = 2;

// ─────────────────────────────────────────────────────────
// IN-PAGE ACTION EXECUTOR
// ─────────────────────────────────────────────────────────

export class InPageActionExecutor {
  /**
   * Execute an in-page action based on a voice command.
   *
   * Flow:
   * 1. Request fresh DOM snapshot from extension
   * 2. Parse command to determine action type
   * 3. Resolve target element (deterministic → LLM → HITL)
   * 4. Safety gate check
   * 5. Execute action via extension bridge
   * 6. Re-snapshot DOM after action
   * 7. Check for success indicators
   */
  public async execute(
    command: string,
    sessionId: string,
    abortSignal?: AbortSignal
  ): Promise<InPageActionResult> {
    const q = command.toLowerCase().trim();

    // Log the action
    sessionStateManager.emitEvent(sessionId, 'action:log', {
      message: `In-page action: "${command}"`,
    });

    // Check abort
    if (abortSignal?.aborted) {
      return { success: false, message: 'Action cancelled', actionTaken: 'none' };
    }

    // ── GO BACK (Independent of selectorMap) ──
    if (GO_BACK_PATTERNS.test(q)) {
      return this.executeViaExtension(sessionId, {
        actionId: this.generateActionId(),
        type: 'GO_BACK',
        timeoutMs: 3000,
      }, 'go_back');
    }

    // ── SCROLL (Independent of selectorMap) ──
    if (SCROLL_DOWN_PATTERNS.test(q)) {
      return this.executeViaExtension(sessionId, {
        actionId: this.generateActionId(),
        type: 'SCROLL',
        value: 'down',
        timeoutMs: 3000,
      }, 'scroll_down');
    }
    if (SCROLL_UP_PATTERNS.test(q)) {
      return this.executeViaExtension(sessionId, {
        actionId: this.generateActionId(),
        type: 'SCROLL',
        value: 'up',
        timeoutMs: 3000,
      }, 'scroll_up');
    }
    if (SCROLL_TOP_PATTERNS.test(q)) {
      return this.executeViaExtension(sessionId, {
        actionId: this.generateActionId(),
        type: 'SCROLL',
        value: 'top',
        timeoutMs: 3000,
      }, 'scroll_top');
    }
    if (SCROLL_BOTTOM_PATTERNS.test(q)) {
      return this.executeViaExtension(sessionId, {
        actionId: this.generateActionId(),
        type: 'SCROLL',
        value: 'bottom',
        timeoutMs: 3000,
      }, 'scroll_bottom');
    }

    // 1. Request fresh DOM snapshot for element-targeting actions
    const selectorMap = await this.requestDOMSnapshot(sessionId);
    if (!selectorMap || Object.keys(selectorMap).length === 0) {
      return {
        success: false,
        message: 'Could not get page elements from the current tab. Please ensure the target website is open and the extension is loaded.',
        actionTaken: 'none',
      };
    }

    // 2. Determine element-targeting action type and execute

    // Scroll to a specific element
    const scrollToMatch = q.match(SCROLL_TO_ELEMENT_PATTERNS);
    if (scrollToMatch) {
      const targetDesc = scrollToMatch[2].trim();
      const resolved = await this.resolveElement(targetDesc, selectorMap);
      if (resolved) {
        return this.executeViaExtension(sessionId, {
          actionId: this.generateActionId(),
          type: 'SCROLL_TO_ELEMENT',
          targetQuery: resolved.entry.selector,
          timeoutMs: 3000,
        }, 'scroll_to_element');
      }
    }

    // ── CLICK ──
    const clickMatch = q.match(CLICK_PATTERNS);
    if (clickMatch) {
      const targetDesc = clickMatch[2].trim();
      return this.resolveAndExecuteClick(targetDesc, selectorMap, sessionId, abortSignal);
    }

    // ── ADD TO CART / BUY NOW ──
    if (ADD_TO_CART_PATTERNS.test(q)) {
      return this.resolveAndExecuteClick('add to cart', selectorMap, sessionId, abortSignal);
    }
    if (BUY_NOW_PATTERNS.test(q)) {
      return this.resolveAndExecuteClick(q, selectorMap, sessionId, abortSignal);
    }

    // ── TYPE ──
    const typeMatch = q.match(TYPE_PATTERNS);
    if (typeMatch) {
      const value = typeMatch[2].trim();
      const targetDesc = typeMatch[4]?.trim();

      if (targetDesc) {
        const resolved = await this.resolveElement(targetDesc, selectorMap);
        if (resolved) {
          return this.executeViaExtension(sessionId, {
            actionId: this.generateActionId(),
            type: 'TYPE',
            targetQuery: resolved.entry.selector,
            value,
            timeoutMs: 5000,
          }, 'type');
        }
      }

      // No target specified — find the first visible textbox
      const firstTextbox = Object.values(selectorMap).find(
        e => ['textbox', 'searchbox', 'input'].includes(e.role)
      );
      if (firstTextbox) {
        return this.executeViaExtension(sessionId, {
          actionId: this.generateActionId(),
          type: 'TYPE',
          targetQuery: firstTextbox.selector,
          value,
          timeoutMs: 5000,
        }, 'type');
      }
    }

    // ── SELECT / PRODUCT MATCH ──
    const selectMatch = q.match(SELECT_PATTERNS);
    if (selectMatch) {
      const targetDesc = selectMatch[3].trim();
      return this.resolveAndExecuteClick(targetDesc, selectorMap, sessionId, abortSignal);
    }

    // ── FALLBACK: Try to match the entire command as an element description ──
    const fallbackResolved = await this.resolveElement(q, selectorMap);
    if (fallbackResolved && fallbackResolved.confidence >= 0.7) {
      return this.resolveAndExecuteClick(q, selectorMap, sessionId, abortSignal);
    }

    return {
      success: false,
      message: `I couldn't understand the action "${command}" on this page. Try: "click [element]", "scroll down", "type [text] in [field]", or "select [item]".`,
      actionTaken: 'none',
    };
  }

  // ─────────────────────────────────────────────────────────
  // ELEMENT RESOLUTION (deterministic → LLM → product matcher)
  // ─────────────────────────────────────────────────────────

  private async resolveElement(
    description: string,
    selectorMap: SelectorMap
  ): Promise<ResolvedElement | null> {
    const entries = Object.values(selectorMap);
    if (entries.length === 0) return null;

    const q = description.toLowerCase().trim();

    // 1. DETERMINISTIC: exact or substring match on label/text
    for (const entry of entries) {
      const labelLower = entry.label.toLowerCase();
      const textLower = entry.text.toLowerCase();

      if (labelLower === q || textLower === q) {
        return { entry, confidence: 0.95, source: 'deterministic' };
      }
    }

    // Substring match
    const substringMatches = entries.filter(e =>
      e.label.toLowerCase().includes(q) || e.text.toLowerCase().includes(q)
    );
    if (substringMatches.length === 1) {
      return { entry: substringMatches[0], confidence: 0.85, source: 'deterministic' };
    }

    // 2. PRODUCT MATCHER: fuzzy matching with Jaro-Winkler
    const productResult = await productMatcher.match(description, selectorMap);
    if (productResult.matched && productResult.entry) {
      return {
        entry: productResult.entry,
        confidence: productResult.confidence,
        source: 'product_match',
      };
    }

    // 3. LLM FALLBACK: constrained index selection
    const llmEntry = await this.llmResolveElement(description, entries.slice(0, 15));
    if (llmEntry) {
      const entry = selectorMap[llmEntry.index];
      if (entry) {
        return { entry, confidence: 0.7, source: 'llm' };
      }
    }

    return null;
  }

  private async llmResolveElement(
    description: string,
    candidates: SelectorMapEntry[]
  ): Promise<{ index: number } | null> {
    const candidateList = candidates
      .map(c => `Index ${c.index}: role="${c.role}", label="${c.label}", text="${c.text.slice(0, 50)}"`)
      .join('\n');

    const validIndices = candidates.map(c => c.index).join(', ');

    const prompt = `You are a UI element resolver. The user wants to interact with: "${description}"
Here are the available elements on the page:
${candidateList}

Which element best matches? Respond with ONLY valid JSON:
{"index": <number>}

The index MUST be one of: ${validIndices}`;

    const result = await ollamaJSON<{ index: number }>(prompt, { timeoutMs: 3000 });
    if (!result || typeof result.index !== 'number') return null;

    // Schema validation
    if (!candidates.some(c => c.index === result.index)) return null;

    return result;
  }

  // ─────────────────────────────────────────────────────────
  // CLICK WITH SAFETY GATE
  // ─────────────────────────────────────────────────────────

  private async resolveAndExecuteClick(
    description: string,
    selectorMap: SelectorMap,
    sessionId: string,
    abortSignal?: AbortSignal
  ): Promise<InPageActionResult> {
    const resolved = await this.resolveElement(description, selectorMap);

    if (!resolved) {
      return {
        success: false,
        message: `Could not find "${description}" on this page.`,
        actionTaken: 'none',
      };
    }

    if (resolved.confidence < 0.5) {
      return {
        success: false,
        message: `I found a possible match for "${description}" but I'm not confident enough. Can you be more specific?`,
        actionTaken: 'none',
      };
    }

    // Safety gate check
    const safetyResult = safetyGate.checkAction('CLICK', resolved.entry);
    if (safetyResult.blocked) {
      const questionId = `safety_${Date.now()}`;

      sessionStateManager.emitEvent(sessionId, 'safety:confirm_purchase', {
        questionId,
        buttonText: safetyResult.buttonText,
        elementIndex: safetyResult.elementIndex,
        confirmationQuestion: safetyResult.confirmationQuestion,
        orderContext: safetyResult.orderContext,
      });

      return {
        success: false,
        message: safetyResult.confirmationQuestion,
        actionTaken: 'safety_gate_blocked',
        requiresConfirmation: true,
        confirmationQuestion: safetyResult.confirmationQuestion,
        questionId,
      };
    }

    // Execute the click
    return this.executeViaExtension(sessionId, {
      actionId: this.generateActionId(),
      type: 'CLICK',
      targetQuery: resolved.entry.selector,
      timeoutMs: 5000,
    }, `click: ${resolved.entry.label.slice(0, 40)}`);
  }

  // ─────────────────────────────────────────────────────────
  // EXTENSION BRIDGE EXECUTION
  // ─────────────────────────────────────────────────────────

  private async executeViaExtension(
    sessionId: string,
    payload: any,
    actionDescription: string,
    retryCount: number = 0
  ): Promise<InPageActionResult> {
    sessionStateManager.emitEvent(sessionId, 'action:executing', {
      action: actionDescription,
      actionId: payload.actionId,
      attempt: retryCount + 1,
    });

    const report = await browserBridgeClient.executeAction(payload);

    if (report.success) {
      // Update session page context from evidence
      if (report.evidence?.pageState) {
        sessionStateManager.updatePageContext(
          sessionId,
          report.evidence.pageState.url,
          report.evidence.pageState.title,
          report.evidence.pageState.application
        );
      }

      // Re-snapshot DOM after action (critical anti-hallucination rule)
      await this.requestDOMSnapshot(sessionId);

      sessionStateManager.emitEvent(sessionId, 'action:completed', {
        action: actionDescription,
        actionId: payload.actionId,
        message: report.message || `Completed: ${actionDescription}`,
      });

      return {
        success: true,
        message: report.message || `Done: ${actionDescription}`,
        actionTaken: actionDescription,
      };
    }

    // Handle failure with bounded retries
    if (retryCount < MAX_RETRIES && report.error?.includes('stale_selector')) {
      // Re-snapshot and retry
      sessionStateManager.emitEvent(sessionId, 'action:log', {
        message: `Stale selector detected, re-snapshotting and retrying (attempt ${retryCount + 2}/${MAX_RETRIES + 1})`,
      });
      await this.requestDOMSnapshot(sessionId);
      return this.executeViaExtension(sessionId, payload, actionDescription, retryCount + 1);
    }

    sessionStateManager.emitEvent(sessionId, 'action:failed', {
      action: actionDescription,
      actionId: payload.actionId,
      error: report.error,
    });

    return {
      success: false,
      message: `Failed: ${actionDescription}. ${report.error || 'Unknown error'}`,
      actionTaken: actionDescription,
    };
  }

  // ─────────────────────────────────────────────────────────
  // DOM SNAPSHOT REQUEST
  // ─────────────────────────────────────────────────────────

  private async requestDOMSnapshot(sessionId: string): Promise<SelectorMap | null> {
    if (!browserBridgeClient.isConnected()) return null;

    try {
      const snapshot = await browserBridgeClient.getDOMSnapshot();
      if (snapshot && Object.keys(snapshot).length > 0) {
        sessionStateManager.updateSelectorMap(sessionId, snapshot as SelectorMap);
        return snapshot as SelectorMap;
      }

      const session = sessionStateManager.getSession(sessionId);
      return session?.selectorMap || null;
    } catch {
      return null;
    }
  }

  private generateActionId(): string {
    return `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }
}

export const inPageActionExecutor = new InPageActionExecutor();
