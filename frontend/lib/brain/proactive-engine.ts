// frontend/lib/brain/proactive-engine.ts
// Background Intelligence Layer
// Provides contextual greetings, habit-based suggestions, and smart prompts
// based on time-of-day, usage patterns, and stored preferences.

import { getPreferences, getMemoriesByCategory, type UserPreferences } from './memory-manager';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface ProactiveInsight {
  type: 'greeting' | 'suggestion' | 'reminder' | 'briefing';
  message: string;
  priority: 'low' | 'medium' | 'high';
  /** Optional action the user can take */
  suggestedAction?: {
    label: string;
    transcript: string; // Simulated voice command to execute
  };
}

// ─────────────────────────────────────────────────────────
// CONTEXTUAL GREETING GENERATOR
// ─────────────────────────────────────────────────────────

/**
 * Generate a personalized greeting based on time, user name, and preferences.
 */
export function generateGreeting(userName: string): string {
  const hour = new Date().getHours();
  const prefs = getPreferences();
  const name = prefs.nickname || userName || 'friend';
  const style = prefs.wakeGreetingStyle || 'energetic';

  if (style === 'brief') {
    if (hour < 12) return `Morning, ${name}.`;
    if (hour < 17) return `Hey, ${name}.`;
    if (hour < 21) return `Evening, ${name}.`;
    return `Hey, ${name}.`;
  }

  if (style === 'energetic') {
    if (hour < 5) return `Burning the midnight oil, ${name}? I'm here if you need me.`;
    if (hour < 9) return `Good morning, ${name}! Ready to take on the day? What can I do for you?`;
    if (hour < 12) return `Hey ${name}! What's on your mind?`;
    if (hour < 14) return `Good afternoon, ${name}! How can I help?`;
    if (hour < 17) return `Hey ${name}, what would you like me to do?`;
    if (hour < 21) return `Good evening, ${name}! How was your day? What do you need?`;
    return `Still going strong, ${name}? What can I help with tonight?`;
  }

  // 'detailed' style
  if (hour < 5) return `It's late, ${name}. I'm still here if you need anything. What can I do?`;
  if (hour < 9) return `Good morning, ${name}! It's a new day. I can search the web, open apps, manage contacts, or answer questions. What would you like?`;
  if (hour < 12) return `Hey ${name}! I'm your AI assistant, Insight. Ask me anything or give me a command.`;
  if (hour < 17) return `Good afternoon, ${name}! Ready to help with whatever you need.`;
  if (hour < 21) return `Good evening, ${name}! I'm here to help. What's on your mind?`;
  return `Hey ${name}, winding down? I'm still at your service.`;
}

// ─────────────────────────────────────────────────────────
// PROACTIVE SUGGESTIONS
// ─────────────────────────────────────────────────────────

/**
 * Generate contextual suggestions based on time, habits, and recent activity.
 * Returns up to 3 suggestions.
 */
export function generateSuggestions(): ProactiveInsight[] {
  const insights: ProactiveInsight[] = [];
  const hour = new Date().getHours();
  const prefs = getPreferences();
  const habits = getMemoriesByCategory('habit');

  // Morning briefing suggestion
  if (hour >= 6 && hour <= 9) {
    insights.push({
      type: 'suggestion',
      message: '☀️ Want a morning briefing? I can check the news and weather for you.',
      priority: 'medium',
      suggestedAction: {
        label: 'Get briefing',
        transcript: "What's the latest news and weather today?",
      },
    });
  }

  // Favorite apps suggestion based on common usage
  if (prefs.favoriteApps.length > 0) {
    const topApp = prefs.favoriteApps[0];
    insights.push({
      type: 'suggestion',
      message: `📱 Open ${topApp}?`,
      priority: 'low',
      suggestedAction: {
        label: `Open ${topApp}`,
        transcript: `Open ${topApp}`,
      },
    });
  }

  // Document analysis suggestion (if context suggests it)
  if (hour >= 9 && hour <= 18) {
    insights.push({
      type: 'suggestion',
      message: '📄 Upload a document and I can analyze, summarize, or answer questions about it.',
      priority: 'low',
      suggestedAction: {
        label: 'Upload document',
        transcript: 'Upload a document',
      },
    });
  }

  // Evening wind-down
  if (hour >= 20) {
    insights.push({
      type: 'suggestion',
      message: '🎵 Want me to play some music on YouTube or Spotify?',
      priority: 'low',
      suggestedAction: {
        label: 'Play music',
        transcript: 'Play lofi hip hop on YouTube',
      },
    });
  }

  return insights.slice(0, 3);
}

// ─────────────────────────────────────────────────────────
// USAGE PATTERN TRACKING
// ─────────────────────────────────────────────────────────

const USAGE_PATTERN_KEY = 'insight_usage_patterns';

interface UsageEntry {
  command: string;
  hour: number;
  day: number; // 0=Sun, 6=Sat
  timestamp: number;
}

/**
 * Track a voice command for habit learning.
 */
export function trackUsage(command: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    const now = new Date();
    const patterns: UsageEntry[] = JSON.parse(localStorage.getItem(USAGE_PATTERN_KEY) || '[]');
    
    patterns.push({
      command: command.toLowerCase().slice(0, 100),
      hour: now.getHours(),
      day: now.getDay(),
      timestamp: Date.now(),
    });

    // Keep only last 200 entries
    const trimmed = patterns.slice(-200);
    localStorage.setItem(USAGE_PATTERN_KEY, JSON.stringify(trimmed));
  } catch {
    // Silent fail — usage tracking is non-critical
  }
}

/**
 * Get the most common commands at the current time of day.
 */
export function getHabitualCommands(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const patterns: UsageEntry[] = JSON.parse(localStorage.getItem(USAGE_PATTERN_KEY) || '[]');
    const currentHour = new Date().getHours();

    // Find commands used at this hour (±1 hour window)
    const relevantEntries = patterns.filter(
      (p) => Math.abs(p.hour - currentHour) <= 1,
    );

    // Count frequency
    const freq: Record<string, number> = {};
    for (const entry of relevantEntries) {
      const key = entry.command;
      freq[key] = (freq[key] || 0) + 1;
    }

    // Return top 3 most frequent
    return Object.entries(freq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .filter(([, count]) => count >= 2) // Only suggest if used 2+ times
      .map(([cmd]) => cmd);
  } catch {
    return [];
  }
}
