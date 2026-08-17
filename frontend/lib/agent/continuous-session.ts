// frontend/lib/agent/continuous-session.ts
// Continuous Voice Listening & Autonomous Computer Control Loop

import { commandContinuationRouter } from './command-continuation-router';
import { commandInterpreter } from './command-interpreter';
import { taskContextManager } from './task-context';
import { screenStateManager } from './screen-state-manager';
import { agentCore } from './agent-core';

export interface ContinuousSessionEvent {
  type: 'STARTED' | 'LISTENING' | 'EXECUTING' | 'WAITING_FOR_USER' | 'COMPLETED' | 'STOPPED';
  message?: string;
  transcript?: string;
}

export class ContinuousSession {
  private active: boolean = false;
  private currentAbortController: AbortController | null = null;
  private eventListeners: Array<(evt: ContinuousSessionEvent) => void> = [];

  public startSession() {
    this.active = true;
    this.emitEvent({ type: 'STARTED', message: 'Continuous Computer-Use Session active' });
    this.emitEvent({ type: 'LISTENING' });
  }

  public stopSession(reason: string = 'User terminated session') {
    this.active = false;
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    taskContextManager.resetContext();
    this.emitEvent({ type: 'STOPPED', message: reason });
  }

  public isActive(): boolean {
    return this.active;
  }

  /**
   * Process incoming voice/text command within the continuous execution loop.
   */
  public async handleCommand(
    rawCommand: string,
    onSpeechFeedback?: (text: string) => void
  ): Promise<{ shouldContinueListening: boolean; responseMessage: string }> {
    if (!this.active) this.startSession();

    // 1. Check classification (New Task, Continuation, Navigation, Cancellation)
    const activeApp = screenStateManager.getScreenState().application;
    const classification = commandContinuationRouter.classify(rawCommand, activeApp);

    if (classification.classification === 'CANCELLATION') {
      this.stopSession('Explicit cancellation');
      const exitMsg = 'Goodbye! Session ended. Call me anytime.';
      onSpeechFeedback?.(exitMsg);
      return { shouldContinueListening: false, responseMessage: exitMsg };
    }

    // 2. Interpret command relative to active screen & anaphora/pronoun context
    const interpreted = commandInterpreter.interpret(rawCommand);
    this.emitEvent({ type: 'EXECUTING', transcript: rawCommand });

    this.currentAbortController = new AbortController();

    try {
      // 3. Execute goal via AgentCore
      const result = await agentCore.executeGoal(
        interpreted.normalizedCommand,
        interpreted.targetApp,
        this.currentAbortController.signal
      );

      this.currentAbortController = null;

      if (result.success) {
        onSpeechFeedback?.(result.finalMessage);
        this.emitEvent({ type: 'COMPLETED', message: result.finalMessage });
        this.emitEvent({ type: 'LISTENING' });
        return { shouldContinueListening: true, responseMessage: result.finalMessage };
      } else {
        onSpeechFeedback?.(result.finalMessage);
        this.emitEvent({ type: 'WAITING_FOR_USER', message: result.finalMessage });
        this.emitEvent({ type: 'LISTENING' });
        return { shouldContinueListening: true, responseMessage: result.finalMessage };
      }
    } catch (err: any) {
      this.currentAbortController = null;
      const errMsg = err.message || 'Error processing command';
      onSpeechFeedback?.(errMsg);
      this.emitEvent({ type: 'LISTENING' });
      return { shouldContinueListening: true, responseMessage: errMsg };
    }
  }

  public subscribe(listener: (evt: ContinuousSessionEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  private emitEvent(evt: ContinuousSessionEvent) {
    for (const listener of this.eventListeners) {
      try {
        listener(evt);
      } catch {}
    }
  }
}

export const continuousSession = new ContinuousSession();
