// frontend/lib/agent/agent-recovery-engine.ts
// Self-Recovery Engine & Failure Classification

import { FailureCategory, RecoveryStrategy, AgentAction } from './agent-types';

export class AgentRecoveryEngine {
  private retryCounts: Map<string, number> = new Map();
  private stateHashes: Set<string> = new Set();

  /**
   * Classify error into FailureCategory.
   */
  public classifyFailure(error: any, currentUrl?: string): FailureCategory {
    const msg = typeof error === 'string' ? error.toLowerCase() : (error?.message || '').toLowerCase();

    if (msg.includes('network') || msg.includes('offline') || msg.includes('fetch failed')) return 'NETWORK_DELAY';
    if (msg.includes('not found') || msg.includes('missing')) return 'ELEMENT_NOT_FOUND';
    if (msg.includes('login') || msg.includes('sign in') || msg.includes('auth')) return 'LOGIN_REQUIRED';
    if (msg.includes('permission') || msg.includes('denied')) return 'PERMISSION_REQUIRED';
    if (msg.includes('captcha')) return 'CAPTCHA_REQUIRED';
    if (msg.includes('scroll')) return 'SCROLL_FAILURE';
    if (msg.includes('timeout')) return 'TIMEOUT';

    return 'ELEMENT_NOT_FOUND';
  }

  /**
   * Determine recovery strategy for a given failure category.
   */
  public getStrategy(category: FailureCategory, action: AgentAction): RecoveryStrategy {
    const actionKey = `${action.id}_${category}`;
    const retries = (this.retryCounts.get(actionKey) || 0) + 1;
    this.retryCounts.set(actionKey, retries);

    switch (category) {
      case 'NETWORK_DELAY':
        return {
          category,
          maxRetries: 3,
          reobserve: true,
          userEscalationMessage: retries >= 3 ? 'Network connectivity issue detected. Retrying connection...' : undefined,
        };

      case 'ELEMENT_NOT_FOUND':
        return {
          category,
          maxRetries: 2,
          scrollIntoView: true,
          reobserve: true,
          alternateSelector: action.target ? `[aria-label*="${action.target}"]` : undefined,
          userEscalationMessage: retries >= 2 ? `I couldn't locate "${action.target}". Could you point it out?` : undefined,
        };

      case 'LOGIN_REQUIRED':
        return {
          category,
          maxRetries: 1,
          userEscalationMessage: 'Authentication required. Please sign in to continue.',
        };

      case 'CAPTCHA_REQUIRED':
        return {
          category,
          maxRetries: 1,
          userEscalationMessage: 'CAPTCHA detected. Please complete the CAPTCHA to proceed.',
        };

      default:
        return {
          category,
          maxRetries: 2,
          reobserve: true,
        };
    }
  }

  /**
   * Register a state hash to detect duplicate/infinite loop states.
   */
  public checkInfiniteLoop(stateSnapshot: string): boolean {
    if (this.stateHashes.has(stateSnapshot)) {
      return true; // Duplicate state detected
    }
    this.stateHashes.add(stateSnapshot);
    if (this.stateHashes.size > 20) {
      const first = Array.from(this.stateHashes)[0];
      this.stateHashes.delete(first);
    }
    return false;
  }

  public resetActionRetries(actionId: string) {
    for (const key of Array.from(this.retryCounts.keys())) {
      if (key.startsWith(actionId)) {
        this.retryCounts.delete(key);
      }
    }
  }
}

export const agentRecoveryEngine = new AgentRecoveryEngine();
