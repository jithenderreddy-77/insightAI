// browser-extension/shared/protocol.ts
// Security Protocol & Nonce Validation Helpers

import { BridgeMessageEnvelope, BridgeMessageType } from './message-types';

export class ProtocolSecurity {
  public static generateNonce(): string {
    return `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  public static generateActionId(): string {
    return `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  public static isValidOrigin(origin: string): boolean {
    if (!origin) return false;
    const clean = origin.toLowerCase();
    return (
      clean.includes('insight-ai-frontend-kappa.vercel.app') ||
      clean.includes('localhost') ||
      clean.includes('127.0.0.1')
    );
  }

  public static isExpiredTimestamp(timestamp: number, maxAgeMs = 10000): boolean {
    return Date.now() - timestamp > maxAgeMs;
  }

  public static createEnvelope(
    source: BridgeMessageEnvelope['source'],
    type: BridgeMessageType,
    payload: any,
    origin: string = typeof window !== 'undefined' ? window.location.origin : 'https://insight-ai-frontend-kappa.vercel.app'
  ): BridgeMessageEnvelope {
    return {
      source,
      type,
      nonce: this.generateNonce(),
      origin,
      timestamp: Date.now(),
      payload,
    };
  }
}
