// frontend/__tests__/session-state.test.ts
// Unit tests for SessionStateManager — HITL promise resolution, session lifecycle

import { sessionStateManager } from '../lib/agent/session-state';

describe('SessionStateManager', () => {
  afterEach(() => {
    // Clean up all sessions
    const sessionId = 'test-session-' + Date.now();
    sessionStateManager.destroySession(sessionId);
  });

  test('creates a new session', () => {
    const id = 'test-create-' + Date.now();
    const session = sessionStateManager.getOrCreateSession(id);
    expect(session.sessionId).toBe(id);
    expect(session.active).toBe(true);
    expect(session.commandHistory).toEqual([]);
    expect(session.selectorMap).toEqual({});
    sessionStateManager.destroySession(id);
  });

  test('returns existing session on second call', () => {
    const id = 'test-existing-' + Date.now();
    sessionStateManager.getOrCreateSession(id);
    const session2 = sessionStateManager.getOrCreateSession(id);
    expect(session2.sessionId).toBe(id);
    sessionStateManager.destroySession(id);
  });

  test('pushCommand adds to history', () => {
    const id = 'test-commands-' + Date.now();
    sessionStateManager.getOrCreateSession(id);
    sessionStateManager.pushCommand(id, 'open amazon');
    sessionStateManager.pushCommand(id, 'search earbuds');
    const session = sessionStateManager.getSession(id);
    expect(session?.commandHistory).toEqual(['open amazon', 'search earbuds']);
    sessionStateManager.destroySession(id);
  });

  test('updatePageContext stores page info', () => {
    const id = 'test-context-' + Date.now();
    sessionStateManager.getOrCreateSession(id);
    sessionStateManager.updatePageContext(id, 'https://amazon.in', 'Amazon.in', 'Amazon');
    const session = sessionStateManager.getSession(id);
    expect(session?.currentUrl).toBe('https://amazon.in');
    expect(session?.currentPageTitle).toBe('Amazon.in');
    expect(session?.currentApplication).toBe('Amazon');
    sessionStateManager.destroySession(id);
  });

  test('HITL resolve works', async () => {
    const id = 'test-hitl-' + Date.now();
    sessionStateManager.getOrCreateSession(id);

    // Create HITL prompt (returns a promise)
    const hitlPromise = sessionStateManager.createHITLPrompt(id, 'q1', 'What is your name?', 'firstName');

    // Resolve it from "outside" (simulating user answer)
    setTimeout(() => {
      sessionStateManager.resolveHITL(id, 'q1', 'John');
    }, 10);

    const answer = await hitlPromise;
    expect(answer).toBe('John');
    sessionStateManager.destroySession(id);
  });

  test('destroySession rejects pending HITL', async () => {
    const id = 'test-hitl-reject-' + Date.now();
    sessionStateManager.getOrCreateSession(id);

    const hitlPromise = sessionStateManager.createHITLPrompt(id, 'q2', 'Your email?');

    // Destroy session before answering
    setTimeout(() => {
      sessionStateManager.destroySession(id);
    }, 10);

    await expect(hitlPromise).rejects.toBe('Session destroyed');
  });

  test('getSession returns null for non-existent session', () => {
    expect(sessionStateManager.getSession('nonexistent')).toBeNull();
  });

  test('activeSessionCount increments and decrements', () => {
    const id1 = 'test-count-1-' + Date.now();
    const id2 = 'test-count-2-' + Date.now();
    const before = sessionStateManager.getActiveSessionCount();
    sessionStateManager.getOrCreateSession(id1);
    sessionStateManager.getOrCreateSession(id2);
    expect(sessionStateManager.getActiveSessionCount()).toBe(before + 2);
    sessionStateManager.destroySession(id1);
    expect(sessionStateManager.getActiveSessionCount()).toBe(before + 1);
    sessionStateManager.destroySession(id2);
  });
});
