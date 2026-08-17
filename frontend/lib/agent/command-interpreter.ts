// frontend/lib/agent/command-interpreter.ts
// Context-Relative Intent & Anaphora / Pronoun Resolver

import { taskContextManager, CombinedAgentContext } from './task-context';
import { UIEntity } from './agent-types';

export interface InterpretedCommand {
  rawCommand: string;
  normalizedCommand: string;
  intent: string;
  targetApp?: string;
  targetEntity?: UIEntity;
  resolvedPronouns: Record<string, string | UIEntity>;
  isContinuation: boolean;
  confidence: number;
}

export class CommandInterpreter {
  /**
   * Interpret a user command in the context of the active screen and conversation context.
   */
  public interpret(rawCommand: string, context?: CombinedAgentContext): InterpretedCommand {
    const ctx = context || taskContextManager.getCombinedContext();
    const q = rawCommand.toLowerCase().trim();

    const resolvedPronouns: Record<string, string | UIEntity> = {};
    let isContinuation = false;
    let intent = 'UNKNOWN';
    let targetApp = ctx.ui.currentApplication;
    let targetEntity: UIEntity | undefined = ctx.ui.selectedItem;

    // 1. Ordinal/Candidate index selection ("the 1st one", "the second one", "2nd")
    const candidateList = ctx.conversation.candidateDisambiguationList;
    const ordinalMatch = q.match(/\b(the\s+)?(1st|first|one|2nd|second|two|3rd|third|three|4th|fourth|four|5th|fifth|five)\b/i);

    if (ordinalMatch && candidateList.length > 0) {
      const ordinalMap: Record<string, number> = {
        '1st': 0, 'first': 0, 'one': 0,
        '2nd': 1, 'second': 1, 'two': 1,
        '3rd': 2, 'third': 2, 'three': 2,
        '4th': 3, 'fourth': 3, 'four': 3,
        '5th': 4, 'fifth': 4, 'five': 4,
      };
      const idx = ordinalMap[ordinalMatch[2].toLowerCase()];
      if (idx !== undefined && idx < candidateList.length) {
        targetEntity = candidateList[idx];
        resolvedPronouns['selection'] = targetEntity;
        intent = 'SELECT_CANDIDATE';
        isContinuation = true;
      }
    }

    // 2. Anaphora / Pronoun Resolution ("this", "that", "it", "him", "her", "them", "this reel", "this video")
    if (/\b(this|that|it|this reel|this video|this post|this page)\b/i.test(q)) {
      if (ctx.ui.selectedItem) {
        resolvedPronouns['this'] = ctx.ui.selectedItem;
        targetEntity = ctx.ui.selectedItem;
      } else {
        resolvedPronouns['this'] = 'CURRENT_VISIBLE_CONTENT';
      }
      isContinuation = true;
    }

    if (/\b(him|her|them|his|her|their|that person|the person i selected)\b/i.test(q)) {
      const rememberedPerson = taskContextManager.getRememberedEntity('contact') || ctx.ui.selectedItem;
      if (rememberedPerson) {
        resolvedPronouns['him'] = rememberedPerson;
        targetEntity = rememberedPerson;
      }
      isContinuation = true;
    }

    // 3. Navigation intents relative to current app ("go to messages", "open search", "go back")
    if (/^(go\s+to|open)\s+(messages|chat|inbox|dm|direct\s+messages)\b/i.test(q)) {
      intent = 'NAVIGATE_MESSAGES';
      isContinuation = true;
    } else if (/^(go\s+to|open)\s+(reels|videos|feed|explore|home)\b/i.test(q)) {
      intent = 'NAVIGATE_SECTION';
      isContinuation = true;
    } else if (/\b(go\s+back|return|previous\s+page|take\s+me\s+back)\b/i.test(q)) {
      intent = 'GO_BACK';
      isContinuation = true;
    } else if (/\b(share|send\s+this|share\s+this)\b/i.test(q)) {
      intent = 'SHARE_CONTENT';
      isContinuation = true;
    } else if (/\b(scroll\s+down|scroll\s+up|next\s+reel|show\s+more)\b/i.test(q)) {
      intent = 'SCROLL';
      isContinuation = true;
    } else if (/^(open|launch|go\s+to)\s+([a-z0-9\s]+)/i.test(q)) {
      const appMatch = q.match(/^(open|launch|go\s+to)\s+([a-z0-9\s]+)/i);
      if (appMatch && appMatch[2]) {
        targetApp = appMatch[2].trim();
        intent = 'OPEN_APP';
      }
    }

    return {
      rawCommand,
      normalizedCommand: q,
      intent,
      targetApp,
      targetEntity,
      resolvedPronouns,
      isContinuation,
      confidence: 0.92,
    };
  }
}

export const commandInterpreter = new CommandInterpreter();
