// frontend/lib/entities/disambiguation-engine.ts
// Multi-Candidate Voice & UI Entity Disambiguation Engine

import { UIEntity } from '../agent/agent-types';

export interface DisambiguationRequest {
  searchTerm: string;
  candidates: UIEntity[];
  promptVoiceMessage: string;
  promptUiTitle: string;
}

export class DisambiguationEngine {
  /**
   * Evaluate a list of candidate entity matches and determine if disambiguation is required.
   */
  public evaluateCandidates(searchTerm: string, candidates: UIEntity[]): DisambiguationRequest | null {
    if (!candidates || candidates.length <= 1) return null;

    const namesList = candidates.slice(0, 4).map((c, i) => `${i + 1}. ${c.name}`).join(', ');
    const promptVoiceMessage = `I found ${candidates.length} matching candidates for "${searchTerm}": ${namesList}. Which one do you mean? Say the number or name.`;
    const promptUiTitle = `❓ Found ${candidates.length} matches for "${searchTerm}"`;

    return {
      searchTerm,
      candidates,
      promptVoiceMessage,
      promptUiTitle,
    };
  }

  /**
   * Resolve a spoken user selection against an active candidate disambiguation list.
   */
  public resolveSelection(spokenResponse: string, candidates: UIEntity[]): UIEntity | undefined {
    if (!candidates || candidates.length === 0) return undefined;

    const q = spokenResponse.toLowerCase().trim();

    // 1. Ordinal selection ("first", "1st", "1", "second", "2nd", "2", etc.)
    const ordinalMap: Record<string, number> = {
      '1': 0, '1st': 0, 'first': 0, 'one': 0,
      '2': 1, '2nd': 1, 'second': 1, 'two': 1,
      '3': 2, '3rd': 2, 'third': 2, 'three': 2,
      '4': 4, '4th': 3, 'fourth': 3, 'four': 3,
    };

    const matchWord = q.replace(/^(the\s+|number\s+)/gi, '').replace(/\s+one$/gi, '').trim();
    const idx = ordinalMap[matchWord];

    if (idx !== undefined && idx < candidates.length) {
      return candidates[idx];
    }

    // 2. Exact or fuzzy name match
    return candidates.find(
      (c) => c.name.toLowerCase() === q || c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase().split(' ')[0])
    );
  }
}

export const disambiguationEngine = new DisambiguationEngine();
