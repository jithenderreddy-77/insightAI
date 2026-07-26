// app/api/chat/route.ts
// Direct chat — queries Supabase for relevant docs and streams AI response (Online Cloud or Offline Ollama Local Mode)

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

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // 1) Get query embedding (NVIDIA, OpenAI, or Local Ollama)
    const queryEmbedding = await getQueryEmbedding(message, useLocalOffline, nvidiaApiKey, openaiApiKey);

    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    let docs: any[] = [];

    // Prioritize querying documents belonging specifically to active uploaded files
    if (fileNames && Array.isArray(fileNames) && fileNames.length > 0) {
      const activeFileNames = fileNames.map((f: string) => f.trim().toLowerCase());
      
      // Fetch candidate document chunks from Supabase
      const { data: fileDocs, error: fileError } = await supabaseClient
        .from('documents')
        .select('id, content, metadata, embedding');

      if (!fileError && fileDocs && fileDocs.length > 0) {
        // Filter rows that belong to the uploaded file names
        const matchingFileDocs = fileDocs.filter((d: any) => {
          const fn = (d.metadata?.filename || d.metadata?.source || '').toLowerCase();
          return activeFileNames.some((af) => fn.includes(af) || af.includes(fn));
        });

        if (matchingFileDocs.length > 0) {
          // Calculate vector dot product similarity for active file chunks
          const scoredDocs = matchingFileDocs.map((d: any) => {
            let emb = d.embedding;
            if (typeof emb === 'string') {
              try { emb = JSON.parse(emb); } catch {}
            }
            let score = 0;
            if (Array.isArray(emb) && emb.length === queryEmbedding.length) {
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

    // Fallback to top RPC vector matches across table if no active file matches found
    if (docs.length === 0) {
      const { data: rawDocs, error: matchError } = await supabaseClient.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_count: 8,
      });
      if (matchError) {
        console.error('Supabase match error:', matchError);
      }
      docs = rawDocs || [];
    }

    // Build clean context block from retrieved document chunks
    const context = docs
      .map((doc: any, i: number) => {
        const sourceName = doc.metadata?.filename || doc.metadata?.source || 'Uploaded Document';
        return `[DOCUMENT SOURCE: ${sourceName} — Chunk ${i + 1}]\n${doc.content}`;
      })
      .filter(Boolean)
      .join('\n\n---\n\n');

    // 2) Build strict system prompt for 100% accurate document Q&A, Markdown Tables, and Mermaid Flowcharts
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
      : `You are a helpful AI document assistant. No document context was found for your query. Ask the user to upload a PDF, DOC, or TXT file so you can answer questions based on its content.`;

    // Determine model API endpoint and headers (Local Offline Ollama vs Cloud APIs)
    let apiUrl: string;
    let headers: Record<string, string>;
    let model: string;

    if (useLocalOffline || process.env.USE_OFFLINE_OLLAMA === 'true') {
      apiUrl = process.env.OLLAMA_HOST || 'http://localhost:11434/v1/chat/completions';
      model = process.env.OLLAMA_MODEL || 'deepseek-r1:7b';
      headers = { 'Content-Type': 'application/json' };
    } else if (nvidiaApiKey) {
      apiUrl = 'https://integrate.api.nvidia.com/v1/chat/completions';
      model = 'meta/llama-3.1-8b-instruct';
      headers = {
        'Authorization': `Bearer ${nvidiaApiKey}`,
        'Content-Type': 'application/json',
      };
    } else if (openaiApiKey) {
      apiUrl = 'https://api.openai.com/v1/chat/completions';
      model = 'gpt-4o-mini';
      headers = {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      };
    } else {
      return NextResponse.json(
        { error: 'No AI API key configured' },
        { status: 500 },
      );
    }

    // 3) Stream the AI completion with low latency
    const aiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers,
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

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI API error:', errText);
      return NextResponse.json({ error: 'AI API error', details: errText }, { status: 500 });
    }

    // Zero-loss stream forwarder using line buffer accumulator
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          const reader = aiResponse.body?.getReader();
          if (!reader) throw new Error('No response body reader');

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
                    data: [
                      {
                        type: 'ai',
                        content: fullContent,
                      },
                    ],
                  };
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`),
                  );
                }
              } catch {
                // Ignore incomplete JSON frames
              }
            }
          }

          // Flush any remaining buffer line
          if (buffer.trim().startsWith('data: ')) {
            const dataStr = buffer.trim().slice(6);
            if (dataStr !== '[DONE]') {
              try {
                const parsed = JSON.parse(dataStr);
                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                  fullContent += delta;
                  const ssePayload = {
                    event: 'messages/partial',
                    data: [{ type: 'ai', content: fullContent }],
                  };
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`),
                  );
                }
              } catch {}
            }
          }

          // Send document sources back to UI for transparency & citations
          if (docs && docs.length > 0) {
            const sourcesPayload = {
              event: 'updates',
              data: {
                retrieveDocuments: {
                  documents: docs.map((d: any) => ({
                    pageContent: d.content,
                    metadata: d.metadata || {},
                  })),
                },
              },
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(sourcesPayload)}\n\n`),
            );
          }
        } catch (error) {
          console.error('Streaming error:', error);
          const errPayload = {
            event: 'messages/partial',
            data: [{ type: 'ai', content: 'An error occurred while generating the response.' }],
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
    console.error('Chat route error:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

/**
 * Get query embedding using Local Ollama, NVIDIA API, or OpenAI API
 */
async function getQueryEmbedding(
  text: string,
  useLocalOffline?: boolean,
  nvidiaApiKey?: string,
  openaiApiKey?: string,
): Promise<number[]> {
  if (useLocalOffline) {
    try {
      const res = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'nomic-embed-text',
          prompt: text,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.embedding;
      }
    } catch {
      // Fallback if local Ollama embedding is offline
    }
  }

  if (nvidiaApiKey) {
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
    if (!res.ok) {
      throw new Error(`NVIDIA Embedding failed: ${await res.text()}`);
    }
    const data = await res.json();
    return data.data[0].embedding;
  }

  if (openaiApiKey) {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI Embedding failed: ${await res.text()}`);
    }
    const data = await res.json();
    return data.data[0].embedding;
  }

  throw new Error('No embedding API key available');
}
