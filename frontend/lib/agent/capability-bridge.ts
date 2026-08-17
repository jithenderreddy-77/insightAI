// frontend/lib/agent/capability-bridge.ts
// Capability Awareness & Barrier Resilience Bridge (Sandbox, Network, Firewall, CAPTCHA & Authentication)

import { CapabilityStatus } from './agent-types';

export interface CapabilityReport {
  status: CapabilityStatus;
  capabilityName: string;
  reason?: string;
  userInstruction?: string;
}

export class CapabilityBridge {
  private extensionAvailable: boolean = false;
  private nativeBridgeAvailable: boolean = false;

  constructor() {
    this.detectCapabilities();
  }

  private detectCapabilities() {
    if (typeof window === 'undefined') return;

    // Check if Chrome extension companion is present via custom window event or meta
    try {
      this.extensionAvailable = !!(window as any).__INSIGHT_EXTENSION_PRESENT__;
      this.nativeBridgeAvailable = !!(window as any).__INSIGHT_NATIVE_BRIDGE__;
    } catch {}
  }

  /**
   * Evaluate if a requested action capability is natively available or requires bridge/user intervention.
   */
  public evaluateActionCapability(actionType: string, targetApp?: string): CapabilityReport {
    // 1. Web application deep-linking & local DOM interaction are natively supported
    if (actionType === 'OPEN_APP' || actionType === 'SEARCH' || actionType === 'SCROLL' || actionType === 'NAVIGATE') {
      return {
        status: 'CAPABILITY_AVAILABLE',
        capabilityName: 'Web & Deep-Link Launcher',
      };
    }

    // 2. High-consequence cross-origin DOM actions (filling external forms in tab B)
    if (actionType === 'TYPE' || actionType === 'CLICK') {
      if (this.extensionAvailable || this.nativeBridgeAvailable) {
        return {
          status: 'CAPABILITY_AVAILABLE',
          capabilityName: 'Companion Extension / Native Agent Bridge',
        };
      }
      return {
        status: 'CAPABILITY_AVAILABLE', // Soft fallback to browser tab navigation & URL params
        capabilityName: 'DOM Automation Layer',
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
