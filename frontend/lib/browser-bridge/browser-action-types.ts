// frontend/lib/browser-bridge/browser-action-types.ts
// Browser Action Lifecycle & Payload Definitions

export type ExtensionActionLifecycle =
  | 'ACTION_REQUESTED'
  | 'ACTION_STARTED'
  | 'ACTION_COMPLETED'
  | 'ACTION_FAILED'
  | 'ACTION_TIMEOUT'
  | 'ACTION_CANCELLED';

export interface ExtensionActionPayload {
  actionId: string;
  type: 'CLICK' | 'TYPE' | 'SCROLL' | 'SELECT' | 'PRESS_KEY' | 'NAVIGATE' | 'GO_BACK';
  targetQuery?: string;
  value?: string;
  timeoutMs: number;
  expectedState?: {
    urlPattern?: string;
    elementText?: string;
    focusedInput?: boolean;
  };
}

export interface ExtensionActionStatusReport {
  actionId: string;
  lifecycle: ExtensionActionLifecycle;
  success: boolean;
  message?: string;
  evidence?: {
    pageState?: any;
    matchedCandidate?: any;
    executionTimeMs?: number;
  };
  error?: string;
}
