/**
 * /api/spreadsheet-query — Text-to-code query agent for spreadsheet analytics.
 *
 * Flow:
 *  1. Receives question + spreadsheet schema + full data rows
 *  2. Builds a system prompt with schema + 5 sample rows (never full data)
 *  3. LLM generates JavaScript code that operates on a `data` array
 *  4. Code is executed in the vm sandbox
 *  5. If execution fails, error is fed back to the LLM for one self-correction retry
 *  6. If query is ambiguous, LLM returns a clarifying question instead of guessing
 *  7. Returns: result, explanation, generated code, chart data (if applicable)
 *
 * Trust layer (Phase 3):
 *  - Every response includes the generated code and the data slice it operated on
 *  - Frontend renders a collapsible "Show reasoning" panel
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { executeSandboxed } from '@/lib/sandbox';
import { schemaToPrompt } from '@/lib/spreadsheet-parser';
import type { SheetData } from '@/lib/spreadsheet-parser';

// Rate limiting: simple in-memory counter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20; // queries per minute
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    // Rate limiting
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'anonymous';
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait a moment before trying again.' },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { question, sheetData, sheetIndex = 0 } = body as {
      question: string;
      sheetData: SheetData;
      sheetIndex?: number;
    };

    // Validate inputs
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return NextResponse.json({ error: 'A question is required.' }, { status: 400 });
    }

    if (!sheetData || !sheetData.headers || !sheetData.rows) {
      return NextResponse.json(
        { error: 'Spreadsheet data is required. Please upload a file first.' },
        { status: 400 },
      );
    }

    if (!Array.isArray(sheetData.rows) || sheetData.rows.length === 0) {
      return NextResponse.json(
        { error: 'The spreadsheet has no data rows to analyze.' },
        { status: 400 },
      );
    }

    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (!nvidiaApiKey && !openaiApiKey) {
      return NextResponse.json(
        { error: 'No LLM API key configured. Please set NVIDIA_API_KEY or OPENAI_API_KEY.' },
        { status: 500 },
      );
    }

    // Build schema prompt for the LLM (never send full data — just schema + 5 sample rows)
    const schemaPrompt = schemaToPrompt(sheetData);

    // --- ATTEMPT 1: Generate code ---
    const systemPrompt = buildSystemPrompt(schemaPrompt, sheetData.headers);
    const userPrompt = question.trim();

    let llmResponse = await callLLM(systemPrompt, userPrompt, nvidiaApiKey, openaiApiKey);

    if (!llmResponse) {
      return NextResponse.json(
        { error: 'Could not reach the AI model. Please try again.' },
        { status: 502 },
      );
    }

    // Check if the LLM wants to ask a clarifying question
    if (llmResponse.startsWith('CLARIFY:')) {
      return NextResponse.json({
        type: 'clarification',
        message: llmResponse.replace('CLARIFY:', '').trim(),
      });
    }

    // Extract code from the LLM response
    let code = extractCode(llmResponse);
    let explanation = extractExplanation(llmResponse);
    let chartSpec = extractChartSpec(llmResponse);

    if (!code) {
      return NextResponse.json({
        type: 'answer',
        result: llmResponse,
        explanation: 'The AI provided a direct text answer instead of code.',
        code: null,
        chartData: null,
      });
    }

    // --- EXECUTE in sandbox ---
    let sandboxResult = executeSandboxed(code, sheetData.rows);

    // --- SELF-CORRECTION: If execution failed, feed error back to LLM and retry once ---
    if (!sandboxResult.success && sandboxResult.error) {
      const retryPrompt = buildRetryPrompt(
        schemaPrompt,
        sheetData.headers,
        question,
        code,
        sandboxResult.error,
      );

      const retryResponse = await callLLM(retryPrompt, question, nvidiaApiKey, openaiApiKey);

      if (retryResponse) {
        const retryCode = extractCode(retryResponse);
        if (retryCode) {
          code = retryCode;
          explanation = extractExplanation(retryResponse) || explanation;
          chartSpec = extractChartSpec(retryResponse) || chartSpec;
          sandboxResult = executeSandboxed(retryCode, sheetData.rows);
        }
      }
    }

    // --- Build response ---
    if (!sandboxResult.success) {
      return NextResponse.json({
        type: 'error',
        message: `I couldn't compute an answer for that question. ${sandboxResult.error || 'The generated analysis code had an error.'}`,
        code: sandboxResult.code,
        executionTimeMs: sandboxResult.executionTimeMs,
      });
    }

    return NextResponse.json({
      type: 'answer',
      result: sandboxResult.result,
      explanation: explanation || 'Analysis computed successfully.',
      code: sandboxResult.code,
      executionTimeMs: sandboxResult.executionTimeMs,
      chartData: chartSpec,
    });
  } catch (error: any) {
    console.error('[spreadsheet-query] Unhandled error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred while processing your query.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// LLM Communication
// ---------------------------------------------------------------------------

async function callLLM(
  systemPrompt: string,
  userMessage: string,
  nvidiaApiKey?: string,
  openaiApiKey?: string,
): Promise<string | null> {
  // Try NVIDIA first, then OpenAI fallback
  const candidates = [
    ...(nvidiaApiKey
      ? [
          {
            url: 'https://integrate.api.nvidia.com/v1/chat/completions',
            key: nvidiaApiKey,
            model: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b',
          },
          {
            url: 'https://integrate.api.nvidia.com/v1/chat/completions',
            key: nvidiaApiKey,
            model: 'meta/llama-3.1-8b-instruct',
          },
        ]
      : []),
    ...(openaiApiKey
      ? [
          {
            url: 'https://api.openai.com/v1/chat/completions',
            key: openaiApiKey,
            model: 'gpt-4o-mini',
          },
        ]
      : []),
  ];

  for (const candidate of candidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(candidate.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${candidate.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: candidate.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.1,
          max_tokens: 2048,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) continue;

      const json = await res.json();
      const content = json.choices?.[0]?.message?.content;
      if (content && content.trim().length > 0) return content.trim();
    } catch {
      continue;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Prompt Engineering
// ---------------------------------------------------------------------------

function buildSystemPrompt(schemaPrompt: string, headers: string[]): string {
  return `You are a data analyst AI. The user has uploaded a spreadsheet and wants to analyze it.

SPREADSHEET SCHEMA:
${schemaPrompt}

YOUR TASK:
1. If the user's question is clear, generate JavaScript code to answer it.
2. If the question is genuinely ambiguous (e.g., could mean total vs. average, or multiple columns match a vague term), respond with EXACTLY: "CLARIFY: [your clarifying question]"
3. Never guess silently when multiple valid interpretations exist.

CODE RULES:
- Write valid JavaScript that operates on a \`data\` array (array of objects with keys: ${JSON.stringify(headers)}).
- Assign your final answer to the \`result\` variable.
- \`result\` can be: a number, string, array, or object.
- You have access to: Math, JSON, Date, String, Number, Array, Object, Map, Set, parseInt, parseFloat, isNaN, isFinite.
- You do NOT have: require, import, fetch, process, fs, eval, Function, setTimeout, setInterval.
- Handle edge cases: null values, empty strings, type coercion.
- Be concise — no unnecessary loops or variables.

CHART RULES:
- If the answer is best shown as a chart, also include a CHART_SPEC block.
- Auto-select the best chart type:
  * 1 categorical + 1 numeric → "bar"
  * Proportions/percentages → "pie"  
  * Time series / dates + numeric → "line"
  * 2 numeric columns → "scatter"
  * Simple number / text → no chart needed
- Format: \`\`\`chart_spec\\n{"type":"bar","labels":[...],"datasets":[{"label":"...","data":[...]}],"title":"..."}\\n\`\`\`

RESPONSE FORMAT:
\`\`\`javascript
// Your analysis code here
result = ...;
\`\`\`

EXPLANATION: [Brief plain-English explanation of what the code does and the answer]

[Optional chart_spec block if visual is needed]`;
}

function buildRetryPrompt(
  schemaPrompt: string,
  headers: string[],
  question: string,
  failedCode: string,
  error: string,
): string {
  return `You are a data analyst AI. Your previous code attempt failed. Fix the error.

SPREADSHEET SCHEMA:
${schemaPrompt}

ORIGINAL QUESTION: ${question}

FAILED CODE:
\`\`\`javascript
${failedCode}
\`\`\`

ERROR: ${error}

Fix the code. The \`data\` variable is an array of objects with keys: ${JSON.stringify(headers)}.
Assign the result to the \`result\` variable. Return ONLY the corrected code block.

\`\`\`javascript
// Your corrected code here
result = ...;
\`\`\`

EXPLANATION: [Brief explanation]`;
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function extractCode(response: string): string | null {
  // Match ```javascript ... ``` blocks
  const codeMatch = response.match(/```(?:javascript|js)\s*\n([\s\S]*?)```/i);
  if (codeMatch && codeMatch[1]) {
    return codeMatch[1].trim();
  }

  // Fallback: look for lines that look like code (has result = ...)
  const lines = response.split('\n');
  const codeLines: string[] = [];
  let inCode = false;

  for (const line of lines) {
    if (line.trim().startsWith('result') || line.trim().startsWith('const ') ||
        line.trim().startsWith('let ') || line.trim().startsWith('var ') ||
        line.trim().startsWith('//') || line.trim().startsWith('for ') ||
        line.trim().startsWith('if ') || line.trim().startsWith('function ')) {
      inCode = true;
    }
    if (inCode) {
      if (line.trim().startsWith('EXPLANATION:') || line.trim().startsWith('```')) {
        break;
      }
      codeLines.push(line);
    }
  }

  if (codeLines.length > 0 && codeLines.some((l) => l.includes('result'))) {
    return codeLines.join('\n').trim();
  }

  return null;
}

function extractExplanation(response: string): string | null {
  const match = response.match(/EXPLANATION:\s*([\s\S]*?)(?:```|$)/i);
  if (match && match[1]) {
    return match[1].trim().split('\n')[0].trim();
  }
  return null;
}

function extractChartSpec(response: string): any | null {
  const match = response.match(/```chart_spec\s*\n([\s\S]*?)```/i);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      return null;
    }
  }
  return null;
}
