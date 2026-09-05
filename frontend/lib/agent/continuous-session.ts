// frontend/lib/agent/continuous-session.ts
// Continuous Voice Listening & Autonomous Computer Control Loop
//
// This is the "glue" that makes the assistant hands-free:
// 1. Intent Router classifies each command as NAVIGATION or IN_PAGE_ACTION
// 2. Dispatches to the correct executor
// 3. Always returns to active listening after completion
// 4. Supports barge-in: new commands abort in-progress actions
// 5. Maintains short-term context for multi-step command chains

import { commandContinuationRouter } from './command-continuation-router';
import { commandInterpreter } from './command-interpreter';
import { taskContextManager } from './task-context';
import { screenStateManager } from './screen-state-manager';
import { agentCore } from './agent-core';
import { intentRouter, type IntentClassification } from './intent-router';

export interface ContinuousSessionEvent {
  type: 'STARTED' | 'LISTENING' | 'CLASSIFYING' | 'EXECUTING' | 'WAITING_FOR_USER' | 'COMPLETED' | 'STOPPED' | 'BARGE_IN';
  message?: string;
  transcript?: string;
  intent?: IntentClassification;
}

export class ContinuousSession {
  private active: boolean = false;
  private currentAbortController: AbortController | null = null;
  private eventListeners: Array<(evt: ContinuousSessionEvent) => void> = [];
  private commandContext: string[] = []; // Short-term context for multi-step chains
  private isExecuting: boolean = false;

  public startSession() {
    this.active = true;
    this.commandContext = [];
    this.emitEvent({ type: 'STARTED', message: 'Continuous Computer-Use Session active' });
    this.emitEvent({ type: 'LISTENING' });
  }

  public stopSession(reason: string = 'User terminated session') {
    this.active = false;
    this.isExecuting = false;

    // Abort any in-progress action immediately
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    this.commandContext = [];
    taskContextManager.resetContext();
    this.emitEvent({ type: 'STOPPED', message: reason });
  }

  public isActive(): boolean {
    return this.active;
  }

  public isCurrentlyExecuting(): boolean {
    return this.isExecuting;
  }

  /**
   * Get short-term command context for multi-step chains.
   * e.g., ["open amazon", "search wireless earbuds", "select the second one"]
   */
  public getCommandContext(): string[] {
    return [...this.commandContext];
  }

  /**
   * Process incoming voice/text command within the continuous execution loop.
   *
   * Flow:
   * 1. Check cancellation
   * 2. Barge-in: if currently executing, abort previous action
   * 3. Intent Router: classify as NAVIGATION or IN_PAGE_ACTION
   * 4. Dispatch to correct executor
   * 5. Always return to LISTENING after completion
   */
  public async handleCommand(
    rawCommand: string,
    onSpeechFeedback?: (text: string) => void
  ): Promise<{ shouldContinueListening: boolean; responseMessage: string }> {
    if (!this.active) this.startSession();

    // 1. Check classification (Cancellation check)
    const activeApp = screenStateManager.getScreenState().application;
    const classification = commandContinuationRouter.classify(rawCommand, activeApp);

    if (classification.classification === 'CANCELLATION') {
      this.stopSession('Explicit cancellation');
      const exitMsg = 'Goodbye! Session ended. Call me anytime.';
      onSpeechFeedback?.(exitMsg);
      return { shouldContinueListening: false, responseMessage: exitMsg };
    }

    // 2. Barge-in: if an action is currently executing, abort it
    if (this.isExecuting && this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
      this.isExecuting = false;
      this.emitEvent({
        type: 'BARGE_IN',
        message: `Interrupted previous action for new command: "${rawCommand}"`,
        transcript: rawCommand,
      });
    }

    // 3. Add to command context for multi-step chains
    this.commandContext.push(rawCommand);
    if (this.commandContext.length > 10) {
      this.commandContext = this.commandContext.slice(-10);
    }

    // 4. Intent Router: classify as NAVIGATION or IN_PAGE_ACTION
    const screenState = screenStateManager.getScreenState();
    const pageContext = {
      currentUrl: screenState.url,
      currentApplication: screenState.application,
      hasActivePage: !!(screenState.url && screenState.application && screenState.application !== 'Insight AI'),
    };

    this.emitEvent({ type: 'CLASSIFYING', transcript: rawCommand });

    const intent = await intentRouter.classify(rawCommand, pageContext);

    this.emitEvent({
      type: 'EXECUTING',
      transcript: rawCommand,
      intent,
      message: `${intent.intent} (${intent.source}, confidence: ${intent.confidence.toFixed(2)})`,
    });

    // 5. Interpret command for anaphora/pronoun resolution
    const interpreted = commandInterpreter.interpret(rawCommand);

    this.currentAbortController = new AbortController();
    this.isExecuting = true;

    try {
      let result: { success: boolean; finalMessage: string; actionsExecuted: number };

      if (intent.intent === 'IN_PAGE_ACTION') {
        // TODO: Component 5 will add inPageActionExecutor.execute() here
        // For now, route through agentCore which already handles extension bridge
        result = await agentCore.executeGoal(
          interpreted.normalizedCommand,
          interpreted.targetApp,
          this.currentAbortController.signal
        );
      } else {
        // NAVIGATION: use existing agent core pipeline
        result = await agentCore.executeGoal(
          interpreted.normalizedCommand,
          interpreted.targetApp,
          this.currentAbortController.signal
        );
      }

      this.currentAbortController = null;
      this.isExecuting = false;

      if (result.success) {
        onSpeechFeedback?.(result.finalMessage);
        this.emitEvent({ type: 'COMPLETED', message: result.finalMessage });
      } else {
        onSpeechFeedback?.(result.finalMessage);
        this.emitEvent({ type: 'WAITING_FOR_USER', message: result.finalMessage });
      }

      // 6. ALWAYS return to listening — this is what makes it hands-free
      this.emitEvent({ type: 'LISTENING' });
      return { shouldContinueListening: true, responseMessage: result.finalMessage };
    } catch (err: any) {
      this.currentAbortController = null;
      this.isExecuting = false;

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

