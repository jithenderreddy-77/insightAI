// frontend/lib/agent/screen-state-manager.ts
// Persistent ScreenState Manager & Session Context Graph

import { ScreenState, UIEntity, UIAction, ScrollContainer, UIDialog, AgentAction } from './agent-types';

export interface InteractionGraphNode {
  id: string;
  application: string;
  page?: string;
  entity?: UIEntity;
  action?: AgentAction;
  parent?: string;
  timestamp: number;
}

class ScreenStateManager {
  private currentScreenState: ScreenState = {
    application: 'Insight AI',
    visibleEntities: [],
    visibleActions: [],
    scrollContainers: [],
    dialogs: [],
    timestamp: Date.now(),
  };

  private interactionGraph: InteractionGraphNode[] = [];
  private listeners: Array<(state: ScreenState) => void> = [];

  constructor() {
    this.initEventListener();
  }

  private initEventListener() {
    if (typeof window === 'undefined') return;

    // Event-driven observation listeners
    window.addEventListener('popstate', () => this.updateFromDOM('navigation'));
    window.addEventListener('resize', () => this.updateFromDOM('resize'));
    
    // Observer for DOM mutations (modals, search results, dialogs)
    if ('MutationObserver' in window) {
      try {
        const observer = new MutationObserver((mutations) => {
          let shouldUpdate = false;
          for (const m of mutations) {
            if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
              shouldUpdate = true;
              break;
            }
          }
          if (shouldUpdate) {
            this.updateFromDOM('mutation');
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      } catch {}
    }
  }

  public getScreenState(): ScreenState {
    if (typeof window !== 'undefined') {
      this.updateFromDOM('read');
    }
    return { ...this.currentScreenState };
  }

  public updateApp(appName: string, url?: string, pageTitle?: string) {
    this.currentScreenState.application = appName;
    if (url) this.currentScreenState.url = url;
    if (pageTitle) this.currentScreenState.pageTitle = pageTitle;
    this.currentScreenState.timestamp = Date.now();

    this.pushGraphNode({
      id: `node_${Date.now()}`,
      application: appName,
      page: pageTitle || url,
      timestamp: Date.now(),
    });

    this.notifyListeners();
  }

  public setSelectedEntity(entity: UIEntity | undefined) {
    this.currentScreenState.selectedEntity = entity;
    this.currentScreenState.timestamp = Date.now();

    if (entity) {
      this.pushGraphNode({
        id: `node_entity_${Date.now()}`,
        application: this.currentScreenState.application || 'Insight AI',
        entity,
        timestamp: Date.now(),
      });
    }

    this.notifyListeners();
  }

  public setLastSuccessfulAction(action: AgentAction) {
    this.currentScreenState.lastSuccessfulAction = action;
    this.notifyListeners();
  }

  public pushGraphNode(node: InteractionGraphNode) {
    const parentId = this.interactionGraph.length > 0 ? this.interactionGraph[this.interactionGraph.length - 1].id : undefined;
    this.interactionGraph.push({ ...node, parent: parentId });
    if (this.interactionGraph.length > 50) {
      this.interactionGraph.shift();
    }
  }

  public getInteractionGraph(): ReadonlyArray<InteractionGraphNode> {
    return this.interactionGraph;
  }

  public subscribe(listener: (state: ScreenState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener(this.currentScreenState);
      } catch {}
    }
  }

  private updateFromDOM(trigger: string) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    try {
      this.currentScreenState.url = window.location.href;
      this.currentScreenState.pageTitle = document.title;

      // Extract visible dialogs
      const dialogElems = Array.from(document.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"], .modal'));
      this.currentScreenState.dialogs = dialogElems.map((el, i) => ({
        id: el.id || `dialog_${i}`,
        type: 'modal',
        visible: el.getBoundingClientRect().height > 0,
      }));

      // Extract scroll containers
      const scrollElems = Array.from(document.querySelectorAll('*')).filter((el) => {
        const style = window.getComputedStyle(el);
        return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
      });

      this.currentScreenState.scrollContainers = [
        {
          id: 'window',
          isWindow: true,
          scrollTop: window.scrollY || document.documentElement.scrollTop,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: window.innerHeight,
        },
        ...scrollElems.map((el, i) => ({
          id: el.id || `scroll_${i}`,
          isWindow: false,
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        })),
      ];

      this.currentScreenState.timestamp = Date.now();
    } catch {}
  }
}

export const screenStateManager = new ScreenStateManager();
