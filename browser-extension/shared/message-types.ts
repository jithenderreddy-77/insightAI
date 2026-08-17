// browser-extension/shared/message-types.ts
// Shared Message Payload & Action Lifecycle Protocol Definitions

export type BridgeMessageType =
  | 'INSIGHT_HANDSHAKE_REQUEST'
  | 'INSIGHT_HANDSHAKE_RESPONSE'
  | 'INSIGHT_DISCOVER_TABS'
  | 'INSIGHT_SELECT_TARGET_TAB'
  | 'INSIGHT_EXECUTE_ACTION'
  | 'INSIGHT_ACTION_STATUS'
  | 'INSIGHT_PERCEIVE_PAGE'
  | 'INSIGHT_GET_PAGE_STATE'
  | 'INSIGHT_CANCEL_ACTION';

export type ExtensionActionLifecycle =
  | 'ACTION_REQUESTED'
  | 'ACTION_STARTED'
  | 'ACTION_COMPLETED'
  | 'ACTION_FAILED'
  | 'ACTION_TIMEOUT'
  | 'ACTION_CANCELLED';

export interface ExtensionPerceptionCandidate {
  role: string;
  name: string;
  text: string;
  selector: string;
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  enabled: boolean;
  confidence: number;
}

export interface ExtensionPageState {
  url: string;
  title: string;
  application: string;
  pageSection?: string;
  visibleText: string;
  scrollPosition: { top: number; total: number };
  loadingState: 'loading' | 'complete';
  loginState: 'logged_in' | 'login_required';
  captchaState: 'clean' | 'captcha_detected';
  timestamp: number;
}

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
    pageState?: ExtensionPageState;
    matchedCandidate?: ExtensionPerceptionCandidate;
    executionTimeMs?: number;
  };
  error?: string;
}

export interface BridgeMessageEnvelope {
  source: 'INSIGHT_WEB_APP' | 'INSIGHT_EXTENSION_SERVICE_WORKER' | 'INSIGHT_CONTENT_SCRIPT';
  type: BridgeMessageType;
  nonce: string;
  origin: string;
  timestamp: number;
  payload: any;
}
