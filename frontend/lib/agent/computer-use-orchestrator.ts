// frontend/lib/agent/computer-use-orchestrator.ts
// Master Computer-Use Agent Orchestrator

import { continuousSession } from './continuous-session';
import { agentCore } from './agent-core';
import { taskContextManager } from './task-context';
import { screenStateManager } from './screen-state-manager';
import { capabilityBridge } from './capability-bridge';
import { applicationAdapterRegistry } from '../applications/application-registry';
import { AgentState, ScreenState } from './agent-types';

export class ComputerUseOrchestrator {
  public startAgentSession() {
    continuousSession.startSession();
  }

  public stopAgentSession() {
    continuousSession.stopSession('User request');
  }

  public getAgentState(): AgentState {
    return agentCore.getState();
  }

  public getScreenState(): ScreenState {
    return screenStateManager.getScreenState();
  }

  /**
   * Process a voice or text command through the complete orchestrator pipeline.
   */
  public async processCommand(
    command: string,
    onVoiceFeedback?: (text: string) => void
  ): Promise<{ success: boolean; responseMessage: string }> {
    // 1. Detect capability barriers (Offline, CAPTCHA, Login)
    const barrier = capabilityBridge.detectBarriers();
    if (barrier && barrier.userInstruction) {
      onVoiceFeedback?.(barrier.userInstruction);
      return { success: false, responseMessage: barrier.userInstruction };
    }

    // 2. Execute via ContinuousSession
    const res = await continuousSession.handleCommand(command, onVoiceFeedback);
    return {
      success: true,
      responseMessage: res.responseMessage,
    };
  }
}

export const computerUseOrchestrator = new ComputerUseOrchestrator();
