// frontend/__tests__/computer-use-agent.test.ts
// Comprehensive Test Suite for Insight AI Computer-Use Agent Subsystem

import { commandInterpreter } from '../lib/agent/command-interpreter';
import { commandContinuationRouter } from '../lib/agent/command-continuation-router';
import { screenStateManager } from '../lib/agent/screen-state-manager';
import { taskContextManager } from '../lib/agent/task-context';
import { applicationAdapterRegistry } from '../lib/applications/application-registry';
import { actionVerifier } from '../lib/agent/action-verifier';
import { computerUseOrchestrator } from '../lib/agent/computer-use-orchestrator';

describe('Insight AI Autonomous Computer-Use Agent Suite', () => {
  beforeEach(() => {
    taskContextManager.resetContext();
  });

  describe('1. Command Continuation Router', () => {
    it('should classify exit and cancellation commands', () => {
      const res = commandContinuationRouter.classify('stop');
      expect(res.classification).toBe('CANCELLATION');
      expect(res.shouldResetContext).toBe(true);
    });

    it('should classify navigation commands', () => {
      const res = commandContinuationRouter.classify('go back');
      expect(res.classification).toBe('NAVIGATION');
      expect(res.shouldResetContext).toBe(false);
    });

    it('should classify candidate reference commands', () => {
      const res = commandContinuationRouter.classify('the second one');
      expect(res.classification).toBe('REFERENCE');
      expect(res.shouldResetContext).toBe(false);
    });

    it('should classify modification commands', () => {
      const res = commandContinuationRouter.classify('actually search for Java instead');
      expect(res.classification).toBe('MODIFICATION');
      expect(res.shouldResetContext).toBe(false);
    });

    it('should classify commands within active app session as CONTINUATION', () => {
      const res = commandContinuationRouter.classify('search for Python tutorials', 'YouTube');
      expect(res.classification).toBe('CONTINUATION');
    });
  });

  describe('2. Command Interpreter & Anaphora / Pronoun Resolution', () => {
    it('should resolve candidate selection by ordinal ("the second one")', () => {
      taskContextManager.setCandidateDisambiguationList([
        { id: 'c1', type: 'contact', name: 'Rahul Kumar' },
        { id: 'c2', type: 'contact', name: 'Rahul Reddy' },
        { id: 'c3', type: 'contact', name: 'Rahul Sharma' },
      ]);

      const interpreted = commandInterpreter.interpret('the second one');
      expect(interpreted.intent).toBe('SELECT_CANDIDATE');
      expect(interpreted.targetEntity?.name).toBe('Rahul Reddy');
    });

    it('should resolve pronouns ("this reel", "this video")', () => {
      screenStateManager.setSelectedEntity({ id: 'r1', type: 'reel', name: 'Quantum Physics Reel' });
      const interpreted = commandInterpreter.interpret('share this reel');
      expect(interpreted.intent).toBe('SHARE_CONTENT');
      expect(interpreted.resolvedPronouns['this']).toBeDefined();
    });

    it('should resolve relative navigation ("go to messages")', () => {
      screenStateManager.updateApp('Instagram');
      const interpreted = commandInterpreter.interpret('go to messages');
      expect(interpreted.intent).toBe('NAVIGATE_MESSAGES');
    });
  });

  describe('3. Application Adapter Registry', () => {
    it('should resolve WhatsApp adapter for WhatsApp queries', () => {
      const adapter = applicationAdapterRegistry.resolveAdapter('whatsapp');
      expect(adapter.id).toBe('whatsapp');
    });

    it('should resolve YouTube adapter for YouTube queries', () => {
      const adapter = applicationAdapterRegistry.resolveAdapter('youtube');
      expect(adapter.id).toBe('youtube');
    });

    it('should resolve Instagram adapter for Instagram queries', () => {
      const adapter = applicationAdapterRegistry.resolveAdapter('instagram');
      expect(adapter.id).toBe('instagram');
    });

    it('should resolve GenericWebAdapter fallback for unknown websites', () => {
      const adapter = applicationAdapterRegistry.resolveAdapter('some-unknown-site.com');
      expect(adapter.id).toBe('generic_web');
    });
  });

  describe('4. Action Verifier', () => {
    it('should verify expected URL patterns', async () => {
      const res = await actionVerifier.verify({
        id: 'a1',
        type: 'NAVIGATE',
        timeoutMs: 1000,
        riskLevel: 'LOW',
        description: 'test nav',
        expectedState: { urlPattern: 'http' },
      });
      expect(res).toBeDefined();
    });
  });

  describe('5. Computer Use Orchestrator', () => {
    it('should process a valid command through the orchestrator pipeline', async () => {
      const res = await computerUseOrchestrator.processCommand('open youtube and search Python');
      expect(res.success).toBe(true);
      expect(res.responseMessage).toBeDefined();
    });
  });
});
