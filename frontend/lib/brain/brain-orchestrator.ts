// frontend/lib/brain/brain-orchestrator.ts
// Core Brain — the intelligent orchestrator that reasons, plans, and executes.
// Replaces the monolithic if/else intent router with a ReAct-pattern agent.

import { toolRegistry, type ToolResult, type ToolContext, type ClientAction } from './tool-registry';
import { registerAllTools } from './tools';
import { buildBrainSystemPrompt, buildSynthesisPrompt, getTimeOfDayContext } from './system-prompts';
import { buildMemoryContext, remember } from './memory-manager';
import { buildPlan, executePlan, type TaskPlan } from './task-planner';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface BrainInput {
  transcript: string;
  hasActiveDocuments: boolean;
  history: Array<{ role: string; content: string }>;
  userContacts: any[];
  userName: string;
}

export interface BrainOutput {
  spokenResponse: string;
  thinking?: string;
  toolUsed?: string;
  toolResult?: ToolResult;
  clientAction?: ClientAction;
  /** For backwards compatibility with existing modal actions */
  actionType: string;
  /** Extra payload for the frontend */
  [key: string]: any;
}

interface LLMToolDecision {
  thinking: string;
  toolCall: { name: string; params: Record<string, any> } | null;
  spokenResponse: string;
}

// ─────────────────────────────────────────────────────────
// BRAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────

export async function orchestrate(input: BrainInput): Promise<BrainOutput> {
  // Ensure all tools are registered
  registerAllTools();

  const { transcript, hasActiveDocuments, history, userContacts, userName } = input;

  const openaiApiKey = process.env.OPENAI_API_KEY;
  const nvidiaApiKey = process.env.NVIDIA_API_KEY;

  // Build memory context for this query
  const memoryContext = buildMemoryContext(transcript);

  // Build dynamic system prompt with tool descriptions + memory
  const systemPrompt = buildBrainSystemPrompt({
    userName: userName || 'friend',
    hasActiveDocuments,
    contactCount: userContacts.length,
    timeOfDay: getTimeOfDayContext(),
    recentTopics: extractRecentTopics(history),
    memoryContext,
  });

  // Build conversation messages
  const recentHistory = Array.isArray(history)
    ? history.slice(-6).map((h) => ({
        role: h.role === 'user' ? 'user' as const : 'assistant' as const,
        content: typeof h.content === 'string' ? h.content : JSON.stringify(h.content),
      }))
    : [];

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...recentHistory,
    { role: 'user' as const, content: transcript },
  ];

  // ── STEP 1: LLM REASONING (decide which tool to use) ──
  let decision: LLMToolDecision | null = null;

  // Try OpenAI first (fastest, most reliable JSON mode)
  if (openaiApiKey && !decision) {
    decision = await callOpenAI(openaiApiKey, messages);
  }

  // Fallback to NVIDIA
  if (nvidiaApiKey && !decision) {
    decision = await callNVIDIA(nvidiaApiKey, messages);
  }

  // Fallback to deterministic pattern matching if ALL LLMs fail
  if (!decision) {
    decision = fallbackDecision(transcript, hasActiveDocuments);
  }

  // ── STEP 2: MULTI-STEP PLAN CHECK ──
  // For complex requests, try to decompose into a multi-step plan
  if (decision.toolCall && openaiApiKey) {
    const toolContext: ToolContext = {
      userContacts,
      hasActiveDocuments,
      userName: userName || 'friend',
      transcript,
      openaiApiKey,
      nvidiaApiKey,
    };

    // Check if the request is complex enough for multi-step planning
    const isComplexRequest = detectComplexRequest(transcript);
    if (isComplexRequest) {
      try {
        const plan = await buildPlan(transcript, openaiApiKey, toolContext);
        if (plan && plan.steps.length >= 2) {
          // Execute the multi-step plan
          const { plan: executedPlan, finalResponse, allResults } = await executePlan(
            plan,
            toolContext,
          );

          // Find the last successful tool result for client actions
          const lastResult = allResults.filter(r => r.success).pop();

          return {
            spokenResponse: finalResponse,
            thinking: `Multi-step plan: ${executedPlan.goal} (${executedPlan.steps.length} steps)`,
            toolUsed: 'multi_step_plan',
            toolResult: lastResult,
            clientAction: lastResult?.clientAction,
            actionType: lastResult ? mapToolToActionType(executedPlan.steps[executedPlan.steps.length - 1].toolName, lastResult) : 'KNOWLEDGE_ANSWER',
            planSteps: executedPlan.steps.map(s => ({
              description: s.description,
              status: s.status,
              toolName: s.toolName,
            })),
            ...(lastResult ? flattenToolResult(
              executedPlan.steps.filter(s => s.status === 'done').pop()?.toolName || '',
              lastResult,
              decision,
            ) : {}),
          };
        }
      } catch (planErr) {
        console.error('Multi-step plan error, falling back to single tool:', planErr);
      }
    }
  }

  // ── STEP 3: SINGLE TOOL EXECUTION ──
  if (decision.toolCall) {
    const toolContext: ToolContext = {
      userContacts,
      hasActiveDocuments,
      userName: userName || 'friend',
      transcript,
      openaiApiKey,
      nvidiaApiKey,
    };

    const toolResult = await toolRegistry.execute(
      decision.toolCall.name,
      decision.toolCall.params,
      toolContext,
    );

    // ── STEP 4: SYNTHESIZE RESPONSE ──
    // For web_search, synthesize a spoken answer from search results
    let finalSpoken = decision.spokenResponse;

    if (decision.toolCall.name === 'web_search' && toolResult.success && toolResult.data?.summary) {
      const synthesized = await synthesizeWebAnswer(
        openaiApiKey,
        userName,
        transcript,
        toolResult.data,
      );
      if (synthesized) {
        finalSpoken = synthesized;
      } else {
        finalSpoken = toolResult.data.summary.slice(0, 300);
      }
    }

    // Map tool results to the legacy actionType format for backwards compatibility
    const actionType = mapToolToActionType(decision.toolCall.name, toolResult);

    return {
      spokenResponse: finalSpoken,
      thinking: decision.thinking,
      toolUsed: decision.toolCall.name,
      toolResult,
      clientAction: toolResult.clientAction,
      actionType,
      // Spread tool-specific data for backwards compatibility
      ...flattenToolResult(decision.toolCall.name, toolResult, decision),
    };
  }

  // ── NO TOOL NEEDED — Direct knowledge/chat response ──
  return {
    spokenResponse: decision.spokenResponse,
    thinking: decision.thinking,
    actionType: 'KNOWLEDGE_ANSWER',
  };
}

// ─────────────────────────────────────────────────────────
// LLM PROVIDERS
// ─────────────────────────────────────────────────────────

async function callOpenAI(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
): Promise<LLMToolDecision | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s timeout

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 400,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        return parseDecision(content);
      }
    }
  } catch (err) {
    console.error('Brain OpenAI error:', err);
  }
  return null;
}

async function callNVIDIA(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
): Promise<LLMToolDecision | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta/llama-3.1-8b-instruct',
        messages,
        temperature: 0.1,
        max_tokens: 400,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return parseDecision(jsonMatch[0]);
      }
    }
  } catch (err) {
    console.error('Brain NVIDIA error:', err);
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// WEB ANSWER SYNTHESIS
// ─────────────────────────────────────────────────────────

async function synthesizeWebAnswer(
  apiKey: string | undefined,
  userName: string,
  query: string,
  searchData: any,
): Promise<string | null> {
  if (!apiKey) return null;

  const prompt = buildSynthesisPrompt({
    userName,
    originalQuery: query,
    toolName: 'web_search',
    toolData: searchData,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: prompt }],
        max_tokens: 200,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || null;
    }
  } catch (err) {
    console.error('Web synthesis error:', err);
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

function parseDecision(raw: string): LLMToolDecision | null {
  try {
    const parsed = JSON.parse(raw);
    return {
      thinking: parsed.thinking || '',
      toolCall: parsed.toolCall || null,
      spokenResponse: parsed.spokenResponse || "I'm here to help.",
    };
  } catch {
    console.error('Failed to parse Brain LLM decision:', raw?.slice(0, 200));
    return null;
  }
}

/**
 * Map tool names to legacy actionType strings for backwards compatibility
 * with the existing voice-assistant-modal.tsx rendering logic.
 */
function mapToolToActionType(toolName: string, result: ToolResult): string {
  if (toolName === 'transaction_action') {
    return 'SHOPPING';
  }

  if (!result.clientAction) {
    return 'KNOWLEDGE_ANSWER';
  }

  switch (result.clientAction.type) {
    case 'OPEN_URL':
      return 'OPEN_WEBSITE';
    case 'PHONE_CALL':
      return 'PHONE_CALL';
    case 'APP_ACTION':
      return 'APP_ACTION';
    case 'DOCUMENT_QA':
      return 'DOCUMENT_QA';
    case 'DISAMBIGUATE_CONTACT':
      return 'DISAMBIGUATE_CONTACT';
    case 'CONTACT_NOT_FOUND':
      return 'CONTACT_NOT_FOUND';
    case 'SHOW_REMINDER':
      return 'KNOWLEDGE_ANSWER'; // Render reminder confirmation as spoken text
    default:
      return 'KNOWLEDGE_ANSWER';
  }
}

/**
 * Flatten tool results into top-level keys for backwards compatibility.
 * The existing modal checks for specific keys like `targetUrl`, `appAction`, etc.
 */
function flattenToolResult(
  toolName: string,
  result: ToolResult,
  decision: LLMToolDecision,
): Record<string, any> {
  const flat: Record<string, any> = {};
  const payload = result.clientAction?.payload || {};

  if (toolName === 'transaction_action' || result.data?.transaction) {
    flat.transaction = result.data?.transaction;
    flat.transactionPayload = payload;
  }

  switch (result.clientAction?.type) {
    case 'OPEN_URL':
      flat.targetUrl = payload.url;
      flat.searchQuery = payload.searchQuery;
      if (result.data?.resolvedContact) {
        flat.resolvedContact = result.data.resolvedContact;
        flat.confidence = result.data.confidence;
      }
      break;
    case 'PHONE_CALL':
      flat.phoneNumber = payload.phoneNumber;
      if (result.data?.resolvedContact) {
        flat.resolvedContact = result.data.resolvedContact;
        flat.confidence = result.data.confidence;
      }
      break;
    case 'APP_ACTION':
      flat.appAction = payload.appAction;
      break;
    case 'DOCUMENT_QA':
      flat.query = payload.query || decision.toolCall?.params?.query;
      break;
    case 'DISAMBIGUATE_CONTACT':
      flat.searchedName = payload.searchedName;
      flat.candidates = payload.candidates;
      flat.clarifyingQuestion = payload.clarifyingQuestion;
      flat.pendingChannel = payload.pendingChannel;
      flat.pendingMessage = payload.pendingMessage;
      break;
    case 'CONTACT_NOT_FOUND':
      flat.searchedName = payload.searchedName;
      flat.channel = payload.channel;
      flat.appToOpen = payload.appToOpen;
      break;
  }

  // Pass web search live data flag
  if (toolName === 'web_search' && result.success) {
    flat.liveDataUsed = true;
  }

  return flat;
}

/**
 * Extract recent conversation topics for context injection.
 */
function extractRecentTopics(history: Array<{ role: string; content: string }>): string[] {
  if (!history || history.length === 0) return [];

  return history
    .filter((h) => h.role === 'user')
    .slice(-3)
    .map((h) => {
      const content = typeof h.content === 'string' ? h.content : '';
      return content.slice(0, 80);
    })
    .filter(Boolean);
}

/**
 * Deterministic fallback if ALL LLM providers fail.
 * Maps keywords to tool calls so the assistant never goes completely silent.
 */
function fallbackDecision(transcript: string, hasDocs: boolean): LLMToolDecision {
  const q = transcript.toLowerCase().replace(/[.,!?;:]/g, '').trim();

  // Contact actions
  if (q.includes('whatsapp') || q.includes('call ') || q.includes('message ') || q.includes('email ') || q.includes('text ')) {
    const name = q
      .replace(/^(open|send|call|message|text|email)\s+/i, '')
      .replace(/(whatsapp|chat|message|call)\s+/i, '')
      .replace(/\s+(on|via|using)\s+(whatsapp|gmail|email)$/i, '')
      .replace(/\s+saying.*$/i, '')
      .trim();

    const channel = q.includes('whatsapp') ? 'whatsapp' : q.includes('email') ? 'email' : 'call';
    const msgMatch = q.match(/saying\s+(.+)$/i) || q.match(/message\s+(.+)$/i);
    const messageText = msgMatch ? msgMatch[1].trim() : '';

    return {
      thinking: 'User wants to contact someone — using contact_action tool',
      toolCall: { name: 'contact_action', params: { contactName: name, channel, messageText } },
      spokenResponse: `Looking up ${name} in your contacts.`,
    };
  }

  // Web search triggers
  const isLive = q.includes('weather') || q.includes('news') || q.includes('stock') || q.includes('score') || q.includes('price') || q.includes('today') || q.includes('latest');
  if (isLive) {
    return {
      thinking: 'User asks for live/real-time data — using web_search',
      toolCall: { name: 'web_search', params: { query: transcript } },
      spokenResponse: 'Searching the web for the latest information.',
    };
  }

  // App actions
  if (q.includes('upload') || q.includes('add file')) {
    return {
      thinking: 'User wants to upload a document',
      toolCall: { name: 'app_action', params: { action: 'upload_document' } },
      spokenResponse: 'Opening the document upload picker.',
    };
  }

  // Website opening
  if (q.startsWith('open ') || q.startsWith('go to ')) {
    const target = q.replace(/^open\s+/, '').replace(/^go to\s+/, '').trim();
    return {
      thinking: `User wants to open ${target}`,
      toolCall: { name: 'open_website', params: { url: target } },
      spokenResponse: `Opening ${target} for you.`,
    };
  }

  // Document QA
  if (hasDocs && (q.includes('document') || q.includes('pdf') || q.includes('resume') || q.includes('summarize'))) {
    return {
      thinking: 'User is asking about their uploaded document',
      toolCall: { name: 'document_qa', params: { query: transcript } },
      spokenResponse: 'Analyzing your uploaded document.',
    };
  }

  // Default: direct knowledge answer
  return {
    thinking: 'General knowledge question — answering directly',
    toolCall: null,
    spokenResponse: `I'll answer your question about "${transcript}" right here. Let me think...`,
  };
}

/**
 * Detect if a request likely requires multi-step planning.
 * Looks for conjunctions, sequencing words, and multiple action verbs.
 */
function detectComplexRequest(transcript: string): boolean {
  const q = transcript.toLowerCase();

  // Sequencing conjunctions that indicate multi-step intent
  const sequencePatterns = [
    /\band\s+then\b/,
    /\bthen\s+(open|send|search|email|call|message|save|remind)/,
    /\bafter\s+that\b/,
    /\bfirst\b.*\bthen\b/,
    /\bsearch\b.*\b(and|then)\b.*\b(send|email|message|call)\b/,
    /\bfind\b.*\b(and|then)\b.*\b(send|email|open|save)\b/,
    /\blook\s+up\b.*\b(and|then)\b/,
  ];

  for (const pattern of sequencePatterns) {
    if (pattern.test(q)) return true;
  }

  // Count distinct action verbs — if 2+, likely multi-step
  const actionVerbs = ['search', 'find', 'look up', 'open', 'send', 'email', 'call', 'message', 'save', 'remember', 'remind', 'summarize', 'play'];
  const verbCount = actionVerbs.filter((v) => q.includes(v)).length;
  if (verbCount >= 2) return true;

  return false;
}
