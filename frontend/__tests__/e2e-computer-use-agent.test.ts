// frontend/__tests__/e2e-computer-use-agent.test.ts
// Real-World End-to-End Computer-Use Agent Test Suite

import { computerUseOrchestrator } from '../lib/agent/computer-use-orchestrator';
import { continuousSession } from '../lib/agent/continuous-session';
import { screenStateManager } from '../lib/agent/screen-state-manager';
import { taskContextManager } from '../lib/agent/task-context';
import { commandInterpreter } from '../lib/agent/command-interpreter';
import { disambiguationEngine } from '../lib/entities/disambiguation-engine';
import { scrollingEngine } from '../lib/automation/scrolling-engine';
import { navigationEngine } from '../lib/automation/navigation-engine';
import { shareEngine } from '../lib/automation/share-engine';
import { agentRecoveryEngine } from '../lib/agent/agent-recovery-engine';
import { capabilityBridge } from '../lib/agent/capability-bridge';

describe('Real-World E2E Computer-Use Voice Agent Suite', () => {
  beforeEach(() => {
    taskContextManager.resetContext();
    continuousSession.startSession();
  });

  afterEach(() => {
    continuousSession.stopSession();
  });

  describe('1. E2E Continuous Instagram Multi-Turn Session', () => {
    it('should maintain active application state across multi-turn voice commands', async () => {
      // Turn 1: Open Instagram
      const turn1 = await computerUseOrchestrator.processCommand('Open Instagram');
      expect(turn1.success).toBe(true);
      expect(screenStateManager.getScreenState().application).toBe('instagram');

      // Turn 2: Go to messages
      const turn2 = await computerUseOrchestrator.processCommand('Go to messages');
      expect(turn2.success).toBe(true);

      // Turn 3: Go back
      const turn3 = await computerUseOrchestrator.processCommand('Go back');
      expect(turn3.success).toBe(true);

      // Turn 4: Go to reels
      const turn4 = await computerUseOrchestrator.processCommand('Go to reels');
      expect(turn4.success).toBe(true);

      // Session remains active
      expect(continuousSession.isActive()).toBe(true);
    });
  });

  describe('2. E2E Ambiguous Contact Disambiguation', () => {
    it('should prompt for disambiguation when multiple contacts match and resolve selection by index', () => {
      const candidates = [
        { id: 'c1', type: 'contact' as const, name: 'Rahul Kumar' },
        { id: 'c2', type: 'contact' as const, name: 'Rahul Reddy' },
        { id: 'c3', type: 'contact' as const, name: 'Rahul Sharma' },
      ];

      const disambigReq = disambiguationEngine.evaluateCandidates('Rahul', candidates);
      expect(disambigReq).not.toBeNull();
      expect(disambigReq?.candidates.length).toBe(3);
      expect(disambigReq?.promptVoiceMessage).toContain('I found 3 matching candidates');

      // Follow-up: "The second one"
      const selected = disambiguationEngine.resolveSelection('The second one', candidates);
      expect(selected?.name).toBe('Rahul Reddy');
    });
  });

  describe('3. E2E Pronoun & Context References ("it", "this reel", "him")', () => {
    it('should resolve "it" and "him" relative to ScreenState and remembered entity context', () => {
      screenStateManager.setSelectedEntity({ id: 'reel_101', type: 'reel', name: 'Quantum AI Reel' });
      taskContextManager.rememberEntity('contact', { id: 'c2', type: 'contact', name: 'Rahul Reddy' });

      const interpreted = commandInterpreter.interpret('Send him this reel');
      expect(interpreted.resolvedPronouns['this']).toBeDefined();
      expect(interpreted.resolvedPronouns['him']).toBeDefined();
      expect((interpreted.resolvedPronouns['him'] as any).name).toBe('Rahul Reddy');
    });
  });

  describe('4. E2E Universal Scrolling & Scroll-Until-Condition', () => {
    it('should execute scroll commands and scrollUntilCondition without crashing', async () => {
      const scrollRes = scrollingEngine.scroll('down');
      expect(scrollRes.success).toBe(true);

      const conditionRes = await scrollingEngine.scrollUntilCondition('quantum computing', 2);
      expect(conditionRes.scrollsExecuted).toBeGreaterThan(0);
    });
  });

  describe('5. E2E Self-Recovery Engine & Network Barriers', () => {
    it('should classify failure categories and return recovery strategy', () => {
      const category = agentRecoveryEngine.classifyFailure('Network request timeout');
      expect(category).toBe('NETWORK_DELAY');

      const strategy = agentRecoveryEngine.getStrategy(category, {
        id: 'act_timeout',
        type: 'OPEN_APP',
        timeoutMs: 1000,
        riskLevel: 'LOW',
        description: 'Test action',
      });
      expect(strategy.reobserve).toBe(true);
    });

    it('should evaluate capability barriers via capabilityBridge', () => {
      const report = capabilityBridge.evaluateActionCapability('CLICK', 'Instagram');
      expect(report.status).toBe('CAPABILITY_AVAILABLE');
    });
  });

  describe('6. E2E Complex Single-Prompt Multi-Step Goal Decomposition', () => {
    it('should break down complex prompt into structured execution turns', async () => {
      const goal = 'Open Instagram, find Rahul, open his profile, go to his reels, open the second reel, and send it to Priya.';
      const res = await computerUseOrchestrator.processCommand(goal);
      expect(res.success).toBe(true);
    });
  });
});
