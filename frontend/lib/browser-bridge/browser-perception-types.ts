// frontend/lib/browser-bridge/browser-perception-types.ts
// Perception & Observation Types for Real Browser Bridge

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
