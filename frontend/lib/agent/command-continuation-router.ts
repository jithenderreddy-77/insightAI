// frontend/lib/agent/command-continuation-router.ts
// Command Continuation Classification Engine

export type CommandClassification =
  | 'NEW_TASK'
  | 'CONTINUATION'
  | 'MODIFICATION'
  | 'REFERENCE'
  | 'NAVIGATION'
  | 'CANCELLATION';

export interface ClassificationResult {
  classification: CommandClassification;
  reason: string;
  shouldResetContext: boolean;
}

export class CommandContinuationRouter {
  public classify(rawQuery: string, currentApp?: string): ClassificationResult {
    const q = rawQuery.toLowerCase().trim();

    // 1. Cancellation / Stop
    if (/^(stop|cancel|exit|quit|never\s*mind|pause|wait|close\s*assistant)$/i.test(q)) {
      return {
        classification: 'CANCELLATION',
        reason: 'Explicit cancellation command',
        shouldResetContext: true,
      };
    }

    // 2. Navigation / Back
    if (/^(go\s+back|return|previous\s+page|take\s+me\s+back|back)$/i.test(q)) {
      return {
        classification: 'NAVIGATION',
        reason: 'Back navigation requested',
        shouldResetContext: false,
      };
    }

    // 3. Modification ("Actually, search for Java instead")
    if (/\b(actually|instead|no\s+wait|change\s+that\s+to|rather)\b/i.test(q)) {
      return {
        classification: 'MODIFICATION',
        reason: 'User modified previous instruction',
        shouldResetContext: false,
      };
    }

    // 4. Reference / Selection ("the second one", "open this", "send him this")
    if (/\b(this|that|it|him|her|them|the\s+1st|the\s+2nd|the\s+first|the\s+second|the\s+third)\b/i.test(q)) {
      return {
        classification: 'REFERENCE',
        reason: 'Anaphora or candidate reference detected',
        shouldResetContext: false,
      };
    }

    // 5. Continuation within current app context ("search for Python", "go to messages", "scroll down")
    if (
      currentApp &&
      currentApp !== 'Insight AI' &&
      !/^(open|launch|go\s+to)\s+(youtube|whatsapp|instagram|spotify|github|gmail|amazon|flipkart)\b/i.test(q)
    ) {
      return {
        classification: 'CONTINUATION',
        reason: 'Command executes within active app session',
        shouldResetContext: false,
      };
    }

    // 6. Default to New Task if opening a totally new app or subject
    return {
      classification: 'NEW_TASK',
      reason: 'New task or standalone request',
      shouldResetContext: false,
    };
  }
}

export const commandContinuationRouter = new CommandContinuationRouter();
