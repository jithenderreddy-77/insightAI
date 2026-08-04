// frontend/lib/brain/agents/communication-agent.ts
// Communication Agent — Handles contact resolution, email drafting, messaging, and approval queueing.

import { toolRegistry, type ToolContext, type ToolResult } from '../tool-registry';

export async function runCommunicationAgent(
  transcript: string,
  context: ToolContext,
): Promise<ToolResult> {
  const q = transcript.toLowerCase();

  // Email request detection
  if (q.includes('email') || q.includes('mail')) {
    const toMatch = transcript.match(/to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z\s]+)/i);
    const recipient = toMatch ? toMatch[1].trim() : 'someone@gmail.com';

    const bodyMatch = transcript.match(/(requesting|saying|about)\s+(.+)/i);
    const emailBody = bodyMatch ? bodyMatch[2].trim() : 'Leave request due to fever.';

    return {
      success: true,
      data: {
        action: 'draft_created',
        recipient,
        subject: `Leave Request — ${context.userName}`,
        body: `Dear HR,\n\nI am writing to formally request leave due to health reasons (${emailBody}).\n\nThank you for your understanding.\n\nBest regards,\n${context.userName}`,
      },
      clientAction: {
        type: 'APP_ACTION',
        payload: {
          requiresApproval: true,
          type: 'email',
          summary: `Draft Email to ${recipient}: Leave Request`,
          details: {
            to: recipient,
            subject: `Leave Request — ${context.userName}`,
            body: `Dear HR,\n\nI am writing to formally request leave due to health reasons (${emailBody}).\n\nThank you for your understanding.\n\nBest regards,\n${context.userName}`,
          },
        },
      },
    };
  }

  // Standard contact resolution (WhatsApp / Call)
  const contactName = transcript
    .replace(/^(open|send|call|message|text)\s+/i, '')
    .replace(/(whatsapp|chat|message|call)\s+/i, '')
    .trim();

  const channel = q.includes('whatsapp') ? 'whatsapp' : q.includes('email') ? 'email' : 'call';

  return await toolRegistry.execute('contact_action', { contactName, channel }, context);
}
