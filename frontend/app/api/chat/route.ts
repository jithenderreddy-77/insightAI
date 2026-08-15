export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { performWebSearch } from '@/lib/web-search';
import { generateVisualIllustration } from '@/lib/image-generation-service';
import { planTechnicalDiagram, validateAndRepairMermaid } from '@/lib/diagram-planner';

// LRU Embedding Cache for sub-millisecond repeated query responses
const embeddingCache = new Map<string, number[]>();
const MAX_EMBEDDING_CACHE = 200;

// Singleton Supabase Client to prevent expensive re-instantiation overhead
let supabaseSingleton: any = null;
function getSupabaseClient(url?: string, key?: string) {
  if (!url || !key) return null;
  if (!supabaseSingleton) {
    supabaseSingleton = createClient(url, key);
  }
  return supabaseSingleton;
}

export async function POST(req: Request) {
  try {
    const { message, threadId, fileNames, useLocalOffline, offlineDocuments, prefetchedDocs } = await req.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    // --- OUTPUT ROUTER INTENT CLASSIFICATION ---
    const queryLower = message.toLowerCase().trim();

    const isDiagramQuery =
      queryLower.includes('flowchart') ||
      queryLower.includes('diagram') ||
      queryLower.includes('architecture') ||
      queryLower.includes('er diagram') ||
      queryLower.includes('class diagram') ||
      queryLower.includes('sequence diagram') ||
      queryLower.includes('mindmap') ||
      queryLower.includes('process map') ||
      queryLower.includes('workflow map') ||
      queryLower.includes('draw a chart') ||
      queryLower.includes('visualize process');

    const isImageQuery =
      queryLower.includes('create an image') ||
      queryLower.includes('generate image') ||
      queryLower.includes('generate an image') ||
      queryLower.includes('visual image') ||
      queryLower.includes('create a visual') ||
      queryLower.includes('draw an illustration') ||
      queryLower.includes('create an illustration') ||
      queryLower.includes('picture explaining') ||
      queryLower.includes('visual explanation');

    const isExplicitSourceRequested =
      queryLower.includes('show me the mermaid') ||
      queryLower.includes('show mermaid') ||
      queryLower.includes('show source') ||
      queryLower.includes('source code') ||
      queryLower.includes('raw syntax') ||
      queryLower.includes('show code');

    // Prepare query terms for hybrid keyword scoring
    const queryTerms = queryLower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w: string) => w.length > 2);

    let allCandidateDocs: any[] = [];
    let queryEmbedding: number[] = [];
    const hasOfflineDocs = offlineDocuments && Array.isArray(offlineDocuments) && offlineDocuments.length > 0;

    // FAST-PATH: Use Speculatively Pre-fetched Document Chunks if available (0ms retrieval latency!)
    const hasValidPrefetched = Array.isArray(prefetchedDocs) && prefetchedDocs.length > 0;
    if (hasValidPrefetched) {
      allCandidateDocs = prefetchedDocs;
    } else {
      // --- REGULAR EXECUTION: Query Embedding (with LRU Cache) + Parallel Supabase / Offline retrieval ---
      const embeddingPromise = getQueryEmbedding(message, useLocalOffline, nvidiaApiKey, openaiApiKey);

      let filenameDocs: any[] = [];
      const hasFiles = fileNames && Array.isArray(fileNames) && fileNames.length > 0;

      // Use Singleton Supabase Client
      const supabaseClient = getSupabaseClient(supabaseUrl, supabaseKey);
      const supabaseFilePromise = (hasFiles && !hasOfflineDocs && supabaseClient && !useLocalOffline)
        ? (async () => {
            try {
              const activeFileNames = fileNames.map((f: string) => f.trim().toLowerCase());
              // Fast select without heavy embedding column
              const { data, error } = await supabaseClient.from('documents').select('id, content, metadata');
              if (!error && data && data.length > 0) {
                filenameDocs = data.filter((d: any) => {
                  const fn = (d.metadata?.filename || d.metadata?.source || '').toLowerCase();
                  return activeFileNames.some((af: string) => fn.includes(af) || af.includes(fn));
                });
              }
            } catch {}
          })()
        : Promise.resolve();

      // Wait for embedding (cached / max 300ms) + filename retrieval
      const [fetchedEmbedding] = await Promise.all([embeddingPromise, supabaseFilePromise]);
      queryEmbedding = fetchedEmbedding;

      allCandidateDocs = [...filenameDocs];
    }

    // If no cloud filename matches found and no offline docs, try Supabase vector search
    const supabaseClient = getSupabaseClient(supabaseUrl, supabaseKey);
    if (allCandidateDocs.length === 0 && !hasOfflineDocs && supabaseClient && !useLocalOffline && queryEmbedding && queryEmbedding.length > 0) {
      try {
        const { data: rawDocs, error: matchError } = await supabaseClient.rpc('match_documents', {
          query_embedding: queryEmbedding,
          match_count: 12,
        });
        if (!matchError && rawDocs) {
          allCandidateDocs.push(...rawDocs);
        }
      } catch {
        console.log('[OFFLINE NOTICE] Supabase cloud unreachable.');
      }
    }

    // Merge active offline documents uploaded in the current session
    if (offlineDocuments && Array.isArray(offlineDocuments) && offlineDocuments.length > 0) {
      offlineDocuments.forEach((d: any) => {
        const docText = d.text || '';
        if (docText.length < 8000) {
          allCandidateDocs.push({
            content: docText,
            metadata: { filename: d.filename || 'Uploaded Document' },
            isFullDoc: true,
          });
        } else {
          const chunkSize = 2000;
          const overlap = 400;
          for (let i = 0; i < docText.length; i += (chunkSize - overlap)) {
            const chunk = docText.slice(i, i + chunkSize);
            if (chunk.trim().length > 50) {
              allCandidateDocs.push({
                content: chunk,
                metadata: { filename: d.filename || 'Uploaded Document' },
              });
            }
          }
        }
      });
    }

    // HYBRID RERANKING: Combine Vector Cosine Similarity + BM25 Keyword Frequency + Exact Phrase Match
    const scoredDocs = allCandidateDocs.map((doc: any) => {
      const text = doc.content || '';
      const textLower = text.toLowerCase();

      // 1. Vector Score
      let vectorScore = 0;
      let emb = doc.embedding;
      if (typeof emb === 'string') {
        try { emb = JSON.parse(emb); } catch {}
      }
      if (Array.isArray(emb) && queryEmbedding && Array.isArray(queryEmbedding) && emb.length === queryEmbedding.length) {
        for (let i = 0; i < queryEmbedding.length; i++) {
          vectorScore += queryEmbedding[i] * emb[i];
        }
      }

      // 2. Keyword BM25 Score
      let keywordScore = 0;
      queryTerms.forEach((term: string) => {
        const matches = (textLower.match(new RegExp(`\\b${term}`, 'g')) || []).length;
        keywordScore += matches * 2;
      });

      // 3. Exact Phrase Match Bonus
      let exactBonus = 0;
      if (textLower.includes(queryLower)) {
        exactBonus = 15;
      }

      const totalScore = (vectorScore * 10) + keywordScore + exactBonus + (doc.isFullDoc ? 5 : 0);

      return {
        ...doc,
        totalScore,
      };
    });

    // Deduplicate and select top 8 chunks (sub-second LLM TTFT)
    scoredDocs.sort((a, b) => b.totalScore - a.totalScore);

    const seenContents = new Set<string>();
    const uniqueTopDocs: any[] = [];

    for (const d of scoredDocs) {
      const snippet = (d.content || '').slice(0, 100);
      if (!seenContents.has(snippet) && d.content && d.content.trim().length > 0) {
        seenContents.add(snippet);
        uniqueTopDocs.push(d);
        if (uniqueTopDocs.length >= 8) break;
      }
    }

    // Build Context with Parent-Child Retrieval
    const context = uniqueTopDocs
      .map((d, i) => {
        const docText = d.metadata?.parentText || d.content || '';
        const fn = d.metadata?.filename || d.metadata?.source || `Document ${i + 1}`;
        return `--- DOCUMENT SOURCE: ${fn} ---\n${docText}`;
      })
      .join('\n\n---\n\n');

    const encoder = new TextEncoder();

    // --- ROUTER PATH B: AI VISUAL ILLUSTRATION REQUEST ---
    if (isImageQuery) {
      const imageResult = await generateVisualIllustration({
        prompt: message,
        pdfContext: context,
        aspectRatio: '16:9',
        style: 'educational',
      });

      const imageMarker = `<!--AI_IMAGE:${JSON.stringify(imageResult)}-->`;
      const responseText = `Here is a high-quality visual illustration grounded in your uploaded document context:\n\n${imageMarker}`;

      return new Response(
        new ReadableStream({
          start(controller) {
            const ssePayload = {
              delta: responseText,
              event: 'messages/partial',
              data: [{ type: 'ai', content: responseText }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
            controller.close();
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
          },
        }
      );
    }

    // --- ROUTER PATH C: TECHNICAL DIAGRAM REQUEST ---
    if (isDiagramQuery) {
      const diagramPlan = planTechnicalDiagram(message, context);

      let diagramText = '';
      if (isExplicitSourceRequested) {
        diagramText = `Here is the requested Mermaid diagram source code for your **${diagramPlan.diagramType}**:\n\n\`\`\`mermaid\n${diagramPlan.mermaidCode}\n\`\`\``;
      } else {
        // Output clean diagram marker so UI renders SVG directly without raw text clutter
        diagramText = `Here is the rendered visual diagram for your document:\n\n\`\`\`mermaid\n${diagramPlan.mermaidCode}\n\`\`\``;
      }

      return new Response(
        new ReadableStream({
          start(controller) {
            const ssePayload = {
              delta: diagramText,
              event: 'messages/partial',
              data: [{ type: 'ai', content: diagramText }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
            controller.close();
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
          },
        }
      );
    }

    // --- ROUTER PATH A / D: NORMAL / MIXED TEXT RESPONSE ---
    const mermaidInstructions = [
      '3. WORLD-CLASS FLOWCHARTS & DIAGRAMS:',
      '   When the user asks for a flowchart, diagram, process map, architecture, or visual workflow:',
      '   - Generate a Mermaid diagram inside a ```mermaid code block.',
      '   - MANDATORY SYNTAX: graph TD or flowchart TD, alphanumeric IDs, quote node labels, valid pipe labels -->|"Label"|.',
    ].join('\n');

    let liveWebContext = '';
    if (!context && !useLocalOffline) {
      const isLiveQuery =
        queryLower.includes('weather') ||
        queryLower.includes('news') ||
        queryLower.includes('stock') ||
        queryLower.includes('price') ||
        queryLower.includes('latest') ||
        queryLower.includes('current');

      if (isLiveQuery) {
        try {
          const webData = await Promise.race([
            performWebSearch(message),
            new Promise<{ results: never[]; summary: string }>((r) => setTimeout(() => r({ results: [], summary: '' }), 1000)),
          ]);
          if (webData.summary) {
            liveWebContext = `\n\nREAL-TIME LIVE WEB DATA:\n${webData.summary.slice(0, 800)}`;
          }
        } catch {}
      }
    }

    const systemPrompt = context
      ? `You are an elite AI Document Intelligence Engine. Your ONLY job is to provide exceptionally accurate answers based STRICTLY on the DOCUMENT CONTEXT provided below.

## ABSOLUTE GROUNDING RULES:
- You MUST answer ONLY using facts explicitly written in DOCUMENT CONTEXT below.
- If information is not mentioned, say "Not mentioned in the document."
- Copy exact numbers, names, and statistics.

DOCUMENT CONTEXT:
${context}`
      : `You are Insight AI, a warm, highly intelligent, and wonderfully friendly assistant.
Converse naturally and humanly!
${mermaidInstructions}${liveWebContext}`;

    let aiResponseStream: ReadableStream | null = null;

    if (!useLocalOffline && nvidiaApiKey) {
      const userModel = process.env.NVIDIA_MODEL || 'meta/llama-3.1-8b-instruct';
      const nvidiaCandidates = Array.from(new Set([userModel, 'meta/llama-3.1-8b-instruct']));

      for (const modelCandidate of nvidiaCandidates) {
        try {
          const candidateAbort = new AbortController();
          const candidateTimer = setTimeout(() => candidateAbort.abort(), 2500);

          const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${nvidiaApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: modelCandidate,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message },
              ],
              stream: true,
              temperature: 0.2,
              max_tokens: 2048,
            }),
            signal: candidateAbort.signal,
          });

          clearTimeout(candidateTimer);

          if (res.ok && res.body) {
            aiResponseStream = res.body;
            break;
          }
        } catch {}
      }
    }

    if (!aiResponseStream && !useLocalOffline && openaiApiKey) {
      try {
        const oaiAbort = new AbortController();
        const oaiTimer = setTimeout(() => oaiAbort.abort(), 2500);

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message },
            ],
            stream: true,
            temperature: 0.1,
            max_tokens: 2048,
          }),
          signal: oaiAbort.signal,
        });

        clearTimeout(oaiTimer);

        if (res.ok && res.body) {
          aiResponseStream = res.body;
        }
      } catch {}
    }

    const readable = new ReadableStream({
      start(controller) {
        if (!aiResponseStream) {
          const standaloneAnswer = generateStandaloneOfflineAnswer(message, uniqueTopDocs);
          const ssePayload = {
            delta: standaloneAnswer,
            event: 'messages/partial',
            data: [{ type: 'ai', content: standaloneAnswer }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
          controller.close();
          return;
        }

        (async () => {
          try {
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
                      delta,
                      event: 'messages/partial',
                      data: [{ type: 'ai', content: fullContent }],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
                  }
                } catch {}
              }
            }
          } catch (err: any) {
            console.error('Stream error:', err);
          } finally {
            try { controller.close(); } catch {}
          }
        })();
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('Chat route unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

/**
 * High-speed Standalone Offline Extractive Engine
 */
function generateStandaloneOfflineAnswer(query: string, docs: any[]): string {
  if (!docs || docs.length === 0) {
    const qLower = query.toLowerCase().trim();
    if (qLower.includes('hi') || qLower.includes('hello') || qLower.includes('hey')) {
      return `Hello there! 😊 How can I help you today? Feel free to ask me anything or upload a document!`;
    }
    return `Hello! I'm ready to help you with anything. Ask me a question or upload a document to get started!`;
  }

  const queryLower = query.toLowerCase();
  const queryTerms = queryLower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const scoredPassages = docs.map((doc) => {
    const text = doc.content || '';
    const textLower = text.toLowerCase();
    let score = 0;

    queryTerms.forEach((term) => {
      const matches = (textLower.match(new RegExp(term, 'g')) || []).length;
      score += matches * 2;
    });

    if (textLower.includes(queryLower)) score += 15;

    return {
      filename: doc.metadata?.filename || 'Uploaded File',
      text,
      score,
    };
  });

  scoredPassages.sort((a, b) => b.score - a.score);
  const bestPassages = scoredPassages.filter((p) => p.text.trim().length > 0).slice(0, 6);

  if (bestPassages.length === 0) {
    return `Based on the uploaded document context, no matching details were found for "${query}".`;
  }

  const primarySource = bestPassages[0].filename;
  const extractedSentences: string[] = [];
  bestPassages.forEach((p) => {
    const sentences = p.text.split(/(?<=[.!?])\s+/);
    sentences.forEach((s: string) => {
      const sLower = s.toLowerCase();
      if (queryTerms.some((term) => sLower.includes(term))) {
        const cleanS = s.replace(/\s+/g, ' ').trim();
        if (cleanS.length > 15 && !extractedSentences.includes(cleanS)) {
          extractedSentences.push(cleanS);
        }
      }
    });
  });

  let output = `Based on your uploaded document (**${primarySource}**), here is what the document states:\n\n`;

  if (extractedSentences.length > 0) {
    output += `### Key Information Found in Document\n\n`;
    extractedSentences.slice(0, 6).forEach((sentence) => {
      output += `• ${sentence}\n`;
    });
  } else {
    output += `${bestPassages[0].text.slice(0, 400)}\n\n`;
  }

  return output.trim();
}

/**
 * Get query embedding with LRU Cache & fail-fast timeout
 */
async function getQueryEmbedding(
  text: string,
  useLocalOffline?: boolean,
  nvidiaApiKey?: string,
  openaiApiKey?: string,
): Promise<number[]> {
  const cacheKey = text.trim().toLowerCase();
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey)!;
  }

  const fetchEmbeddingPromise = (async () => {
    if (openaiApiKey && !useLocalOffline) {
      try {
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
        if (res.ok) {
          const data = await res.json();
          const vec = data.data[0].embedding;
          if (embeddingCache.size >= MAX_EMBEDDING_CACHE) {
            const firstKey = embeddingCache.keys().next().value;
            if (firstKey) embeddingCache.delete(firstKey);
          }
          embeddingCache.set(cacheKey, vec);
          return vec;
        }
      } catch {}
    }

    if (nvidiaApiKey && !useLocalOffline) {
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
          const vec = data.data[0].embedding;
          embeddingCache.set(cacheKey, vec);
          return vec;
        }
      } catch {}
    }

    return [];
  })();

  const timeoutPromise = new Promise<number[]>((resolve) => setTimeout(() => resolve([]), 300));
  return Promise.race([fetchEmbeddingPromise, timeoutPromise]);
}
