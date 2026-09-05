// frontend/lib/agent/safety-gate.ts
// ╔═══════════════════════════════════════════════════════════════╗
// ║  Payment / Final-Submission Safety Gate                       ║
// ║  ALWAYS pauses before financial transactions and OTP entry    ║
// ║  This is the one rule nothing else in the system overrides.   ║
// ╚═══════════════════════════════════════════════════════════════╝

import type { SelectorMapEntry } from './session-state';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export type SafetyGateResult =
  | { blocked: false }
  | {
      blocked: true;
      reason: 'payment_confirmation' | 'otp_entry';
      buttonText: string;
      elementIndex: number;
      elementSelector: string;
      confirmationQuestion: string;
      orderContext?: string; // Visible text near the button for context
    };

// ─────────────────────────────────────────────────────────
// PAYMENT BUTTON PATTERNS (case-insensitive)
// ─────────────────────────────────────────────────────────

const PAYMENT_PATTERNS = [
  /place\s+order/i,
  /pay\s+now/i,
  /confirm\s+purchase/i,
  /submit\s+payment/i,
  /buy\s+now/i,
  /complete\s+purchase/i,
  /proceed\s+to\s+pay/i,
  /confirm\s+order/i,
  /confirm\s+and\s+pay/i,
  /make\s+payment/i,
  /submit\s+order/i,
  /finalize\s+order/i,
  /complete\s+order/i,
  /pay\s+\$/i,        // "Pay $XX.XX"
  /pay\s+₹/i,        // "Pay ₹XX"
  /pay\s+\d/i,        // "Pay 500"
  /proceed\s+to\s+checkout/i,
];

// ─────────────────────────────────────────────────────────
// OTP / VERIFICATION PATTERNS
// ─────────────────────────────────────────────────────────

const OTP_PATTERNS = [
  /otp/i,
  /verification\s*code/i,
  /verify\s*code/i,
  /security\s*code/i,
  /one\s*time\s*password/i,
  /enter\s*(the\s+)?code/i,
  /confirmation\s*code/i,
];

// ─────────────────────────────────────────────────────────
// SAFETY GATE
// ─────────────────────────────────────────────────────────

export class SafetyGate {
  /**
   * Check whether an action targeting a specific element should be blocked
   * and require explicit user confirmation.
   *
   * This method is called BEFORE every click/type action.
   * Payment buttons and OTP fields ALWAYS block, regardless of model confidence.
   */
  public checkAction(
    actionType: string,
    targetEntry: SelectorMapEntry,
    nearbyText?: string
  ): SafetyGateResult {
    const labelLower = targetEntry.label.toLowerCase();
    const textLower = targetEntry.text.toLowerCase();
    const combined = `${labelLower} ${textLower}`;

    // ── PAYMENT BUTTON CHECK ──
    if (actionType === 'CLICK' || actionType === 'click') {
      for (const pattern of PAYMENT_PATTERNS) {
        if (pattern.test(combined)) {
          return {
            blocked: true,
            reason: 'payment_confirmation',
            buttonText: targetEntry.label || targetEntry.text,
            elementIndex: targetEntry.index,
            elementSelector: targetEntry.selector,
            confirmationQuestion: `I'm about to click "${targetEntry.label || targetEntry.text}". This looks like a payment/purchase action. Should I proceed?`,
            orderContext: nearbyText?.slice(0, 200),
          };
        }
      }
    }

    // ── OTP / VERIFICATION FIELD CHECK ──
    if (actionType === 'TYPE' || actionType === 'type' || actionType === 'FILL_FORM') {
      for (const pattern of OTP_PATTERNS) {
        if (pattern.test(combined)) {
          return {
            blocked: true,
            reason: 'otp_entry',
            buttonText: targetEntry.label || targetEntry.text,
            elementIndex: targetEntry.index,
            elementSelector: targetEntry.selector,
            confirmationQuestion: `This field appears to be for a verification code or OTP. Please provide the code you received.`,
          };
        }
      }
    }

    return { blocked: false };
  }

  /**
   * Check if a user's confirmation answer means "yes, proceed".
   */
  public isConfirmation(answer: string): boolean {
    const q = answer.toLowerCase().trim();
    const yesPatterns = [
      'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'go ahead',
      'proceed', 'confirm', 'do it', 'go for it', 'affirmative',
      'please proceed', 'yes please', 'continue',
    ];
    return yesPatterns.some(p => q === p || q.startsWith(p));
  }

  /**
   * Check if a user's answer means "no, stop".
   */
  public isDenial(answer: string): boolean {
    const q = answer.toLowerCase().trim();
    const noPatterns = [
      'no', 'nope', 'don\'t', 'stop', 'cancel', 'abort', 'wait',
      'hold on', 'not yet', 'no thanks', 'never mind',
    ];
    return noPatterns.some(p => q === p || q.startsWith(p));
  }
}

export const safetyGate = new SafetyGate();
