// frontend/lib/agent/agent-types.ts
// Core Data Types & Interfaces for the Insight AI Autonomous Computer Control Agent

export type AgentState =
  | 'IDLE'
  | 'LISTENING'
  | 'UNDERSTANDING'
  | 'PLANNING'
  | 'OPENING_APP'
  | 'OBSERVING'
  | 'SEARCHING'
  | 'SELECTING'
  | 'WAITING_FOR_USER'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'RECOVERING'
  | 'COMPLETED'
  | 'FAILED';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type ActionType =
  | 'OPEN_APP'
  | 'NAVIGATE'
  | 'CLICK'
  | 'TYPE'
  | 'SCROLL'
  | 'PRESS_KEY'
  | 'SEARCH'
  | 'SELECT'
  | 'GO_BACK'
  | 'SHARE'
  | 'WAIT'
  | 'ASK_USER';

export interface ExpectedState {
  urlPattern?: string;
  elementRole?: string;
  elementText?: string;
  elementSelector?: string;
  pageTitlePattern?: string;
  focusedInput?: boolean;
  valueEquals?: string;
  messageSent?: boolean;
}

export interface AgentAction {
  id: string;
  type: ActionType;
  target?: string;
  value?: string;
  expectedState?: ExpectedState;
  timeoutMs: number;
  riskLevel: RiskLevel;
  description: string;
}

export interface UIEntity {
  id: string;
  type: 'contact' | 'video' | 'reel' | 'product' | 'email' | 'file' | 'link' | 'text';
  name: string;
  description?: string;
  index?: number;
  elementSelector?: string;
  metadata?: Record<string, any>;
}

export interface UIAction {
  id: string;
  label: string;
  type: ActionType;
  selector?: string;
  enabled: boolean;
}

export interface ScrollContainer {
  id: string;
  selector?: string;
  isWindow: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface UIDialog {
  id: string;
  title?: string;
  type: 'modal' | 'alert' | 'confirm' | 'prompt' | 'popup';
  visible: boolean;
}

export interface ScreenState {
  application?: string;
  url?: string;
  pageTitle?: string;
  currentPage?: string;
  selectedEntity?: UIEntity;
  visibleEntities: UIEntity[];
  visibleActions: UIAction[];
  scrollContainers: ScrollContainer[];
  dialogs: UIDialog[];
  lastSuccessfulAction?: AgentAction;
  screenHash?: string;
  timestamp: number;
}

export interface UIObservation {
  url?: string;
  title?: string;
  elements: Array<{
    role: string;
    text: string;
    ariaLabel?: string;
    placeholder?: string;
    value?: string;
    selector?: string;
    enabled: boolean;
    visible: boolean;
    clickable: boolean;
    editable: boolean;
  }>;
  scrollContainers: ScrollContainer[];
  dialogs: UIDialog[];
  visibleText: string;
  application?: string;
  pageState?: string;
}

export interface VerificationResult {
  success: boolean;
  actualState?: string;
  mismatchReason?: string;
}

export type FailureCategory =
  | 'ELEMENT_NOT_FOUND'
  | 'PAGE_NOT_READY'
  | 'NETWORK_DELAY'
  | 'WRONG_PAGE'
  | 'WRONG_ELEMENT'
  | 'POPUP_BLOCKING'
  | 'LOGIN_REQUIRED'
  | 'PERMISSION_REQUIRED'
  | 'CAPTCHA_REQUIRED'
  | 'SCROLL_FAILURE'
  | 'FOCUS_FAILURE'
  | 'STT_ERROR'
  | 'AMBIGUOUS_ENTITY'
  | 'TIMEOUT'
  | 'APPLICATION_NOT_AVAILABLE';

export interface RecoveryStrategy {
  category: FailureCategory;
  maxRetries: number;
  alternateSelector?: string;
  scrollIntoView?: boolean;
  reobserve?: boolean;
  userEscalationMessage?: string;
}

export interface AutomationPreferences {
  autoExecuteLowRisk: boolean;
  confirmMessages: boolean;
  confirmSharing: boolean;
  confirmPurchases: boolean;
  confirmDeletion: boolean;
  trustedApplications: string[];
}

export type CapabilityStatus =
  | 'CAPABILITY_AVAILABLE'
  | 'CAPABILITY_UNAVAILABLE'
  | 'PERMISSION_REQUIRED'
  | 'USER_INTERVENTION_REQUIRED';
