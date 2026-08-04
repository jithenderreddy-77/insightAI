// frontend/lib/brain/tools/note-tool.ts
// Save and retrieve personal notes to memory

import { z } from 'zod';
import { type ToolDefinition, type ToolResult, type ToolContext } from '../tool-registry';

const parameterSchema = z.object({
  action: z.enum(['save', 'search']).describe('Whether to save a new note or search existing notes'),
  content: z.string().describe('The note content to save, or the search query to find notes'),
  category: z
    .enum(['general', 'preference', 'fact', 'todo', 'idea'])
    .optional()
    .describe('Category for the note'),
});

type Params = z.infer<typeof parameterSchema>;

const NOTES_STORAGE_KEY = 'insight_brain_notes';

function getStoredNotes(): Array<{ id: string; content: string; category: string; createdAt: string }> {
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    try {
      return JSON.parse(localStorage.getItem(NOTES_STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }
  return [];
}

function saveNote(content: string, category: string): { id: string; content: string; category: string; createdAt: string } {
  const notes = getStoredNotes();
  const note = {
    id: `note_${Date.now()}`,
    content,
    category,
    createdAt: new Date().toISOString(),
  };
  notes.push(note);

  // Keep only the latest 200 notes
  const trimmed = notes.slice(-200);
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(trimmed));
  }
  return note;
}

function searchNotes(query: string): Array<{ id: string; content: string; category: string; createdAt: string }> {
  const notes = getStoredNotes();
  const queryLower = query.toLowerCase();
  return notes
    .filter((n) => n.content.toLowerCase().includes(queryLower))
    .slice(-10); // Return latest 10 matching notes
}

async function execute(params: Params, _context: ToolContext): Promise<ToolResult> {
  const { action, content, category = 'general' } = params;

  if (action === 'save') {
    const note = saveNote(content, category);
    return {
      success: true,
      data: { action: 'saved', note },
    };
  }

  // action === 'search'
  const results = searchNotes(content);
  return {
    success: true,
    data: {
      action: 'search',
      query: content,
      results,
      count: results.length,
    },
  };
}

export const noteTool: ToolDefinition<Params> = {
  name: 'take_note',
  description:
    'Save a personal note or search through saved notes. Use when the user says "remember that...", "note down...", "save this...", or "what did I say about...". Notes persist across sessions.',
  parameterDescriptions: {
    action: '"save" to create a note, "search" to find existing notes',
    content: 'The note text to save, or the search query to find notes',
    category: '(Optional) Category: "general", "preference", "fact", "todo", or "idea"',
  },
  parameterSchema,
  execute,
};
