// frontend/lib/brain/memory-manager.ts
// Three-tier memory system for persistent, intelligent recall:
//   1. Working Memory  — current conversation buffer (in-request)
//   2. Short-Term Memory — localStorage facts & preferences (survives refreshes)
//   3. Long-Term Memory — Supabase DB (survives everything, cross-device)

const MEMORY_STORAGE_KEY = 'insight_brain_memories';
const PREFERENCES_STORAGE_KEY = 'insight_brain_preferences';
const MAX_MEMORIES = 500;

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface Memory {
  id: string;
  content: string;
  category: 'preference' | 'fact' | 'interaction' | 'habit' | 'note';
  importance: number; // 1-10 scale
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  source: 'voice' | 'chat' | 'system';
  tags: string[];
}

export interface UserPreferences {
  name: string;
  nickname: string;
  timezone: string;
  preferredLanguage: string;
  voiceSpeed: number;
  voicePersonality: 'formal' | 'casual' | 'playful';
  favoriteApps: string[];
  commonContacts: string[];
  wakeGreetingStyle: 'brief' | 'detailed' | 'energetic';
  /** Custom key-value pairs learned from interactions */
  custom: Record<string, string>;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  name: '',
  nickname: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
  preferredLanguage: 'en',
  voiceSpeed: 1.05,
  voicePersonality: 'casual',
  favoriteApps: [],
  commonContacts: [],
  wakeGreetingStyle: 'energetic',
  custom: {},
};

// ─────────────────────────────────────────────────────────
// STORAGE HELPERS (localStorage — Tier 2: Short-Term)
// ─────────────────────────────────────────────────────────

function isClient(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function getStoredMemories(): Memory[] {
  if (!isClient()) return [];
  try {
    return JSON.parse(localStorage.getItem(MEMORY_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveMemories(memories: Memory[]): void {
  if (!isClient()) return;
  try {
    // Keep only the latest MAX_MEMORIES, prioritized by importance + recency
    const sorted = memories
      .sort((a, b) => {
        const scoreA = a.importance * 2 + a.accessCount;
        const scoreB = b.importance * 2 + b.accessCount;
        return scoreB - scoreA;
      })
      .slice(0, MAX_MEMORIES);
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(sorted));
  } catch (err) {
    console.error('Memory save error:', err);
  }
}

// ─────────────────────────────────────────────────────────
// MEMORY MANAGER PUBLIC API
// ─────────────────────────────────────────────────────────

/**
 * Store a new memory. Automatically deduplicates similar content.
 */
export function remember(
  content: string,
  category: Memory['category'] = 'fact',
  options?: {
    importance?: number;
    source?: Memory['source'];
    tags?: string[];
  },
): Memory {
  const memories = getStoredMemories();

  // Deduplicate: if a very similar memory exists, update it instead
  const existingIndex = memories.findIndex(
    (m) => m.category === category && fuzzyContentMatch(m.content, content),
  );

  if (existingIndex >= 0) {
    const existing = memories[existingIndex];
    existing.content = content; // Update with latest version
    existing.lastAccessedAt = new Date().toISOString();
    existing.accessCount += 1;
    existing.importance = Math.max(existing.importance, options?.importance || 5);
    saveMemories(memories);
    return existing;
  }

  // Create new memory
  const memory: Memory = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content,
    category,
    importance: options?.importance || 5,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 1,
    source: options?.source || 'voice',
    tags: options?.tags || [],
  };

  memories.push(memory);
  saveMemories(memories);
  return memory;
}

/**
 * Retrieve relevant memories for a query using keyword matching.
 * (In Phase 2+, this will use Supabase pgvector for semantic search.)
 */
export function recall(query: string, limit: number = 5): Memory[] {
  const memories = getStoredMemories();
  if (memories.length === 0 || !query) return [];

  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  // Score each memory by relevance
  const scored = memories.map((memory) => {
    const contentLower = memory.content.toLowerCase();
    const categoryLower = memory.category.toLowerCase();

    let score = 0;

    // Keyword matching
    for (const word of queryWords) {
      if (contentLower.includes(word)) score += 3;
      if (memory.tags.some((t) => t.toLowerCase().includes(word))) score += 2;
      if (categoryLower.includes(word)) score += 1;
    }

    // Boost by importance and recency
    score += memory.importance * 0.5;
    const ageHours = (Date.now() - new Date(memory.lastAccessedAt).getTime()) / (1000 * 60 * 60);
    if (ageHours < 1) score += 3;
    else if (ageHours < 24) score += 2;
    else if (ageHours < 168) score += 1;

    // Boost by access frequency
    score += Math.min(memory.accessCount * 0.5, 5);

    return { memory, score };
  });

  // Return top matches
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => {
      // Update last accessed time
      s.memory.lastAccessedAt = new Date().toISOString();
      s.memory.accessCount += 1;
      return s.memory;
    });
}

/**
 * Forget a specific memory by ID.
 */
export function forget(memoryId: string): boolean {
  const memories = getStoredMemories();
  const filtered = memories.filter((m) => m.id !== memoryId);
  if (filtered.length < memories.length) {
    saveMemories(filtered);
    return true;
  }
  return false;
}

/**
 * Get all memories of a specific category.
 */
export function getMemoriesByCategory(category: Memory['category']): Memory[] {
  return getStoredMemories().filter((m) => m.category === category);
}

/**
 * Get total memory count.
 */
export function getMemoryCount(): number {
  return getStoredMemories().length;
}

// ─────────────────────────────────────────────────────────
// USER PREFERENCES
// ─────────────────────────────────────────────────────────

/**
 * Get user preferences (with defaults).
 */
export function getPreferences(): UserPreferences {
  if (!isClient()) return { ...DEFAULT_PREFERENCES };
  try {
    const stored = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) };
    }
  } catch {}
  return { ...DEFAULT_PREFERENCES };
}

/**
 * Update a single preference key.
 */
export function setPreference<K extends keyof UserPreferences>(
  key: K,
  value: UserPreferences[K],
): void {
  if (!isClient()) return;
  const prefs = getPreferences();
  prefs[key] = value;
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.error('Preference save error:', err);
  }
}

/**
 * Set a custom learned preference (e.g., "favorite_color" = "blue").
 */
export function setCustomPreference(key: string, value: string): void {
  const prefs = getPreferences();
  prefs.custom[key] = value;
  setPreference('custom', prefs.custom);

  // Also store as a preference memory for recall
  remember(`User's ${key.replace(/_/g, ' ')} is ${value}`, 'preference', {
    importance: 7,
    tags: [key, 'preference'],
  });
}

/**
 * Get a custom preference value.
 */
export function getCustomPreference(key: string): string | undefined {
  return getPreferences().custom[key];
}

/**
 * Build a context string of relevant memories for the Brain system prompt.
 */
export function buildMemoryContext(query: string): string {
  const relevantMemories = recall(query, 5);
  const preferences = getPreferences();

  const parts: string[] = [];

  // Add preference context
  if (preferences.name) parts.push(`User's name: ${preferences.name}`);
  if (preferences.nickname) parts.push(`Preferred name: ${preferences.nickname}`);

  const customEntries = Object.entries(preferences.custom);
  if (customEntries.length > 0) {
    parts.push('Known preferences:');
    for (const [k, v] of customEntries.slice(0, 10)) {
      parts.push(`  - ${k.replace(/_/g, ' ')}: ${v}`);
    }
  }

  // Add relevant memories
  if (relevantMemories.length > 0) {
    parts.push('Relevant memories:');
    for (const mem of relevantMemories) {
      parts.push(`  - [${mem.category}] ${mem.content}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : '';
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

/**
 * Simple fuzzy content match — checks if two strings are ~80% similar.
 * Used for deduplication.
 */
function fuzzyContentMatch(a: string, b: string): boolean {
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();

  if (aLower === bLower) return true;

  // Check if one contains the other (substring match)
  if (aLower.includes(bLower) || bLower.includes(aLower)) return true;

  // Word overlap check (Jaccard similarity > 0.7)
  const aWords = new Set(aLower.split(/\s+/));
  const bWords = new Set(bLower.split(/\s+/));
  const intersection = new Set([...aWords].filter((w) => bWords.has(w)));
  const union = new Set([...aWords, ...bWords]);

  return union.size > 0 && intersection.size / union.size > 0.7;
}
