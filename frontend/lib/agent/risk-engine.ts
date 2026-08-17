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
    // 1. High Risk Actions
    if (type === 'TYPE' && (value?.includes('password') || value?.includes('card') || value?.includes('pin'))) {
      return 'HIGH';
    }
    if (type === 'CLICK' && target?.toLowerCase().includes('delete')) {
      return 'HIGH';
    }
    if (type === 'CLICK' && target?.toLowerCase().includes('pay')) {
      return 'HIGH';
    }

    // 2. Medium Risk Actions (Messaging, Sharing)
    if (type === 'SHARE') return 'MEDIUM';
    if (type === 'TYPE' && target?.toLowerCase().includes('message')) return 'MEDIUM';

    // 3. Low Risk Actions (Open app, search, scroll, navigate)
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
