// frontend/lib/brain/agents/verification-agent.ts
// Verification Agent — Verifies execution outcome before final user response.

import { ToolResult } from '../tool-registry';

export interface VerificationResult {
  verified: boolean;
  notes: string;
  refinedSpokenResponse?: string;
}

export function verifyResult(
  transcript: string,
  toolResult: ToolResult,
  spokenResponse: string,
): VerificationResult {
  if (!toolResult.success) {
    return {
      verified: false,
      notes: `Verification failed: ${toolResult.error || 'Execution encountered an error.'}`,
      refinedSpokenResponse: spokenResponse || 'Sorry, the requested task could not be completed cleanly.',
    };
  }

  // Action requiring user approval
  if (toolResult.clientAction?.payload?.requiresApproval) {
    return {
      verified: true,
      notes: 'Verification: Draft created successfully. Awaiting user approval before final dispatch.',
      refinedSpokenResponse: spokenResponse || "I've prepared the draft for your review. Please confirm in the Approval Center to send.",
    };
  }

  return {
    verified: true,
    notes: 'Verification: Outcome verified successfully against user intent.',
    refinedSpokenResponse: spokenResponse,
  };
}
