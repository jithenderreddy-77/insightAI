// frontend/lib/brain/tools/index.ts
// Central tool registration — imports and registers all tools into the registry

import { toolRegistry } from '../tool-registry';
import { webSearchTool } from './web-search-tool';
import { contactTool } from './contact-tool';
import { websiteTool } from './website-tool';
import { appActionTool } from './app-action-tool';
import { documentQATool } from './document-qa-tool';
import { reminderTool } from './reminder-tool';
import { noteTool } from './note-tool';
import { memoryTool } from './memory-tool';
import { transactionTool } from './transaction-tool';

let registered = false;

/**
 * Register all tools with the global tool registry.
 * Safe to call multiple times — only registers once.
 */
export function registerAllTools(): void {
  if (registered) return;

  toolRegistry.register(webSearchTool);
  toolRegistry.register(contactTool);
  toolRegistry.register(websiteTool);
  toolRegistry.register(appActionTool);
  toolRegistry.register(documentQATool);
  toolRegistry.register(reminderTool);
  toolRegistry.register(noteTool);
  toolRegistry.register(memoryTool);
  toolRegistry.register(transactionTool);

  registered = true;
}
