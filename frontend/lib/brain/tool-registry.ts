// frontend/lib/brain/tool-registry.ts
// Self-describing tool system — each tool declares its own name, description,
// and parameter schema so the LLM can dynamically choose which tools to use.

import { z, ZodType } from 'zod';

// ─────────────────────────────────────────────────────────
// CORE TYPES
// ─────────────────────────────────────────────────────────

/** Result returned by every tool execution */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  /** Client-side action the frontend should execute (open URL, trigger UI, etc.) */
  clientAction?: ClientAction;
}

/** Actions the client (voice modal) must execute after receiving a Brain response */
export interface ClientAction {
  type:
    | 'OPEN_URL'
    | 'PHONE_CALL'
    | 'APP_ACTION'
    | 'DOCUMENT_QA'
    | 'DISAMBIGUATE_CONTACT'
    | 'CONTACT_NOT_FOUND'
    | 'SHOW_REMINDER'
    | 'NONE';
  payload: Record<string, any>;
}

/** Tool definition — self-describing for LLM consumption */
export interface ToolDefinition<TParams = any> {
  name: string;
  description: string;
  /** Human-readable parameter descriptions for the LLM system prompt */
  parameterDescriptions: Record<string, string>;
  /** Zod schema for runtime validation */
  parameterSchema: ZodType<TParams>;
  /** Execute the tool with validated parameters */
  execute: (params: TParams, context: ToolContext) => Promise<ToolResult>;
}

/** Context passed to every tool execution */
export interface ToolContext {
  /** User's saved contacts */
  userContacts: any[];
  /** Whether user has active uploaded documents */
  hasActiveDocuments: boolean;
  /** User's first name */
  userName: string;
  /** Original transcript */
  transcript: string;
  /** OpenAI API key */
  openaiApiKey?: string;
  /** NVIDIA API key */
  nvidiaApiKey?: string;
}

// ─────────────────────────────────────────────────────────
// TOOL REGISTRY
// ─────────────────────────────────────────────────────────

class ToolRegistryImpl {
  private tools: Map<string, ToolDefinition> = new Map();

  /** Register a tool */
  register<T>(tool: ToolDefinition<T>): void {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool "${tool.name}" is already registered. Overwriting.`);
    }
    this.tools.set(tool.name, tool as ToolDefinition);
  }

  /** Get a tool by name */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Get all registered tools */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** Get all tool names */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Generate a compact tool description block for the LLM system prompt.
   * Format optimized for token efficiency while maintaining clarity.
   */
  generateToolDescriptions(): string {
    const tools = this.getAll();
    if (tools.length === 0) return 'No tools available.';

    return tools
      .map((tool) => {
        const params = Object.entries(tool.parameterDescriptions)
          .map(([key, desc]) => `    - ${key}: ${desc}`)
          .join('\n');
        return `• ${tool.name}: ${tool.description}\n  Parameters:\n${params}`;
      })
      .join('\n\n');
  }

  /**
   * Execute a tool by name with parameter validation.
   * Returns a ToolResult — never throws.
   */
  async execute(
    toolName: string,
    rawParams: Record<string, any>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        success: false,
        error: `Unknown tool "${toolName}". Available tools: ${this.getNames().join(', ')}`,
      };
    }

    // Validate parameters against Zod schema
    const parseResult = tool.parameterSchema.safeParse(rawParams);
    if (!parseResult.success) {
      return {
        success: false,
        error: `Invalid parameters for "${toolName}": ${parseResult.error.message}`,
      };
    }

    try {
      return await tool.execute(parseResult.data, context);
    } catch (err: any) {
      console.error(`Tool "${toolName}" execution error:`, err);
      return {
        success: false,
        error: `Tool "${toolName}" failed: ${err.message || 'Unknown error'}`,
      };
    }
  }
}

/** Singleton tool registry */
export const toolRegistry = new ToolRegistryImpl();
