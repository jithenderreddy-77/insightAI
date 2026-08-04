// frontend/lib/brain/tools/document-qa-tool.ts
// Triggers Document QA (RAG pipeline) for uploaded PDFs

import { z } from 'zod';
import { type ToolDefinition, type ToolResult, type ToolContext } from '../tool-registry';

const parameterSchema = z.object({
  query: z.string().describe('The question to ask about the uploaded document'),
});

type Params = z.infer<typeof parameterSchema>;

async function execute(params: Params, context: ToolContext): Promise<ToolResult> {
  const { query } = params;

  if (!context.hasActiveDocuments) {
    return {
      success: false,
      error: 'No documents are currently uploaded. Please upload a PDF or document first.',
      clientAction: {
        type: 'APP_ACTION',
        payload: { appAction: 'upload_document' },
      },
    };
  }

  return {
    success: true,
    data: {
      query,
      hasDocuments: true,
    },
    clientAction: {
      type: 'DOCUMENT_QA',
      payload: { query },
    },
  };
}

export const documentQATool: ToolDefinition<Params> = {
  name: 'document_qa',
  description:
    'Ask questions about the user\'s currently uploaded PDF documents. Use when the user asks about their resume, uploaded file, document contents, or says "summarize my document". Requires documents to be uploaded first.',
  parameterDescriptions: {
    query: 'The question about the document (e.g. "Summarize this PDF", "What skills are listed?")',
  },
  parameterSchema,
  execute,
};
