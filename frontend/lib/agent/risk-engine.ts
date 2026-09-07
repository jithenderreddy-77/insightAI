// frontend/lib/agent/risk-engine.ts
// Risk Classification & User Automation Preferences Engine

import { RiskLevel, ActionType, AutomationPreferences } from './agent-types';

class RiskEngine {
  private preferences: AutomationPreferences = {
    autoExecuteLowRisk: true,
    confirmMessages: true,
    confirmSharing: false,
    confirmPurchases: true,
    confirmDeletion: true,
    trustedApplications: ['Insight AI', 'YouTube', 'Google', 'Spotify'],
  };

  /**
   * Classify risk level for a proposed agent action.
   */
  public classifyRisk(type: ActionType, target?: string, value?: string): RiskLevel {
    // 1. PURCHASE — always high risk, no exceptions
    if (type === 'PURCHASE') return 'HIGH';

    // 2. High Risk Actions
    if (type === 'TYPE' && (value?.includes('password') || value?.includes('card') || value?.includes('pin'))) {
      return 'HIGH';
    }
    if (type === 'CLICK' && target?.toLowerCase().includes('delete')) {
      return 'HIGH';
    }
    // Payment/purchase buttons
    if (type === 'CLICK' && target) {
      const t = target.toLowerCase();
      if (t.includes('pay') || t.includes('place order') || t.includes('buy now') ||
          t.includes('confirm purchase') || t.includes('submit payment') ||
          t.includes('complete order') || t.includes('proceed to checkout')) {
        return 'HIGH';
      }
    }

    // 3. FILL_FORM — medium by default, high if contains sensitive data
    if (type === 'FILL_FORM') {
      if (value?.toLowerCase().match(/card|cvv|cvc|password|otp|security.?code/)) {
        return 'HIGH';
      }
      return 'MEDIUM';
    }

    // 4. Medium Risk Actions (Messaging, Sharing)
    if (type === 'SHARE') return 'MEDIUM';
    if (type === 'TYPE' && target?.toLowerCase().includes('message')) return 'MEDIUM';

    // 5. Low Risk Actions (Open app, search, scroll, navigate)
    return 'LOW';
  }

  /**
   * Check if confirmation is required based on preferences.
   */
  public requiresConfirmation(type: ActionType, risk: RiskLevel): boolean {
    if (risk === 'HIGH') return true;
    if (risk === 'MEDIUM' && this.preferences.confirmMessages) return true;
    if (risk === 'LOW' && !this.preferences.autoExecuteLowRisk) return true;
    return false;
  }

  public getPreferences(): Readonly<AutomationPreferences> {
    return { ...this.preferences };
  }

  public updatePreferences(newPrefs: Partial<AutomationPreferences>) {
    this.preferences = { ...this.preferences, ...newPrefs };
  }
}

export const riskEngine = new RiskEngine();
