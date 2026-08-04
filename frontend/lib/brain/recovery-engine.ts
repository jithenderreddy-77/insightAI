// frontend/lib/brain/recovery-engine.ts
// Multi-Stage Recovery & Verification Engine for Insight AI OS.
// Fallback hierarchy: Native App ➔ Existing Browser Tab ➔ New Web Tab ➔ Setup/Permission Guide.
// Ensures the assistant never stops after a single failure.

import { resolveAppTarget, type NavigationTarget } from './app-registry';

export interface RecoveryPlan {
  originalTarget: string;
  attempts: {
    stage: 'native' | 'existing_tab' | 'new_tab' | 'setup_guide';
    description: string;
  }[];
  finalTarget: NavigationTarget;
  spokenGuidance: string;
}

/**
 * Build a multi-stage recovery strategy for a target application or action.
 */
export function buildRecoveryStrategy(targetQuery: string): RecoveryPlan {
  const target = resolveAppTarget(targetQuery);
  const attempts: RecoveryPlan['attempts'] = [];

  if (target.nativeScheme) {
    attempts.push({ stage: 'native', description: `Attempting native application: ${target.appName}` });
  }

  if (target.reusedExistingTab) {
    attempts.push({ stage: 'existing_tab', description: `Reusing existing browser tab for ${target.appName}` });
  } else {
    attempts.push({ stage: 'new_tab', description: `Opening browser session tab: ${target.url}` });
  }

  attempts.push({ stage: 'setup_guide', description: `Providing setup guidance if login/permissions required` });

  let spokenGuidance = `Opening ${target.appName}.`;
  if (target.reusedExistingTab) {
    spokenGuidance = `Reusing your active ${target.appName} session.`;
  }

  return {
    originalTarget: targetQuery,
    attempts,
    finalTarget: target,
    spokenGuidance,
  };
}
