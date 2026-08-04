// frontend/lib/brain/agents/document-agent.ts
// Document Agent — Handles document QA, summarization, PDF & file intelligence.

import { toolRegistry, type ToolContext, type ToolResult } from '../tool-registry';

export async function runDocumentAgent(
  query: string,
  context: ToolContext,
): Promise<ToolResult> {
  return await toolRegistry.execute('document_qa', { query }, context);
}
