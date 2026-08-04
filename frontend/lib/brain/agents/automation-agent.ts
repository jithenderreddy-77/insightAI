// frontend/lib/brain/agents/automation-agent.ts
// Automation Agent — Handles app launching, website navigation, desktop/browser actions.

import { toolRegistry, type ToolContext, type ToolResult } from '../tool-registry';

export async function runAutomationAgent(
  transcript: string,
  context: ToolContext,
): Promise<ToolResult> {
  const q = transcript.toLowerCase();

  // 1. Website or App launch
  if (q.startsWith('open ') || q.startsWith('launch ') || q.startsWith('go to ')) {
    const target = q.replace(/^(open|launch|go to)\s+/i, '').replace(/\s+(app|website|for me)$/i, '').trim();
    return await toolRegistry.execute('open_website', { url: target }, context);
  }

  // 2. Application actions (e.g. upload file, clear chat)
  if (q.includes('upload') || q.includes('add file')) {
    return await toolRegistry.execute('app_action', { action: 'upload_document' }, context);
  }

  // Fallback
  return await toolRegistry.execute('open_website', { url: transcript }, context);
}
