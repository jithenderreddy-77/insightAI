// frontend/lib/agent/task-context.ts
// Dual Task Context Engine: Separation & Synthesis of ConversationContext and UIContext

import { UIEntity, UIAction, ScreenState, AgentAction } from './agent-types';
import { screenStateManager } from './screen-state-manager';

export interface ConversationContext {
  previousCommands: string[];
  resolvedEntities: Record<string, UIEntity>;
  candidateDisambiguationList: UIEntity[];
  pendingConfirmation?: {
    action: AgentAction;
    targetDescription: string;
    onConfirm: () => void;
    onCancel: () => void;
  };
  lastUserSpeech?: string;
  lastAssistantSpeech?: string;
}

export interface UIContext {
  currentApplication: string;
  currentPageTitle?: string;
  currentUrl?: string;
  selectedItem?: UIEntity;
  visibleEntities: UIEntity[];
  visibleActions: UIAction[];
  activeDialog?: string;
  focusedInput?: string;
  scrollPosition: { top: number; total: number };
}

export interface CombinedAgentContext {
  conversation: ConversationContext;
  ui: UIContext;
  screenState: ScreenState;
  timestamp: number;
}

class TaskContextManager {
  private conversationContext: ConversationContext = {
    previousCommands: [],
    resolvedEntities: {},
    candidateDisambiguationList: [],
  };

  public pushCommand(command: string) {
    this.conversationContext.previousCommands.push(command);
    if (this.conversationContext.previousCommands.length > 20) {
      this.conversationContext.previousCommands.shift();
    }
  }

  public setCandidateDisambiguationList(candidates: UIEntity[]) {
    this.conversationContext.candidateDisambiguationList = candidates;
  }

  public getCandidateDisambiguationList(): UIEntity[] {
    return this.conversationContext.candidateDisambiguationList;
  }

  public clearCandidateDisambiguationList() {
    this.conversationContext.candidateDisambiguationList = [];
  }

  public setPendingConfirmation(confirmObj: ConversationContext['pendingConfirmation']) {
    this.conversationContext.pendingConfirmation = confirmObj;
  }

  public getPendingConfirmation() {
    return this.conversationContext.pendingConfirmation;
  }

  public clearPendingConfirmation() {
    this.conversationContext.pendingConfirmation = undefined;
  }

  public rememberEntity(key: string, entity: UIEntity) {
    this.conversationContext.resolvedEntities[key] = entity;
    this.conversationContext.resolvedEntities['last'] = entity;
  }

  public getRememberedEntity(key: string): UIEntity | undefined {
    return this.conversationContext.resolvedEntities[key] || this.conversationContext.resolvedEntities['last'];
  }

  public setLastSpeech(userText?: string, assistantText?: string) {
    if (userText) this.conversationContext.lastUserSpeech = userText;
    if (assistantText) this.conversationContext.lastAssistantSpeech = assistantText;
  }

  public getUIContext(): UIContext {
    const screen = screenStateManager.getScreenState();
    return {
      currentApplication: screen.application || 'Insight AI',
      currentPageTitle: screen.pageTitle,
      currentUrl: screen.url,
      selectedItem: screen.selectedEntity,
      visibleEntities: screen.visibleEntities,
      visibleActions: screen.visibleActions,
      activeDialog: screen.dialogs.find((d) => d.visible)?.id,
      scrollPosition: {
        top: screen.scrollContainers[0]?.scrollTop || 0,
        total: screen.scrollContainers[0]?.scrollHeight || 0,
      },
    };
  }

  public getCombinedContext(): CombinedAgentContext {
    const screen = screenStateManager.getScreenState();
    return {
      conversation: { ...this.conversationContext },
      ui: this.getUIContext(),
      screenState: screen,
      timestamp: Date.now(),
    };
  }

  public resetContext() {
    this.conversationContext = {
      previousCommands: [],
      resolvedEntities: {},
      candidateDisambiguationList: [],
    };
  }
}

export const taskContextManager = new TaskContextManager();
