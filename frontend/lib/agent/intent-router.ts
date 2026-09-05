// frontend/lib/agent/intent-router.ts
// ╔═══════════════════════════════════════════════════════════════╗
// ║  Intent Router — NAVIGATION vs IN_PAGE_ACTION classifier     ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Two-tier classification:
//   1. Keyword heuristics (instant, zero-latency, always produces an answer)
//   2. Ollama LLM fallback (only when heuristic confidence < 0.7)
//
// The heuristic tier NEVER blocks. The LLM tier has a 2s hard timeout.
// If Ollama is unreachable, the heuristic result is used as-is.

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export type IntentType = 'NAVIGATION' | 'IN_PAGE_ACTION';

export interface IntentClassification {
  intent: IntentType;
  confidence: number;
  source: 'heuristic' | 'llm' | 'default';
  resolvedTarget?: string; // e.g., "amazon.in" for NAVIGATION or "buy now button" for IN_PAGE_ACTION
  reasoning?: string;
}

interface PageContext {
  currentUrl?: string;
  currentApplication?: string;
  hasActivePage: boolean;
}

// ─────────────────────────────────────────────────────────
// HEURISTIC PATTERNS
// ─────────────────────────────────────────────────────────

// Navigation triggers: commands that mean "go to a new page"
const NAVIGATION_PATTERNS: Array<{ pattern: RegExp; extract?: (match: RegExpMatchArray) => string }> = [
  {
    pattern: /^(open|launch|go\s+to|navigate\s+to|visit|take\s+me\s+to|show\s+me)\s+(.+)/i,
    extract: (m) => m[2].trim(),
  },
  { pattern: /^(search\s+for|search|find|look\s+up|google)\s+(.+)/i, extract: (m) => m[2].trim() },
  { pattern: /^(open|go\s+to)\s+(youtube|amazon|flipkart|gmail|google|instagram|whatsapp|spotify|github|twitter|facebook|reddit|linkedin)\b/i },
];

// In-page action triggers: commands that operate on the currently visible page
const IN_PAGE_PATTERNS: RegExp[] = [
  /^scroll\s+(down|up|to\s+top|to\s+bottom|to\s+the\s+)/i,
  /^click\s+(on\s+)?(.+)/i,
  /^(select|choose|pick)\s+(the\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|\d+)\s*(one|option|result|item|product)?/i,
  /^(select|choose|pick)\s+(.+)/i,
  /^(type|enter|fill\s+in|input|write)\s+(.+)/i,
  /^add\s+(it|this|that)?\s*to\s+(cart|bag|basket|wishlist)/i,
  /^(buy\s+now|checkout|proceed\s+to\s+checkout|place\s+order|pay\s+now|confirm\s+purchase)/i,
  /^(go\s+back|back|return|previous\s+page)/i,
  /^(the\s+)?(black|white|red|blue|green|first|second|third|last|big|small|cheap)\s+(one|option|product|item|result)/i,
  /^(fill|complete|submit)\s+(the\s+)?(form|checkout|details|information)/i,
  /^(search|look)\s+(on\s+this\s+page|here)\s+/i,
];

// Known website/app names (helps disambiguate "search X" = navigation vs in-page)
const KNOWN_SITES = new Set([
  'youtube', 'amazon', 'flipkart', 'google', 'gmail', 'instagram',
  'whatsapp', 'spotify', 'github', 'twitter', 'facebook', 'reddit',
  'linkedin', 'netflix', 'wikipedia', 'stackoverflow', 'amazon.in',
]);

// ─────────────────────────────────────────────────────────
// HEURISTIC CLASSIFIER
// ─────────────────────────────────────────────────────────

function classifyHeuristic(command: string, context: PageContext): IntentClassification {
  const q = command.toLowerCase().trim();

  // 1. Check explicit in-page patterns first (higher priority when on an active page)
  for (const pattern of IN_PAGE_PATTERNS) {
    if (pattern.test(q)) {
      return {
        intent: 'IN_PAGE_ACTION',
        confidence: 0.9,
        source: 'heuristic',
        resolvedTarget: q,
        reasoning: `Matched in-page pattern: ${pattern.source.slice(0, 40)}`,
      };
    }
  }

  // 2. Check navigation patterns
  for (const { pattern, extract } of NAVIGATION_PATTERNS) {
    const match = q.match(pattern);
    if (match) {
      const target = extract ? extract(match) : match[2] || '';

      // "search for wireless earbuds" on an active page is in-page, not navigation
      // But "search for wireless earbuds" with no active page is navigation
      if (/^(search\s+for|search|find)\s+/i.test(q) && context.hasActivePage) {
        // Check if the search target is a known site name
        const targetWords = target.toLowerCase().split(/\s+/);
        const isKnownSite = targetWords.some(w => KNOWN_SITES.has(w));

        if (!isKnownSite) {
          return {
            intent: 'IN_PAGE_ACTION',
            confidence: 0.75,
            source: 'heuristic',
            resolvedTarget: target,
            reasoning: `"search" on active page interpreted as in-page search for "${target}"`,
          };
        }
      }

      return {
        intent: 'NAVIGATION',
        confidence: 0.9,
        source: 'heuristic',
        resolvedTarget: target,
        reasoning: `Matched navigation pattern: ${pattern.source.slice(0, 40)}`,
      };
    }
  }

  // 3. Default based on context
  if (context.hasActivePage) {
    // If there's an active page and the command doesn't match navigation,
    // assume in-page action (the user is likely talking about the current page)
    return {
      intent: 'IN_PAGE_ACTION',
      confidence: 0.55,
      source: 'default',
      resolvedTarget: q,
      reasoning: 'No pattern match, defaulting to IN_PAGE_ACTION because there is an active page',
    };
  }

  // No active page → default to navigation
  return {
    intent: 'NAVIGATION',
    confidence: 0.55,
    source: 'default',
    resolvedTarget: q,
    reasoning: 'No pattern match and no active page, defaulting to NAVIGATION',
  };
}

// ─────────────────────────────────────────────────────────
// LLM FALLBACK (Ollama Phi-3-mini)
// ─────────────────────────────────────────────────────────

async function classifyWithLLM(
  command: string,
  context: PageContext
): Promise<IntentClassification | null> {
  try {
    const contextDesc = context.hasActivePage
      ? `Currently viewing: ${context.currentApplication || 'a webpage'} at ${context.currentUrl || 'unknown URL'}`
      : 'No page is currently open.';

    const prompt = `You are an intent classifier for a voice-controlled browser assistant.
Classify the following voice command as either NAVIGATION (open a new site/page) or IN_PAGE_ACTION (act on the currently visible page).

Context: ${contextDesc}
Command: "${command}"

Respond with ONLY valid JSON, no other text:
{"intent": "NAVIGATION" or "IN_PAGE_ACTION", "confidence": 0.0-1.0}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s hard timeout

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'phi3:mini',
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 50 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = await response.json();
    const responseText = data.response || '';

    // Extract JSON from response (LLM might wrap it in markdown or extra text)
    const jsonMatch = responseText.match(/\{[^}]+\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // Schema validation: intent must be one of the two allowed values
    if (parsed.intent !== 'NAVIGATION' && parsed.intent !== 'IN_PAGE_ACTION') {
      return null; // Reject invalid output
    }

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.8;

    return {
      intent: parsed.intent,
      confidence,
      source: 'llm',
      reasoning: `LLM classified as ${parsed.intent} with confidence ${confidence}`,
    };
  } catch {
    // Ollama unreachable, timeout, or parse error — fail silently
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────

export class IntentRouter {
  private llmConfidenceThreshold = 0.7;

  /**
   * Classify a voice command as NAVIGATION or IN_PAGE_ACTION.
   *
   * 1. Keyword heuristics run first (instant, always produces a result).
   * 2. If heuristic confidence < threshold, Ollama LLM refines (2s timeout).
   * 3. If LLM fails or is slow, heuristic result is used as-is.
   *
   * This method NEVER blocks the pipeline for more than 2 seconds.
   */
  public async classify(command: string, context: PageContext): Promise<IntentClassification> {
    // Step 1: Instant heuristic classification
    const heuristic = classifyHeuristic(command, context);

    // If heuristic is confident enough, use it directly
    if (heuristic.confidence >= this.llmConfidenceThreshold) {
      return heuristic;
    }

    // Step 2: Low-confidence heuristic → try LLM refinement
    const llmResult = await classifyWithLLM(command, context);

    if (llmResult && llmResult.confidence > heuristic.confidence) {
      return llmResult;
    }

    // LLM failed or wasn't more confident — use heuristic
    return heuristic;
  }

  /**
   * Synchronous-only classification (no LLM, zero latency).
   * Use when you can't afford any async delay.
   */
  public classifySync(command: string, context: PageContext): IntentClassification {
    return classifyHeuristic(command, context);
  }
}

export const intentRouter = new IntentRouter();
