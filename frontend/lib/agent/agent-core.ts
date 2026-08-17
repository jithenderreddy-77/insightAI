// frontend/lib/agent/agent-core.ts
// ReAct Autonomous Agent Execution Loop

import { AgentState, AgentAction, VerificationResult } from './agent-types';
import { applicationAdapterRegistry } from '../applications/application-registry';
import { actionVerifier } from './action-verifier';
import { agentRecoveryEngine } from './agent-recovery-engine';
import { taskContextManager } from './task-context';
import { screenStateManager } from './screen-state-manager';
import { riskEngine } from './risk-engine';
import { browserBridgeClient } from '../browser-bridge/browser-bridge-client';
import { browserTabController } from '../browser-bridge/browser-tab-controller';

export interface AgentGoalResult {
  success: boolean;
  finalMessage: string;
  actionsExecuted: number;
}

export class AgentCore {
  private currentState: AgentState = 'IDLE';

  public getState(): AgentState {
    return this.currentState;
  }

  public setState(state: AgentState) {
    this.currentState = state;
  }

  /**
   * Execute an autonomous goal using ReAct Loop:
   * Goal -> Subgoals -> Action -> Observation -> Verification -> Recovery.
   */
  public async executeGoal(
    userGoal: string,
    targetApp?: string,
    abortSignal?: AbortSignal
  ): Promise<AgentGoalResult> {
    this.setState('PLANNING');
    taskContextManager.pushCommand(userGoal);

    const actionId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const adapter = applicationAdapterRegistry.resolveAdapter(targetApp || 'Insight AI');

    if (abortSignal?.aborted) {
      this.setState('IDLE');
      return { success: false, finalMessage: 'Task cancelled by user', actionsExecuted: 0 };
    }

    // ── LEVEL 3 REAL BROWSER EXTENSION EXECUTION PATH ──
    if (browserBridgeClient.isConnected()) {
      this.setState('EXECUTING');

      // Target Tab Lock Verification (TargetTabLock + TARGET_MISMATCH check)
      const targetMatch = browserTabController.verifyTargetMatch(targetApp);
      if (!targetMatch.isMatch && targetMatch.expectedApp) {
        // Recovery: Activate locked target tab
        const tabLock = browserTabController.getLockedTab();
        if (tabLock) {
          await browserBridgeClient.lockTargetTab(tabLock.tabId, tabLock.application);
        }
      }

      // Execute via Extension Bridge Client
      const extensionReport = await browserBridgeClient.executeAction(
        {
          actionId,
          type: userGoal.toLowerCase().includes('scroll') ? 'SCROLL' : 'CLICK',
          targetQuery: userGoal,
          timeoutMs: 8000,
        },
        abortSignal
      );

      if (extensionReport.success && extensionReport.evidence?.pageState) {
        // EXTENSION IS SOURCE OF TRUTH: Update ScreenState ONLY from empirical browser evidence
        screenStateManager.updateFromEmpiricalEvidence(extensionReport.evidence.pageState);
        this.setState('COMPLETED');
        return {
          success: true,
          finalMessage: extensionReport.message || `Verified action "${userGoal}" on real browser`,
          actionsExecuted: 1,
        };
      } else {
        // Handle failure/recovery
        this.setState('RECOVERING');
        const category = agentRecoveryEngine.classifyFailure(extensionReport.error || 'Extension execution failed');
        const strategy = agentRecoveryEngine.getStrategy(category, {
          id: actionId,
          type: 'CLICK',
          target: userGoal,
          timeoutMs: 8000,
          riskLevel: 'LOW',
          description: userGoal,
        });

        if (strategy.userEscalationMessage) {
          this.setState('WAITING_FOR_USER');
          return { success: false, finalMessage: strategy.userEscalationMessage, actionsExecuted: 1 };
        }
      }
    }

    // ── FALLBACK EXECUTION PATH (STRICTLY ISOLATED WHEN EXTENSION UNCONNECTED) ──
    // Note: Fallback path DOES NOT mutate ScreenState. ScreenState mutates ONLY on empirical extension evidence.
    this.setState('EXECUTING');

    try {
      let actionRes = await adapter.open(userGoal);
      if (!actionRes.success) {
        actionRes = await adapter.search(userGoal);
      }

      this.setState('COMPLETED');
      return {
        success: true,
        finalMessage: actionRes.message || `Launched URL for "${userGoal}" (Extension disconnected - ScreenState unmutated)`,
        actionsExecuted: 1,
      };
    } catch (err: any) {
      this.setState('FAILED');
      return {
        success: false,
        finalMessage: err.message || 'Task execution failed',
        actionsExecuted: 0,
      };
    }
  }
}

export const agentCore = new AgentCore();
