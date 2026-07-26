// app/api/chat/route.ts
// Direct chat — queries Supabase/Vector store and streams AI response (Cloud API with Automatic 100% Offline Ollama Failover)

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const { message, threadId, fileNames, useLocalOffline } = await req.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    // 1) Get query embedding with automatic offline fallback
    const queryEmbedding = await getQueryEmbedding(message, useLocalOffline, nvidiaApiKey, openaiApiKey);

    let docs: any[] = [];

    // Attempt Supabase document retrieval if configured
    if (supabaseUrl && supabaseKey) {
      try {
        const supabaseClient = createClient(supabaseUrl, supabaseKey);

        if (fileNames && Array.isArray(fileNames) && fileNames.length > 0) {
          const activeFileNames = fileNames.map((f: string) => f.trim().toLowerCase());

          const { data: fileDocs, error: fileError } = await supabaseClient
            .from('documents')
            .select('id, content, metadata, embedding');

          if (!fileError && fileDocs && fileDocs.length > 0) {
            const matchingFileDocs = fileDocs.filter((d: any) => {
              const fn = (d.metadata?.filename || d.metadata?.source || '').toLowerCase();
              return activeFileNames.some((af) => fn.includes(af) || af.includes(fn));
            });

            if (matchingFileDocs.length > 0) {
              const scoredDocs = matchingFileDocs.map((d: any) => {
                let emb = d.embedding;
                if (typeof emb === 'string') {
                  try { emb = JSON.parse(emb); } catch {}
                }
                let score = 0;
                if (Array.isArray(emb) && queryEmbedding && Array.isArray(queryEmbedding) && emb.length === queryEmbedding.length) {
                  for (let i = 0; i < queryEmbedding.length; i++) {
                    score += queryEmbedding[i] * emb[i];
                  }
                }
                return { ...d, score };
              });

              scoredDocs.sort((a, b) => b.score - a.score);
              docs = scoredDocs.slice(0, 8);
            }
          }
        }

        if (docs.length === 0 && queryEmbedding && queryEmbedding.length > 0) {
          const { data: rawDocs, error: matchError } = await supabaseClient.rpc('match_documents', {
            query_embedding: queryEmbedding,
            match_count: 8,
          });
          if (!matchError && rawDocs) {
            docs = rawDocs;
          }
        }
      } catch (err) {
        console.log('[OFFLINE NOTICE] Supabase cloud unreachable. Running in local mode.');
      }
    }

    // Build context block
    const context = docs
      .map((doc: any, i: number) => {
        const sourceName = doc.metadata?.filename || doc.metadata?.source || 'Uploaded Document';
        return `[DOCUMENT SOURCE: ${sourceName} — Chunk ${i + 1}]\n${doc.content}`;
      })
      .filter(Boolean)
      .join('\n\n---\n\n');

    const systemPrompt = context
      ? `You are an expert AI document assistant. Your primary task is to answer the user's question with absolute accuracy, using ONLY the facts explicitly provided in the DOCUMENT CONTEXT below.

STRICT INSTRUCTIONS:
1. Provide a direct, highly accurate answer based ONLY on the provided DOCUMENT CONTEXT.
2. RICH FORMATTING:
   - TABLES: Whenever presenting structured, tabular, or comparative data (numbers, specs, lists, features), ALWAYS present them using a clean Markdown Table (e.g., | Feature | Description |).
   - FLOWCHARTS & DIAGRAMS: Whenever describing a workflow, system architecture, step-by-step process, or pipeline, ALWAYS include a Mermaid flowchart diagram inside a \`\`\`mermaid code block (e.g. \`\`\`mermaid\ngraph TD\n  A[Input] --> B[Process]\n\`\`\`).
3. Do NOT invent, assume, or extrapolate facts outside the provided document text.
4. If the question cannot be answered using the provided DOCUMENT CONTEXT, respond: "Based on the uploaded document, this information is not mentioned in the text."

DOCUMENT CONTEXT:
${context}`
      : `You are a helpful AI assistant. Answer the user's question clearly, concisely, and accurately. If describing steps, processes, or comparisons, use Markdown Tables and Mermaid Flowcharts where appropriate.`;

    // 2) Get AI Completion Stream with Automatic Offline Failover (Cloud GPU -> Local Ollama)
    let aiResponseStream: ReadableStream | null = null;

    // Try Cloud API first if internet is available
    if (!useLocalOffline && (nvidiaApiKey || openaiApiKey)) {
      try {
        const apiUrl = nvidiaApiKey
          ? 'https://integrate.api.nvidia.com/v1/chat/completions'
          : 'https://api.openai.com/v1/chat/completions';
        const model = nvidiaApiKey ? 'meta/llama-3.1-8b-instruct' : 'gpt-4o-mini';
        const apiKey = nvidiaApiKey || openaiApiKey;

        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message },
            ],
            stream: true,
            temperature: 0.1,
            max_tokens: 1500,
          }),
        });

        if (res.ok && res.body) {
          aiResponseStream = res.body;
        }
      } catch (networkError) {
        console.log('[OFFLINE FAILOVER] Cloud API unreachable (No internet). Switching to Local Ollama AI Engine...');
      }
    }

    // Failover / Local Offline Mode: Connect to local Ollama engine
    if (!aiResponseStream) {
      try {
        const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434/v1/chat/completions';
        const ollamaModel = process.env.OLLAMA_MODEL || 'deepseek-r1:7b';

        const res = await fetch(ollamaHost, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: ollamaModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message },
            ],
            stream: true,
            temperature: 0.1,
          }),
        });

        if (res.ok && res.body) {
          aiResponseStream = res.body;
        }
      } catch (ollamaErr) {
        console.error('[OFFLINE ERROR] Local Ollama not reachable:', ollamaErr);
      }
    }

    const encoder = new TextEncoder();

    // Stream SSE Response cleanly to client
    const readable = new ReadableStream({
      async start(controller) {
        try {
          if (!aiResponseStream) {
            const offlineNotice = `📡 **Offline Mode Notice**: You are currently offline without internet.\n\nTo answer queries offline, please start your local Ollama AI model on your machine:\n\`\`\`bash\nollama run deepseek-r1:7b\n\`\`\`\nOnce Ollama is running, Insight AI will answer all your queries, tables, and flowcharts 100% offline!`;
            const ssePayload = {
              event: 'messages/partial',
              data: [{ type: 'ai', content: offlineNotice }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
            controller.close();
            return;
          }

          const reader = aiResponseStream.getReader();
          const decoder = new TextDecoder();
          let fullContent = '';
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data: ')) continue;
              const dataStr = trimmed.slice(6);
              if (dataStr === '[DONE]') continue;

              try {
                const parsed = JSON.parse(dataStr);
                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                  fullContent += delta;
                  const ssePayload = {
                    event: 'messages/partial',
                    data: [{ type: 'ai', content: fullContent }],
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
                }
              } catch {}
            }
          }
        } catch (err: any) {
          console.error('Stream processing error:', err);
          const errPayload = {
            event: 'messages/partial',
            data: [{ type: 'ai', content: 'An error occurred while streaming the response.' }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errPayload)}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('Chat route unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

/**
 * Get query embedding with automatic offline failover
 */
async function getQueryEmbedding(
  text: string,
  useLocalOffline?: boolean,
  nvidiaApiKey?: string,
  openaiApiKey?: string,
): Promise<number[]> {
  // 1. Try local Ollama embedding if requested
  if (useLocalOffline) {
    try {
      const res = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.embedding;
      }
    } catch {}
  }

  // 2. Try NVIDIA Cloud embedding if internet is active
  if (nvidiaApiKey) {
    try {
      const res = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${nvidiaApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'nvidia/nv-embedqa-e5-v5',
          input: [text],
          input_type: 'query',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.data[0].embedding;
      }
    } catch {
      console.log('[OFFLINE NOTICE] Cloud embedding unreachable. Falling back to local/empty vector.');
    }
  }

  // 3. Fallback to local Ollama embedding
  try {
    const res = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.embedding;
    }
  } catch {}

  return [];
}
