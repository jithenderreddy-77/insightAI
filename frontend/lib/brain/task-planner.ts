// frontend/lib/brain/task-planner.ts
// Multi-Step Task Planning Engine
// Decomposes complex voice commands into ordered sub-tasks,
// chains tool outputs, and reports progress.
//
// Example: "Search AI news and email summary to Thanoj"
//   Step 1: web_search("latest AI news") → [results]
//   Step 2: (synthesize summary from step 1 results)
//   Step 3: contact_action(name="Thanoj", channel="email", message="{summary}")

import { toolRegistry, type ToolContext, type ToolResult } from './tool-registry';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface TaskStep {
  id: number;
  description: string;
  toolName: string;
  toolParams: Record<string, any>;
  /** IDs of prerequisite steps whose output feeds into this step */
  dependsOn: number[];
  status: StepStatus;
  result?: ToolResult;
  /** Human-readable summary of the result */
  resultSummary?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  completedAt?: string;
  /** Spoken progress updates emitted during execution */
  progressUpdates: string[];
}

export interface PlanExecutionResult {
  plan: TaskPlan;
  finalResponse: string;
  allResults: ToolResult[];
}

// ─────────────────────────────────────────────────────────
// PLAN BUILDER
// ─────────────────────────────────────────────────────────

/**
 * Ask the LLM to decompose a complex request into a multi-step plan.
 * Returns null if the request is single-step (no planning needed).
 */
export async function buildPlan(
  transcript: string,
  apiKey: string,
  context: ToolContext,
): Promise<TaskPlan | null> {
  const toolNames = toolRegistry.getNames();
  const toolDescriptions = toolRegistry.generateToolDescriptions();

  const plannerPrompt = `You are a task planner for an AI voice assistant.

AVAILABLE TOOLS:
${toolDescriptions}

TASK: Analyze the user's request and determine if it requires MULTIPLE sequential steps.

If the request is SIMPLE (single tool or direct answer), respond:
{"needsPlan": false}

If the request is COMPLEX (requires 2+ tools in sequence), respond with a plan:
{
  "needsPlan": true,
  "goal": "brief description of the overall goal",
  "steps": [
    {
      "id": 1,
      "description": "What this step does",
      "toolName": "${toolNames[0] || 'web_search'}",
      "toolParams": { ... },
      "dependsOn": []
    },
    {
      "id": 2,
      "description": "What this step does",
      "toolName": "tool_name",
      "toolParams": { ... },
      "dependsOn": [1]
    }
  ]
}

RULES:
- Maximum 5 steps per plan
- Each step must use exactly one tool from the available tools list
- Use dependsOn to chain outputs (e.g. step 2 uses step 1's result)
- For steps that depend on previous results, use "{step_N_result}" as a placeholder in toolParams
- Output ONLY valid JSON

USER REQUEST: "${transcript}"`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: plannerPrompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);

    if (!parsed.needsPlan || !parsed.steps || parsed.steps.length < 2) {
      return null; // Single-step — no plan needed
    }

    const plan: TaskPlan = {
      id: `plan_${Date.now()}`,
      goal: parsed.goal || transcript,
      steps: parsed.steps.map((s: any) => ({
        id: s.id,
        description: s.description || `Step ${s.id}`,
        toolName: s.toolName,
        toolParams: s.toolParams || {},
        dependsOn: s.dependsOn || [],
        status: 'pending' as StepStatus,
      })),
      status: 'planning',
      createdAt: new Date().toISOString(),
      progressUpdates: [],
    };

    return plan;
  } catch (err) {
    console.error('Task planner error:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// PLAN EXECUTOR
// ─────────────────────────────────────────────────────────

/**
 * Execute a multi-step plan, chaining tool outputs.
 * Calls onProgress for each step completion.
 */
export async function executePlan(
  plan: TaskPlan,
  context: ToolContext,
  onProgress?: (step: TaskStep, plan: TaskPlan) => void,
): Promise<PlanExecutionResult> {
  plan.status = 'executing';
  const allResults: ToolResult[] = [];
  const stepResults: Map<number, any> = new Map();

  for (const step of plan.steps) {
    // Check if dependencies are met
    const depsOk = step.dependsOn.every((depId) => {
      const depStep = plan.steps.find((s) => s.id === depId);
      return depStep?.status === 'done';
    });

    if (!depsOk) {
      step.status = 'skipped';
      step.resultSummary = 'Skipped — dependency failed';
      continue;
    }

    step.status = 'running';
    step.startedAt = new Date().toISOString();
    plan.progressUpdates.push(`🔄 Step ${step.id}: ${step.description}`);
    onProgress?.(step, plan);

    // Resolve parameter placeholders from previous step results
    const resolvedParams = resolveParamPlaceholders(step.toolParams, stepResults);

    try {
      const result = await toolRegistry.execute(step.toolName, resolvedParams, context);
      step.result = result;
      step.status = result.success ? 'done' : 'failed';
      step.completedAt = new Date().toISOString();

      // Store result data for dependent steps
      if (result.success && result.data) {
        stepResults.set(step.id, result.data);
        // Build a summary string that downstream steps can use
        step.resultSummary = summarizeStepResult(step.toolName, result.data);
      } else {
        step.resultSummary = result.error || 'Step failed';
      }

      allResults.push(result);
      plan.progressUpdates.push(
        result.success
          ? `✅ Step ${step.id}: ${step.description} — done`
          : `❌ Step ${step.id}: ${step.description} — ${result.error || 'failed'}`,
      );
      onProgress?.(step, plan);
    } catch (err: any) {
      step.status = 'failed';
      step.completedAt = new Date().toISOString();
      step.resultSummary = err.message || 'Execution error';
      plan.progressUpdates.push(`❌ Step ${step.id}: ${step.description} — error`);
      onProgress?.(step, plan);
    }
  }

  // Determine overall plan status
  const allDone = plan.steps.every((s) => s.status === 'done' || s.status === 'skipped');
  const anyFailed = plan.steps.some((s) => s.status === 'failed');
  plan.status = anyFailed ? 'failed' : allDone ? 'completed' : 'failed';
  plan.completedAt = new Date().toISOString();

  // Build a final spoken response summarizing the plan execution
  const finalResponse = buildPlanSummary(plan);

  return { plan, finalResponse, allResults };
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

/**
 * Replace "{step_N_result}" placeholders in tool parameters with actual step results.
 */
function resolveParamPlaceholders(
  params: Record<string, any>,
  stepResults: Map<number, any>,
): Record<string, any> {
  const resolved: Record<string, any> = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      let resolvedValue = value;

      // Replace {step_N_result} placeholders
      const placeholderRegex = /\{step_(\d+)_result\}/g;
      resolvedValue = resolvedValue.replace(placeholderRegex, (_match, stepId) => {
        const result = stepResults.get(parseInt(stepId));
        if (!result) return '[no data]';

        // Return the most useful string from the result
        if (typeof result === 'string') return result;
        if (result.summary) return result.summary;
        if (result.message) return result.message;
        if (result.content) return result.content;
        return JSON.stringify(result).slice(0, 500);
      });

      resolved[key] = resolvedValue;
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Build a human-readable summary of a step's result for chaining.
 */
function summarizeStepResult(toolName: string, data: any): string {
  if (!data) return '';

  switch (toolName) {
    case 'web_search':
      return data.summary?.slice(0, 500) || 'Search completed';
    case 'contact_action':
      return data.resolvedContact
        ? `Contact ${data.resolvedContact.name} found`
        : 'Contact action completed';
    case 'open_website':
      return `Opened ${data.url || 'website'}`;
    case 'memory':
      return data.message || data.results?.map((r: any) => r.content).join('. ') || 'Memory action done';
    default:
      return typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300);
  }
}

/**
 * Build a final spoken summary of the entire plan execution.
 */
function buildPlanSummary(plan: TaskPlan): string {
  const completed = plan.steps.filter((s) => s.status === 'done').length;
  const total = plan.steps.length;
  const failed = plan.steps.filter((s) => s.status === 'failed');

  if (plan.status === 'completed') {
    const summaries = plan.steps
      .filter((s) => s.status === 'done' && s.resultSummary)
      .map((s) => s.resultSummary)
      .filter(Boolean);

    if (summaries.length > 0) {
      return `Done! I completed all ${total} steps for "${plan.goal}". ${summaries[summaries.length - 1]}`;
    }
    return `I've completed all ${total} steps for "${plan.goal}" successfully.`;
  }

  if (failed.length > 0) {
    return `I completed ${completed} of ${total} steps for "${plan.goal}", but step "${failed[0].description}" failed: ${failed[0].resultSummary || 'unknown error'}.`;
  }

  return `Task "${plan.goal}" finished with ${completed}/${total} steps completed.`;
}
