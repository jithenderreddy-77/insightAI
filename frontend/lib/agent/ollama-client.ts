// frontend/lib/agent/ollama-client.ts
// ╔═══════════════════════════════════════════════════════════════╗
// ║  Ollama Local LLM Client (Phi-3-mini)                        ║
// ║  Thin wrapper for local inference — intent classification,    ║
// ║  form-field mapping, element resolution.                      ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Hard timeouts: 3s for classification, 5s for form-field mapping.
// Returns null on any failure — callers must handle gracefully.

const OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'phi3:mini';

export interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
}

/**
 * Send a prompt to Ollama and get a raw text response.
 */
export async function ollamaGenerate(
  prompt: string,
  options?: {
    model?: string;
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string | null> {
  const model = options?.model || DEFAULT_MODEL;
  const timeoutMs = options?.timeoutMs || 3000;
  const temperature = options?.temperature ?? 0.1;
  const maxTokens = options?.maxTokens || 100;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data: OllamaResponse = await response.json();
    return data.response || null;
  } catch {
    // Ollama unreachable, timeout, or other error
    return null;
  }
}

/**
 * Send a prompt and parse a JSON response from Ollama.
 * Extracts the first JSON object/array from the response text.
 * Returns null if parsing fails.
 */
export async function ollamaJSON<T>(
  prompt: string,
  options?: {
    model?: string;
    timeoutMs?: number;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<T | null> {
  const rawResponse = await ollamaGenerate(prompt, options);
  if (!rawResponse) return null;

  try {
    // Try to extract JSON from the response (LLM might wrap in markdown/text)
    const jsonMatch = rawResponse.match(/[\[{][\s\S]*[\]}]/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}

/**
 * Check if Ollama is running and the model is available.
 */
export async function isOllamaAvailable(model?: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return false;

    const data = await response.json();
    const targetModel = model || DEFAULT_MODEL;
    const models = data.models || [];
    return models.some((m: any) => m.name === targetModel || m.name.startsWith(targetModel.split(':')[0]));
  } catch {
    return false;
  }
}
