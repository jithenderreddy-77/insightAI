// frontend/lib/brain/tools/memory-tool.ts
// Memory tool — allows the Brain to remember facts and recall past knowledge
// Replaces the simple note-tool.ts with full memory system integration

import { z } from 'zod';
import { type ToolDefinition, type ToolResult, type ToolContext } from '../tool-registry';
import { remember, recall, setCustomPreference, getCustomPreference } from '../memory-manager';

const parameterSchema = z.object({
  action: z.enum(['remember', 'recall', 'set_preference']).describe('What memory action to perform'),
  content: z.string().describe('The fact/note to remember, or the query to search memories'),
  category: z
    .enum(['preference', 'fact', 'interaction', 'habit', 'note'])
    .optional()
    .describe('Category for the memory'),
  preferenceKey: z.string().optional().describe('Preference key when action is set_preference'),
});

type Params = z.infer<typeof parameterSchema>;

async function execute(params: Params, context: ToolContext): Promise<ToolResult> {
  const { action, content, category = 'fact', preferenceKey } = params;

  if (action === 'remember') {
    const memory = remember(content, category, {
      importance: category === 'preference' ? 8 : 5,
      source: 'voice',
      tags: content.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5),
    });

    return {
      success: true,
      data: {
        action: 'remembered',
        memory: { id: memory.id, content: memory.content, category: memory.category },
      },
    };
  }

  if (action === 'recall') {
    const memories = recall(content, 5);

    if (memories.length === 0) {
      return {
        success: true,
        data: {
          action: 'recall',
          query: content,
          results: [],
          message: `I don't have any memories about "${content}" yet.`,
        },
      };
    }

    return {
      success: true,
      data: {
        action: 'recall',
        query: content,
        results: memories.map(m => ({
          content: m.content,
          category: m.category,
          createdAt: m.createdAt,
        })),
        message: memories.map(m => m.content).join('. '),
      },
    };
  }

  if (action === 'set_preference' && preferenceKey) {
    setCustomPreference(preferenceKey, content);
    return {
      success: true,
      data: {
        action: 'preference_set',
        key: preferenceKey,
        value: content,
      },
    };
  }

  return { success: false, error: 'Invalid memory action' };
}

export const memoryTool: ToolDefinition<Params> = {
  name: 'memory',
  description:
    'Remember facts, recall past knowledge, or save user preferences. Use when the user says "remember that...", "don\'t forget...", "what did I tell you about...", "my favorite X is Y", or any request to store/retrieve personal information.',
  parameterDescriptions: {
    action: '"remember" to save a fact, "recall" to search memories, "set_preference" to save a preference',
    content: 'The fact to remember, the search query, or the preference value',
    category: '(Optional) Memory category: "preference", "fact", "interaction", "habit", or "note"',
    preferenceKey: '(Optional) Preference key like "favorite_color", "preferred_language" (for set_preference action)',
  },
  parameterSchema,
  execute,
};
