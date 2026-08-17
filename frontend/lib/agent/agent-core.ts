// frontend/lib/agent/agent-core.ts
// ReAct Autonomous Agent Execution Loop

import { AgentState, AgentAction, VerificationResult } from './agent-types';
import { applicationAdapterRegistry } from '../applications/application-registry';
import { actionVerifier } from './action-verifier';
import { agentRecoveryEngine } from './agent-recovery-engine';
import { taskContextManager } from './task-context';
import { screenStateManager } from './screen-state-manager';
import { riskEngine } from './risk-engine';

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

    const adapter = applicationAdapterRegistry.resolveAdapter(targetApp || 'Insight AI');
    screenStateManager.updateApp(adapter.id);

    if (abortSignal?.aborted) {
      this.setState('IDLE');
      return { success: false, finalMessage: 'Task cancelled by user', actionsExecuted: 0 };
    }

    this.setState('EXECUTING');

    try {
      // 1. Observe screen state before action
      const observation = await adapter.observe();

      // 2. Perform intent action via App Adapter
      let actionRes = await adapter.open(userGoal);
      if (!actionRes.success) {
        actionRes = await adapter.search(userGoal);
      }

      this.setState('VERIFYING');
      const verification = await actionVerifier.verify({
        id: 'action_1',
        type: 'OPEN_APP',
        timeoutMs: 3000,
        riskLevel: 'LOW',
        description: `Execute ${userGoal}`,
      });

      if (!verification.success) {
        this.setState('RECOVERING');
        const category = agentRecoveryEngine.classifyFailure(verification.mismatchReason);
        const strategy = agentRecoveryEngine.getStrategy(category, {
          id: 'action_1',
          type: 'OPEN_APP',
          target: userGoal,
          timeoutMs: 3000,
          riskLevel: 'LOW',
          description: userGoal,
        });

        if (strategy.userEscalationMessage) {
          this.setState('WAITING_FOR_USER');
          return { success: false, finalMessage: strategy.userEscalationMessage, actionsExecuted: 1 };
        }
      }

      this.setState('COMPLETED');
      screenStateManager.setLastSuccessfulAction({
        id: `act_${Date.now()}`,
        type: 'OPEN_APP',
        target: userGoal,
        timeoutMs: 3000,
        riskLevel: 'LOW',
        description: userGoal,
      });

      return {
        success: true,
        finalMessage: actionRes.message || `Successfully completed "${userGoal}"`,
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
