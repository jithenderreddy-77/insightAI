// frontend/lib/brain/agents/research-agent.ts
// Research Agent — Handles live web searching, news aggregation, and web synthesis.

import { toolRegistry, type ToolContext, type ToolResult } from '../tool-registry';

export async function runResearchAgent(
  query: string,
  context: ToolContext,
): Promise<ToolResult> {
  return await toolRegistry.execute('web_search', { query }, context);
}
