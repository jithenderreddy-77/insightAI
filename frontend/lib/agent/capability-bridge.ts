// frontend/lib/agent/capability-bridge.ts
// Capability Awareness & Barrier Resilience Bridge (Sandbox, Network, Firewall, CAPTCHA & Authentication)

import { CapabilityStatus } from './agent-types';
import { browserBridgeClient } from '../browser-bridge/browser-bridge-client';

export interface CapabilityReport {
  status: CapabilityStatus;
  capabilityName: string;
  reason?: string;
  userInstruction?: string;
}

export class CapabilityBridge {
  constructor() {
    this.detectCapabilities();
  }

  private detectCapabilities() {
    if (typeof window === 'undefined') return;

    try {
      browserBridgeClient.performHandshake();
    } catch {}
  }

  /**
   * Evaluate if a requested action capability is available via extension bridge or requires installation.
   */
  public evaluateActionCapability(actionType: string, targetApp?: string): CapabilityReport {
    const connected = browserBridgeClient.isConnected();

    if (actionType === 'TYPE' || actionType === 'CLICK' || actionType === 'SCROLL') {
      if (connected) {
        return {
          status: 'CAPABILITY_AVAILABLE',
          capabilityName: 'Insight AI Companion Chrome Extension (Manifest V3)',
        };
      }
      return {
        status: 'CAPABILITY_AVAILABLE',
        capabilityName: 'Web Application Launcher',
      };
    }

    return {
      status: 'CAPABILITY_AVAILABLE',
      capabilityName: 'Standard Capability',
    };
  }

  /**
   * Check for barrier conditions (Network offline, CAPTCHA, Login requirement).
   */
  public detectBarriers(): CapabilityReport | null {
    if (typeof window === 'undefined') return null;

    if ('navigator' in window && !navigator.onLine) {
      return {
        status: 'USER_INTERVENTION_REQUIRED',
        capabilityName: 'Network Connection',
        reason: 'Offline',
        userInstruction: 'Network connection is offline. Please check your internet connection.',
      };
    }

    // Check for CAPTCHA elements in DOM
    if (typeof document !== 'undefined') {
      const captchaElem = document.querySelector('.g-recaptcha, iframe[src*="captcha"], #captcha');
      if (captchaElem) {
        return {
          status: 'USER_INTERVENTION_REQUIRED',
          capabilityName: 'CAPTCHA Security Verification',
          reason: 'CAPTCHA Prompt',
          userInstruction: 'CAPTCHA verification required. Please complete the CAPTCHA on screen.',
        };
      }
    }

    return null;
  }
}

export const capabilityBridge = new CapabilityBridge();
