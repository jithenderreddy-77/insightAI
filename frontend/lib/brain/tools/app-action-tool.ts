// frontend/lib/brain/tools/app-action-tool.ts
// Internal app UI triggers — upload document, new chat, history, auth, install

import { z } from 'zod';
import { type ToolDefinition, type ToolResult, type ToolContext } from '../tool-registry';

const parameterSchema = z.object({
  action: z.enum([
    'upload_document',
    'new_chat',
    'open_history',
    'open_auth',
    'install_app',
  ]).describe('Which app action to perform'),
});

type Params = z.infer<typeof parameterSchema>;

const ACTION_LABELS: Record<string, string> = {
  upload_document: 'Opening document upload picker',
  new_chat: 'Starting a fresh new chat',
  open_history: 'Opening your chat history',
  open_auth: 'Opening sign-in screen',
  install_app: 'Opening app installation dialog',
};

async function execute(params: Params, _context: ToolContext): Promise<ToolResult> {
  const { action } = params;

  return {
    success: true,
    data: {
      action,
      label: ACTION_LABELS[action] || 'Executing app command',
    },
    clientAction: {
      type: 'APP_ACTION',
      payload: { appAction: action },
    },
  };
}

export const appActionTool: ToolDefinition<Params> = {
  name: 'app_action',
  description:
    'Trigger internal app actions: upload a document/PDF, start a new chat conversation, open chat history, open sign-in, or install the app as PWA.',
  parameterDescriptions: {
    action:
      'Which action: "upload_document", "new_chat", "open_history", "open_auth", or "install_app"',
  },
  parameterSchema,
  execute,
};
