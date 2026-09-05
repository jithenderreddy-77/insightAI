// frontend/lib/agent/session-state.ts
// Server-Side Persistent Session State Manager
//
// Stores active session state in-memory (Map keyed by sessionId).
// Each session maintains: current page context, selector map, command history,
// pending HITL resolvers, and the SSE controller for streaming events.
//
// ⚠️ In-memory = resets on server restart. Acceptable for dev/single-instance.
// For production multi-instance, this would need Redis or similar.

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface SelectorMapEntry {
  index: number;
  role: string;
  label: string;
  selector: string;
  text: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export type SelectorMap = Record<number, SelectorMapEntry>;

export interface HITLResolver {
  resolve: (answer: string) => void;
  reject: (reason: string) => void;
  question: string;
  fieldName?: string;
  createdAt: number;
}

export interface SessionState {
  sessionId: string;
  active: boolean;
  currentUrl?: string;
  currentPageTitle?: string;
  currentApplication?: string;
  selectorMap: SelectorMap;
  commandHistory: string[];
  pendingHitlResolvers: Map<string, HITLResolver>;
  sseController?: ReadableStreamDefaultController;
  createdAt: number;
  lastActivityAt: number;
}

// ─────────────────────────────────────────────────────────
// SSE EVENT TYPES
// ─────────────────────────────────────────────────────────

export type SSEEventType =
  | 'session:started'
  | 'action:log'
  | 'action:executing'
  | 'action:completed'
  | 'action:failed'
  | 'hitl:prompt'
  | 'hitl:resolved'
  | 'safety:confirm_purchase'
  | 'task:done'
  | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, any>;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────
// SESSION MANAGER
// ─────────────────────────────────────────────────────────

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_COMMAND_HISTORY = 50;

class SessionStateManager {
  private sessions: Map<string, SessionState> = new Map();

  /**
   * Create or retrieve a session.
   */
  public getOrCreateSession(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
      return session;
    }

    session = {
      sessionId,
      active: true,
      selectorMap: {},
      commandHistory: [],
      pendingHitlResolvers: new Map(),
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    this.sessions.set(sessionId, session);
    this.cleanupExpiredSessions();
    return session;
  }

  /**
   * Get a session by ID (returns null if not found or expired).
   */
  public getSession(sessionId: string): SessionState | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() - session.lastActivityAt > SESSION_TIMEOUT_MS) {
      this.destroySession(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Push a command into session history.
   */
  public pushCommand(sessionId: string, command: string): void {
    const session = this.getSession(sessionId);
    if (!session) return;

    session.commandHistory.push(command);
    if (session.commandHistory.length > MAX_COMMAND_HISTORY) {
      session.commandHistory = session.commandHistory.slice(-MAX_COMMAND_HISTORY);
    }
    session.lastActivityAt = Date.now();
  }

  /**
   * Update the session's current page context (from extension evidence).
   */
  public updatePageContext(
    sessionId: string,
    url: string,
    title: string,
    application?: string
  ): void {
    const session = this.getSession(sessionId);
    if (!session) return;

    session.currentUrl = url;
    session.currentPageTitle = title;
    session.currentApplication = application;
    session.lastActivityAt = Date.now();
  }

  /**
   * Replace the session's selector map (after a fresh DOM snapshot).
   */
  public updateSelectorMap(sessionId: string, selectorMap: SelectorMap): void {
    const session = this.getSession(sessionId);
    if (!session) return;

    session.selectorMap = selectorMap;
    session.lastActivityAt = Date.now();
  }

  /**
   * Register the SSE controller for a session (so we can push events to the client).
   */
  public setSSEController(
    sessionId: string,
    controller: ReadableStreamDefaultController
  ): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    session.sseController = controller;
  }

  /**
   * Emit an SSE event to the session's connected client.
   */
  public emitEvent(sessionId: string, type: SSEEventType, data: Record<string, any>): void {
    const session = this.getSession(sessionId);
    if (!session || !session.sseController) return;

    const event: SSEEvent = {
      type,
      data,
      timestamp: Date.now(),
    };

    try {
      const ssePayload = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
      session.sseController.enqueue(new TextEncoder().encode(ssePayload));
    } catch {
      // Controller may have been closed by client disconnect
    }
  }

  /**
   * Create a HITL prompt — returns a Promise that resolves when the user answers.
   */
  public createHITLPrompt(
    sessionId: string,
    questionId: string,
    question: string,
    fieldName?: string
  ): Promise<string> {
    const session = this.getSession(sessionId);
    if (!session) {
      return Promise.reject(new Error('Session not found'));
    }

    // Emit the prompt to the client via SSE
    this.emitEvent(sessionId, 'hitl:prompt', {
      questionId,
      question,
      fieldName,
    });

    // Create and store the resolvable promise
    return new Promise<string>((resolve, reject) => {
      session.pendingHitlResolvers.set(questionId, {
        resolve,
        reject,
        question,
        fieldName,
        createdAt: Date.now(),
      });
    });
  }

  /**
   * Resolve a pending HITL prompt with the user's answer.
   */
  public resolveHITL(sessionId: string, questionId: string, answer: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;

    const resolver = session.pendingHitlResolvers.get(questionId);
    if (!resolver) return false;

    resolver.resolve(answer);
    session.pendingHitlResolvers.delete(questionId);

    this.emitEvent(sessionId, 'hitl:resolved', {
      questionId,
      fieldName: resolver.fieldName,
    });

    return true;
  }

  /**
   * Destroy a session and reject all pending HITL resolvers.
   */
  public destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Reject all pending HITL resolvers
    for (const [, resolver] of session.pendingHitlResolvers) {
      resolver.reject('Session destroyed');
    }
    session.pendingHitlResolvers.clear();

    // Close SSE controller
    if (session.sseController) {
      try {
        session.sseController.close();
      } catch {}
    }

    session.active = false;
    this.sessions.delete(sessionId);
  }

  /**
   * Clean up sessions that have been inactive beyond the timeout.
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt > SESSION_TIMEOUT_MS) {
        this.destroySession(id);
      }
    }
  }

  /**
   * Get count of active sessions (for diagnostics).
   */
  public getActiveSessionCount(): number {
    return this.sessions.size;
  }
}

export const sessionStateManager = new SessionStateManager();
