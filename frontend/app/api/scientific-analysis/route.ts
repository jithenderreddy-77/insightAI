/**
 * /api/scientific-analysis — Dedicated scientific research analysis endpoint.
 *
 * Flow:
 *  1. Receives question + sheet data + scientific profile + validation report
 *  2. Builds domain-specific scientific system prompt (XRD, XPS, VSM, etc.)
 *  3. LLM generates JavaScript code using the SCI namespace
 *  4. Code is executed in the enhanced sandbox (with SCI functions)
 *  5. Returns structured scientific result with measured/computed/interpretation sections
 *  6. Self-correction retry on execution failure
 *
 * Differences from /api/spreadsheet-query:
 *  - Domain-specific prompts (XRD prompt ≠ VSM prompt)
 *  - SCI namespace documentation in the prompt
 *  - Structured scientific output format (measuredResults, computedResults, etc.)
 *  - Data quality warnings included in context
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { executeSandboxed } from '@/lib/sandbox';
import { buildScientificPrompt } from '@/lib/scientific-prompt-builder';
import type { SheetData } from '@/lib/spreadsheet-parser';
import type { ScientificDatasetProfile } from '@/lib/scientific-dataset-detector';
import type { ValidationReport } from '@/lib/scientific-validator';

// Rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 15; // queries per minute
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
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'anonymous';
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before trying again.' },
        { status: 429 },
      );
    }

    const body = await req.json();
    const {
      question,
      sheetData,
      allSheets,
      scientificProfile,
      validationReport,
    } = body as {
      question: string;
      sheetData: SheetData;
      allSheets?: SheetData[];
      scientificProfile?: ScientificDatasetProfile;
      validationReport?: ValidationReport | null;
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

    // Use the profile from the request or build a default one
    const profile: ScientificDatasetProfile = scientificProfile || {
      experimentType: 'General',
      instrumentDescription: 'General laboratory data',
      detectedColumns: [],
      sampleIds: [],
      hasRepeatedMeasurements: false,
      confidence: 0.2,
      supportedAnalyses: ['Descriptive statistics', 'Data visualization'],
    };

    // Build the scientific system prompt (with multi-sheet context if available)
    const systemPrompt = buildScientificPrompt(
      sheetData,
      profile,
      validationReport || null,
      allSheets,
    );

    // --- ATTEMPT 1: Generate code ---
    let llmResponse = await callLLM(systemPrompt, question.trim(), nvidiaApiKey, openaiApiKey);

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

    // Extract code
    let code = extractCode(llmResponse);
    let explanation = extractExplanation(llmResponse);

    if (!code) {
      // LLM gave a text-only response
      return NextResponse.json({
        type: 'scientific_answer',
        result: {
          interpretation: llmResponse,
          measuredResults: null,
          computedResults: null,
          equations: [],
          assumptions: [],
          limitations: ['Analysis was provided as text interpretation without computational verification.'],
          chartSpec: null,
          tableData: null,
        },
        experimentType: profile.experimentType,
        explanation: llmResponse,
        code: null,
      });
    }

    // Prepare sandbox extra globals (such as allSheets array)
    const extraGlobals: Record<string, unknown> = {};
    if (allSheets && Array.isArray(allSheets) && allSheets.length > 0) {
      extraGlobals.allSheets = allSheets.map(s => ({
        name: s.name,
        headers: s.headers,
        rowCount: s.rowCount,
        rows: s.rows,
        scientificProfile: s.scientificProfile,
      }));
    }

    // --- EXECUTE in sandbox ---
    let sandboxResult = executeSandboxed(code, sheetData.rows, undefined, extraGlobals);

    // --- SELF-CORRECTION: retry on failure ---
    if (!sandboxResult.success && sandboxResult.error) {
      const retryPrompt = buildRetryPrompt(systemPrompt, question, code, sandboxResult.error);
      const retryResponse = await callLLM(retryPrompt, question, nvidiaApiKey, openaiApiKey);

      if (retryResponse) {
        const retryCode = extractCode(retryResponse);
        if (retryCode) {
          code = retryCode;
          explanation = extractExplanation(retryResponse) || explanation;
          sandboxResult = executeSandboxed(retryCode, sheetData.rows, undefined, extraGlobals);
        }
      }
    }

    // --- Build response ---
    if (!sandboxResult.success) {
      return NextResponse.json({
        type: 'error',
        message: `Scientific analysis failed. ${sandboxResult.error || 'The generated analysis code had an error.'}`,
        code: sandboxResult.code,
        executionTimeMs: sandboxResult.executionTimeMs,
        experimentType: profile.experimentType,
      });
    }

    // Parse the structured result from the sandbox
    const rawResult = sandboxResult.result as any;

    // Handle both structured and simple results
    let scientificResult: any;
    if (rawResult && typeof rawResult === 'object' && (rawResult.measuredResults || rawResult.computedResults || rawResult.interpretation)) {
      scientificResult = rawResult;
    } else {
      // Wrap non-structured result
      scientificResult = {
        measuredResults: null,
        computedResults: typeof rawResult === 'object' ? rawResult : { value: rawResult },
        equations: [],
        assumptions: [],
        interpretation: explanation || 'Analysis completed.',
        limitations: [],
        chartSpec: null,
        tableData: null,
      };
    }

    return NextResponse.json({
      type: 'scientific_answer',
      result: scientificResult,
      experimentType: profile.experimentType,
      instrumentDescription: profile.instrumentDescription,
      dataQualityScore: validationReport?.qualityScore ?? null,
      explanation: explanation || scientificResult.interpretation || 'Scientific analysis computed successfully.',
      code: sandboxResult.code,
      executionTimeMs: sandboxResult.executionTimeMs,
    });
  } catch (error: any) {
    console.error('[scientific-analysis] Unhandled error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred during scientific analysis.' },
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
  // For scientific analysis, prefer more capable models
  const candidates = [
    ...(openaiApiKey
      ? [
          {
            url: 'https://api.openai.com/v1/chat/completions',
            key: openaiApiKey,
            model: 'gpt-4o-mini',
          },
        ]
      : []),
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
  ];

  for (const candidate of candidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout for complex analysis

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
          max_tokens: 4096,
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
// Prompt Helpers
// ---------------------------------------------------------------------------

function buildRetryPrompt(
  originalSystemPrompt: string,
  question: string,
  failedCode: string,
  error: string,
): string {
  return `${originalSystemPrompt}

--- RETRY CONTEXT ---
Your previous code attempt FAILED with the following error. Fix it.

ORIGINAL QUESTION: ${question}

FAILED CODE:
\`\`\`javascript
${failedCode}
\`\`\`

ERROR: ${error}

Fix the code. Remember to use the SCI namespace for all scientific calculations.
Assign the result to the \`result\` variable with the structured format.

\`\`\`javascript
// Your corrected code here
result = { ... };
\`\`\`

EXPLANATION: [Brief explanation of the fix]`;
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function extractCode(response: string): string | null {
  const codeMatch = response.match(/```(?:javascript|js)\s*\n([\s\S]*?)```/i);
  if (codeMatch && codeMatch[1]) {
    return codeMatch[1].trim();
  }

  // Fallback: look for lines that look like code
  const lines = response.split('\n');
  const codeLines: string[] = [];
  let inCode = false;

  for (const line of lines) {
    if (line.trim().startsWith('result') || line.trim().startsWith('const ') ||
        line.trim().startsWith('let ') || line.trim().startsWith('var ') ||
        line.trim().startsWith('//') || line.trim().startsWith('for ') ||
        line.trim().startsWith('if ') || line.trim().startsWith('function ') ||
        line.trim().startsWith('SCI.')) {
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
