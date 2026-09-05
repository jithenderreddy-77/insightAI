// frontend/lib/agent/product-matcher.ts
// ╔═══════════════════════════════════════════════════════════════╗
// ║  Product Selection by Description                             ║
// ║  Matches spoken descriptions against DOM selector map entries ║
// ║  Deterministic fuzzy-match first → LLM fallback → HITL       ║
// ╚═══════════════════════════════════════════════════════════════╝

import type { SelectorMapEntry } from './session-state';
import { ollamaJSON } from './ollama-client';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface ProductMatchResult {
  matched: boolean;
  entry?: SelectorMapEntry;
  confidence: number;
  source: 'deterministic' | 'llm' | 'disambiguation_needed';
  topCandidates?: Array<{ index: number; label: string; score: number }>;
  disambiguationQuestion?: string;
}

interface ParsedProductDescription {
  keywords: string[];
  color?: string;
  ordinal?: number; // "the second one" → 2
  priceHint?: string; // "under 500", "cheapest"
}

// ─────────────────────────────────────────────────────────
// COLOR KEYWORDS
// ─────────────────────────────────────────────────────────

const COLORS = new Set([
  'black', 'white', 'red', 'blue', 'green', 'yellow', 'pink', 'purple',
  'orange', 'brown', 'grey', 'gray', 'silver', 'gold', 'navy', 'beige',
  'maroon', 'teal', 'coral', 'ivory', 'khaki',
]);

// ─────────────────────────────────────────────────────────
// ORDINAL PARSING
// ─────────────────────────────────────────────────────────

const ORDINAL_MAP: Record<string, number> = {
  'first': 1, '1st': 1, 'one': 1,
  'second': 2, '2nd': 2, 'two': 2,
  'third': 3, '3rd': 3, 'three': 3,
  'fourth': 4, '4th': 4, 'four': 4,
  'fifth': 5, '5th': 5, 'five': 5,
  'sixth': 6, '6th': 6, 'last': -1,
};

// ─────────────────────────────────────────────────────────
// JARO-WINKLER SIMILARITY
// ─────────────────────────────────────────────────────────

function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1.length || !s2.length) return 0.0;

  const maxDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler boost for common prefix (up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

// ─────────────────────────────────────────────────────────
// DESCRIPTION PARSER
// ─────────────────────────────────────────────────────────

function parseDescription(description: string): ParsedProductDescription {
  const q = description.toLowerCase().trim();
  const words = q.split(/\s+/);

  const result: ParsedProductDescription = { keywords: [] };

  for (const word of words) {
    if (COLORS.has(word)) {
      result.color = word;
    } else if (ORDINAL_MAP[word] !== undefined) {
      result.ordinal = ORDINAL_MAP[word];
    } else if (['the', 'a', 'an', 'one', 'that', 'this', 'select', 'pick', 'choose', 'get'].includes(word)) {
      // Skip filler words
    } else {
      result.keywords.push(word);
    }
  }

  // Check for price hints
  const priceMatch = q.match(/(?:under|below|less\s+than|cheaper\s+than|max|cheapest|most\s+expensive|budget)\s*\$?\s*(\d+)?/);
  if (priceMatch) {
    result.priceHint = priceMatch[0];
  }

  return result;
}

// ─────────────────────────────────────────────────────────
// PRODUCT MATCHER
// ─────────────────────────────────────────────────────────

export class ProductMatcher {
  private confidenceThreshold = 0.8;
  private disambiguationThreshold = 0.5;

  /**
   * Match a spoken product description against the current selector map.
   *
   * 1. Parse description into structured filters
   * 2. Score each selector map entry (Jaro-Winkler + color bonus + ordinal)
   * 3. If clear winner (≥0.8): return it
   * 4. If ambiguous (0.5–0.8, multiple close candidates): ask disambiguation question
   * 5. If no match (<0.5): try LLM fallback, then report not found
   */
  public async match(
    description: string,
    selectorMap: Record<number, SelectorMapEntry>
  ): Promise<ProductMatchResult> {
    const parsed = parseDescription(description);
    const entries = Object.values(selectorMap);

    if (entries.length === 0) {
      return { matched: false, confidence: 0, source: 'deterministic' };
    }

    // Handle ordinal selection ("the second one", "the third product")
    if (parsed.ordinal !== undefined) {
      const ordinalIdx = parsed.ordinal === -1 ? entries.length - 1 : parsed.ordinal - 1;
      if (ordinalIdx >= 0 && ordinalIdx < entries.length) {
        return {
          matched: true,
          entry: entries[ordinalIdx],
          confidence: 0.95,
          source: 'deterministic',
        };
      }
    }

    // Score each entry
    const scored = entries.map(entry => {
      const labelLower = entry.label.toLowerCase();
      const textLower = entry.text.toLowerCase();
      const combined = `${labelLower} ${textLower}`;

      let score = 0;

      // Keyword similarity (Jaro-Winkler against label and text)
      if (parsed.keywords.length > 0) {
        const keywordStr = parsed.keywords.join(' ');
        const labelSim = jaroWinkler(keywordStr, labelLower);
        const textSim = jaroWinkler(keywordStr, textLower);
        score = Math.max(labelSim, textSim);

        // Bonus for substring containment
        if (combined.includes(keywordStr)) score = Math.max(score, 0.85);
        // Bonus for all individual keywords present
        const allPresent = parsed.keywords.every(kw => combined.includes(kw));
        if (allPresent && parsed.keywords.length >= 2) score = Math.max(score, 0.8);
      }

      // Color bonus
      if (parsed.color && combined.includes(parsed.color)) {
        score += 0.15;
      }

      return { index: entry.index, label: entry.label, score: Math.min(score, 1.0) };
    });

    scored.sort((a, b) => b.score - a.score);

    const topMatch = scored[0];
    const secondMatch = scored.length > 1 ? scored[1] : null;

    // Clear winner
    if (topMatch.score >= this.confidenceThreshold) {
      return {
        matched: true,
        entry: selectorMap[topMatch.index],
        confidence: topMatch.score,
        source: 'deterministic',
      };
    }

    // Ambiguous: top two are close
    if (
      topMatch.score >= this.disambiguationThreshold &&
      secondMatch &&
      topMatch.score - secondMatch.score < 0.15
    ) {
      const topCandidates = scored.slice(0, 3).filter(s => s.score >= this.disambiguationThreshold);
      const options = topCandidates.map((c, i) => `${i + 1}. "${c.label}"`).join(', ');

      return {
        matched: false,
        confidence: topMatch.score,
        source: 'disambiguation_needed',
        topCandidates,
        disambiguationQuestion: `I found multiple matches: ${options}. Which one did you mean?`,
      };
    }

    // Low confidence: try LLM fallback
    if (topMatch.score >= 0.3) {
      const llmResult = await this.tryLLMMatch(description, scored.slice(0, 5), selectorMap);
      if (llmResult) return llmResult;
    }

    return {
      matched: false,
      confidence: topMatch.score,
      source: 'deterministic',
      topCandidates: scored.slice(0, 3),
    };
  }

  private async tryLLMMatch(
    description: string,
    candidates: Array<{ index: number; label: string; score: number }>,
    selectorMap: Record<number, SelectorMapEntry>
  ): Promise<ProductMatchResult | null> {
    const candidateList = candidates
      .map(c => `Index ${c.index}: "${c.label}"`)
      .join('\n');

    const prompt = `You are a product matching assistant. The user said: "${description}"
Here are the available items on the page:
${candidateList}

Which item best matches the user's description? Respond with ONLY valid JSON:
{"index": <number>}

The index MUST be one of: ${candidates.map(c => c.index).join(', ')}`;

    const result = await ollamaJSON<{ index: number }>(prompt, { timeoutMs: 3000 });
    if (!result || typeof result.index !== 'number') return null;

    // Schema validation: index must be one of the candidates
    if (!candidates.some(c => c.index === result.index)) return null;

    const entry = selectorMap[result.index];
    if (!entry) return null;

    return {
      matched: true,
      entry,
      confidence: 0.75,
      source: 'llm',
    };
  }
}

export const productMatcher = new ProductMatcher();
