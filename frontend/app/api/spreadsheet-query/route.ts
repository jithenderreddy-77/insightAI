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

    // Extract code, explanation, and chart specs from the LLM response
    let code = extractCode(llmResponse);
    let explanation = extractExplanation(llmResponse);
    let rawChartSpecs = extractChartSpecs(llmResponse);

    if (!code) {
      return NextResponse.json({
        type: 'answer',
        result: llmResponse,
        explanation: 'The AI provided a direct text answer instead of code.',
        code: null,
        chartData: null,
      });
    }

    // --- EXECUTE main query in sandbox ---
    let sandboxResult = executeSandboxed(code, sheetData.rows);

    // --- SELF-CORRECTION: If main query execution failed, retry once ---
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
          rawChartSpecs = extractChartSpecs(retryResponse).length > 0 ? extractChartSpecs(retryResponse) : rawChartSpecs;
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

    // Process all chart specs independently (sandbox execution per chart)
    const processedCharts = await processChartSpecs(
      rawChartSpecs,
      sheetData.rows,
      sheetData.headers,
      nvidiaApiKey,
      openaiApiKey,
    );

    return NextResponse.json({
      type: 'answer',
      result: sandboxResult.result,
      explanation: explanation || 'Analysis computed successfully.',
      code: sandboxResult.code,
      executionTimeMs: sandboxResult.executionTimeMs,
      chartData: processedCharts.length > 0 ? processedCharts : null,
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
// LLM Communication & Multi-Chart Processing
// ---------------------------------------------------------------------------

async function processChartSpecs(
  rawSpecs: any[],
  rows: Record<string, unknown>[],
  headers: string[],
  nvidiaApiKey?: string,
  openaiApiKey?: string,
): Promise<any[]> {
  const specs = (Array.isArray(rawSpecs) ? rawSpecs : rawSpecs ? [rawSpecs] : []).slice(0, 4);
  const processedCharts: any[] = [];

  for (let idx = 0; idx < specs.length; idx++) {
    const spec = specs[idx];
    if (!spec || typeof spec !== 'object') continue;

    const chartId = spec.id || `chart_${idx + 1}`;
    const chartType = spec.type || 'bar';
    const title = spec.title || `Chart ${idx + 1}`;
    const xAxisLabel = spec.xAxisLabel || '';
    const yAxisLabel = spec.yAxisLabel || '';
    const reasoning = spec.reasoning || '';
    let chartCode = spec.code || '';
    let labels: string[] = Array.isArray(spec.labels) ? spec.labels : [];
    let datasets: any[] = Array.isArray(spec.datasets) ? spec.datasets : [];
    let failed = false;
    let errorMsg = '';
    let executionTimeMs = 0;

    // If code is provided and labels/datasets are empty, execute code in sandbox
    if (chartCode && (labels.length === 0 || datasets.length === 0)) {
      let res = executeSandboxed(chartCode, rows);
      executionTimeMs = res.executionTimeMs;

      // Self-correction retry once if chart execution failed
      if (!res.success && res.error) {
        const retryPrompt = `Fix the following JS chart computation code. SPREADSHEET HEADERS: ${JSON.stringify(headers)}.
FAILED CODE:
\`\`\`javascript
${chartCode}
\`\`\`
ERROR: ${res.error}
Assign the result object to \`chartResult\` with structure { labels: string[], datasets: [{ label: string, data: number[] }] }.
Return ONLY the code inside a \`\`\`javascript ... \`\`\` block.`;
        const retryCodeRaw = await callLLM(retryPrompt, 'Fix chart code', nvidiaApiKey, openaiApiKey);
        if (retryCodeRaw) {
          const fixedCode = extractCode(retryCodeRaw);
          if (fixedCode) {
            chartCode = fixedCode;
            res = executeSandboxed(fixedCode, rows);
            executionTimeMs = res.executionTimeMs;
          }
        }
      }

      if (!res.success) {
        failed = true;
        errorMsg = res.error || 'Chart execution failed.';
      } else {
        // Extract labels & datasets from res.result
        const resVal: any = res.result;
        if (resVal && typeof resVal === 'object') {
          if (Array.isArray(resVal.labels) && Array.isArray(resVal.datasets)) {
            labels = resVal.labels;
            datasets = resVal.datasets;
          } else if (Array.isArray(resVal)) {
            // Convert array of objects [{ Category: 'A', Value: 10 }] into chart labels and data
            const firstRow = resVal[0] || {};
            const keys = Object.keys(firstRow);
            if (keys.length >= 2) {
              const labelKey = keys[0];
              const valueKey = keys[1];
              labels = resVal.map((r: any) => String(r[labelKey] ?? ''));
              datasets = [
                {
                  label: valueKey,
                  data: resVal.map((r: any) => Number(r[valueKey]) || 0),
                },
              ];
            }
          }
        }
      }
    }

    // If no datasets created yet and not failed, create default if labels & data present
    if (!failed && datasets.length === 0 && labels.length > 0 && Array.isArray(spec.data)) {
      datasets = [
        {
          label: yAxisLabel || title || 'Value',
          data: spec.data.map((v: any) => Number(v) || 0),
        },
      ];
    }

    processedCharts.push({
      id: chartId,
      type: chartType,
      title,
      labels,
      datasets,
      code: chartCode,
      executionTimeMs,
      reasoning,
      failed,
      error: errorMsg,
      xAxisLabel,
      yAxisLabel,
    });
  }

  return processedCharts;
}

async function callLLM(
  systemPrompt: string,
  userMessage: string,
  nvidiaApiKey?: string,
  openaiApiKey?: string,
): Promise<string | null> {
  // Try high-speed candidates first for low latency
  const candidates = [
    ...(nvidiaApiKey
      ? [
          {
            url: 'https://integrate.api.nvidia.com/v1/chat/completions',
            key: nvidiaApiKey,
            model: 'meta/llama-3.1-8b-instruct',
          },
          {
            url: 'https://integrate.api.nvidia.com/v1/chat/completions',
            key: nvidiaApiKey,
            model: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b',
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
      const timeoutId = setTimeout(() => controller.abort(), 12000);

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

MULTI-CHART VISUALIZATION RULES:
- If the user's question implies MULTIPLE distinct visualizations (e.g. "sales by region AND revenue trend over time", or asks for multiple specific chart types like "pie chart of category breakdown and bar chart of price distribution", or is broad/open-ended like "show me interesting trends"), generate MULTIPLE chart specifications (up to 4 max).
- If only 1 visualization is needed, return an array containing 1 chart specification.
- Return all chart specifications in a \`\`\`chart_specs ... \`\`\` block as a JSON array of objects (max 4 objects).
- Each object in chart_specs MUST have:
  * "id": unique string (e.g. "chart_1", "chart_2")
  * "type": "bar" | "line" | "pie" | "doughnut" | "scatter" | "area"
  * "title": Specific descriptive title derived from column names (e.g., "Sales by Region", "Revenue Trend Over Time")
  * "code": JS code string operating on \`data\` that sets \`chartResult = { labels: [...], datasets: [{ label: "...", data: [...] }] }\`
  * "xAxisLabel": Column/metric name for X axis
  * "yAxisLabel": Column/metric name for Y axis
  * "reasoning": 1-sentence explanation of why this chart type was selected

EXAMPLE CHART_SPECS BLOCK:
\`\`\`chart_specs
[
  {
    "id": "chart_1",
    "type": "bar",
    "title": "Sales by Region",
    "code": "const m = {}; data.forEach(r => { const k = String(r['Region'] || 'Unknown'); m[k] = (m[k] || 0) + (Number(r['Sales']) || 0); }); chartResult = { labels: Object.keys(m), datasets: [{ label: 'Sales ($)', data: Object.values(m) }] };",
    "xAxisLabel": "Region",
    "yAxisLabel": "Sales ($)",
    "reasoning": "Bar chart comparing categorical region sales"
  },
  {
    "id": "chart_2",
    "type": "line",
    "title": "Revenue Trend Over Time",
    "code": "const m = {}; data.forEach(r => { const k = String(r['Date'] || 'Unknown'); m[k] = (m[k] || 0) + (Number(r['Revenue']) || 0); }); chartResult = { labels: Object.keys(m), datasets: [{ label: 'Revenue ($)', data: Object.values(m) }] };",
    "xAxisLabel": "Date",
    "yAxisLabel": "Revenue ($)",
    "reasoning": "Line chart showing revenue progression over time"
  }
]
\`\`\`

RESPONSE FORMAT:
\`\`\`javascript
// Your main analysis code here
result = ...;
\`\`\`

EXPLANATION: [Brief plain-English explanation of what the code does and the answer]

\`\`\`chart_specs
[
  ...
]
\`\`\``;
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

function extractChartSpecs(response: string): any[] {
  // 1. Look for ```chart_specs ... ``` block
  const specsMatch = response.match(/```chart_specs\s*\n([\s\S]*?)```/i);
  if (specsMatch && specsMatch[1]) {
    try {
      const parsed = JSON.parse(specsMatch[1].trim());
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch { /* ignore JSON parse error */ }
  }

  // 2. Look for legacy ```chart_spec ... ``` block
  const singleMatch = response.match(/```chart_spec\s*\n([\s\S]*?)```/i);
  if (singleMatch && singleMatch[1]) {
    try {
      const parsed = JSON.parse(singleMatch[1].trim());
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch { /* ignore JSON parse error */ }
  }

  return [];
}
