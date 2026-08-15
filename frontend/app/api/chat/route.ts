export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { performWebSearch } from '@/lib/web-search';
import { generateVisualIllustration } from '@/lib/image-generation-service';
import { planTechnicalDiagram, validateAndRepairMermaid } from '@/lib/diagram-planner';
import {
  checkL1ExactCache,
  checkL2SemanticCache,
  evaluateL3CAGRoute,
  checkL4RetrievalCache,
  storeL4RetrievalCache,
  storeResponseCache,
  computeDocHash,
  logTelemetry,
  DEFAULT_CACHE_CONFIG,
} from '@/lib/cag-service';
import { createInstrumenter } from '@/lib/pipeline-benchmark';

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
  const instrumenter = createInstrumenter();
  instrumenter.startRequest();
  const encoder = new TextEncoder();

  try {
    const reqBody = await req.json();
    const {
      message,
      threadId,
      fileNames,
      useLocalOffline,
      offlineDocuments,
      prefetchedDocs,
      cacheConfig = DEFAULT_CACHE_CONFIG,
      topKChunks = 4,
    } = reqBody;

    instrumenter.setTopKChunks(topKChunks);

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    // Determine SHA-256 Document Hash for strict document version binding
    let docHash = reqBody.docHash || '';
    if (!docHash) {
      if (offlineDocuments && Array.isArray(offlineDocuments) && offlineDocuments.length > 0) {
        const text = offlineDocuments.map((d: any) => d.text || '').join('\n');
        const fn = offlineDocuments[0]?.filename || 'Uploaded Document';
        docHash = computeDocHash(text, fn);
      } else if (fileNames && Array.isArray(fileNames) && fileNames.length > 0) {
        docHash = computeDocHash(fileNames.join(','), fileNames[0]);
      }
    }

    // --- CACHE LAYER 1: L1 EXACT RESPONSE CACHE ---
    instrumenter.startCacheLookup();
    const l1Hit = checkL1ExactCache(docHash, message, cacheConfig);
    instrumenter.endCacheLookup();

    if (l1Hit) {
      const breakdown = instrumenter.finalize(15);
      return new Response(
        new ReadableStream({
          start(controller) {
            const payload = {
              delta: l1Hit.response,
              event: 'messages/partial',
              data: [{ type: 'ai', content: l1Hit.response }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            controller.close();
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Cache-Layer': 'L1-Exact',
            'X-TTFT-Ms': '1',
            'X-Retrieval-Ms': '0',
            'X-Total-Ms': breakdown.totalEndToEndMs.toString(),
          },
        }
      );
    }

    // --- CACHE LAYER 2: L2 SEMANTIC RESPONSE CACHE ---
    instrumenter.startEmbedding();
    const queryEmbedding = await getQueryEmbedding(message, useLocalOffline, nvidiaApiKey, openaiApiKey);
    instrumenter.endEmbedding();

    instrumenter.startCacheLookup();
    const l2Hit = checkL2SemanticCache(docHash, message, queryEmbedding, cacheConfig);
    instrumenter.endCacheLookup();

    if (l2Hit) {
      const breakdown = instrumenter.finalize(15);
      return new Response(
        new ReadableStream({
          start(controller) {
            const payload = {
              delta: l2Hit.response,
              event: 'messages/partial',
              data: [{ type: 'ai', content: l2Hit.response }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            controller.close();
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Cache-Layer': 'L2-Semantic',
            'X-TTFT-Ms': breakdown.embeddingMs.toString(),
            'X-Retrieval-Ms': '0',
            'X-Total-Ms': breakdown.totalEndToEndMs.toString(),
          },
        }
      );
    }

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

    let currentLayer: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' = 'L5';
    let context = '';

    // --- CACHE LAYER 3: EVALUATE L3 CAG DOCUMENT CACHE ---
    instrumenter.startCacheLookup();
    const cagRoute = evaluateL3CAGRoute(docHash, message, cacheConfig);
    instrumenter.endCacheLookup();

    if (cagRoute.hit && cagRoute.cagContext) {
      context = cagRoute.cagContext;
      currentLayer = 'L3';
    } else {
      // --- CACHE LAYER 4 & 5: RETRIEVAL CACHE (L4) OR VECTOR DB RAG (L5) ---
      let allCandidateDocs: any[] = [];

      instrumenter.startCacheLookup();
      const l4Hit = checkL4RetrievalCache(docHash, message, cacheConfig);
      instrumenter.endCacheLookup();

      if (l4Hit && l4Hit.documents && l4Hit.documents.length > 0) {
        allCandidateDocs = l4Hit.documents;
        currentLayer = 'L4';
      } else {
        currentLayer = 'L5';
        const hasOfflineDocs = offlineDocuments && Array.isArray(offlineDocuments) && offlineDocuments.length > 0;
        const hasValidPrefetched = Array.isArray(prefetchedDocs) && prefetchedDocs.length > 0;

        if (hasValidPrefetched) {
          allCandidateDocs = prefetchedDocs;
        } else {
          let filenameDocs: any[] = [];
          const hasFiles = fileNames && Array.isArray(fileNames) && fileNames.length > 0;
          const supabaseClient = getSupabaseClient(supabaseUrl, supabaseKey);

          instrumenter.startRetrieval();
          if (hasFiles && !hasOfflineDocs && supabaseClient && !useLocalOffline) {
            try {
              const activeFileNames = fileNames.map((f: string) => f.trim().toLowerCase());
              const { data, error } = await supabaseClient.from('documents').select('id, content, metadata');
              if (!error && data && data.length > 0) {
                filenameDocs = data.filter((d: any) => {
                  const fn = (d.metadata?.filename || d.metadata?.source || '').toLowerCase();
                  return activeFileNames.some((af: string) => fn.includes(af) || af.includes(fn));
                });
              }
            } catch {}
          }

          allCandidateDocs = [...filenameDocs];

          if (allCandidateDocs.length === 0 && !hasOfflineDocs && supabaseClient && !useLocalOffline && queryEmbedding && queryEmbedding.length > 0) {
            try {
              const { data: rawDocs, error: matchError } = await supabaseClient.rpc('match_documents', {
                query_embedding: queryEmbedding,
                match_count: 10,
              });
              if (!matchError && rawDocs) {
                allCandidateDocs.push(...rawDocs);
              }
            } catch {}
          }
          instrumenter.endRetrieval();

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
        }

        // Store retrieval results in L4 cache
        storeL4RetrievalCache(docHash, message, allCandidateDocs, queryEmbedding);
      }

      // Hybrid Reranking & Context Selection
      instrumenter.startRerank();
      const queryTerms = queryLower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w: string) => w.length > 2);
      const scoredDocs = allCandidateDocs.map((doc: any) => {
        const text = doc.content || '';
        const textLower = text.toLowerCase();
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

        let keywordScore = 0;
        queryTerms.forEach((term: string) => {
          const matches = (textLower.match(new RegExp(`\\b${term}`, 'g')) || []).length;
          keywordScore += matches * 2;
        });

        let exactBonus = 0;
        if (textLower.includes(queryLower)) exactBonus = 15;

        const totalScore = (vectorScore * 10) + keywordScore + exactBonus + (doc.isFullDoc ? 5 : 0);
        return { ...doc, totalScore };
      });

      scoredDocs.sort((a, b) => b.totalScore - a.totalScore);
      const seenContents = new Set<string>();
      const uniqueTopDocs: any[] = [];
      for (const d of scoredDocs) {
        const snippet = (d.content || '').slice(0, 100);
        if (!seenContents.has(snippet) && d.content && d.content.trim().length > 0) {
          seenContents.add(snippet);
          uniqueTopDocs.push(d);
          if (uniqueTopDocs.length >= topKChunks) break;
        }
      }
      instrumenter.endRerank();

      context = uniqueTopDocs
        .map((d, i) => {
          const docText = d.metadata?.parentText || d.content || '';
          const fn = d.metadata?.filename || d.metadata?.source || `Document ${i + 1}`;
          return `--- DOCUMENT SOURCE: ${fn} ---\n${docText}`;
        })
        .join('\n\n---\n\n');
    }

    // --- ROUTER PATH B: AI VISUAL ILLUSTRATION REQUEST ---
    if (isImageQuery) {
      instrumenter.startLlmRequest();
      const imageResult = await generateVisualIllustration({
        prompt: message,
        pdfContext: context,
        aspectRatio: '16:9',
        style: 'educational',
      });
      instrumenter.markFirstToken();

      const imageMarker = `<!--AI_IMAGE:${JSON.stringify(imageResult)}-->`;
      const responseText = `Here is a high-quality visual illustration grounded in your uploaded document context:\n\n${imageMarker}`;
      const breakdown = instrumenter.finalize(20);

      logTelemetry({
        timestamp: new Date().toISOString(),
        docHash,
        cacheLayer: currentLayer,
        latencyMs: breakdown.totalEndToEndMs,
        queryLength: message.length,
        isCacheHit: currentLayer !== 'L5',
      });

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
            'X-Cache-Layer': currentLayer,
            'X-TTFT-Ms': breakdown.llmTtftMs.toString(),
            'X-Retrieval-Ms': breakdown.retrievalMs.toString(),
            'X-Total-Ms': breakdown.totalEndToEndMs.toString(),
          },
        }
      );
    }

    // --- ROUTER PATH C: TECHNICAL DIAGRAM REQUEST ---
    if (isDiagramQuery) {
      instrumenter.startLlmRequest();
      const diagramPlan = planTechnicalDiagram(message, context);
      instrumenter.markFirstToken();

      let diagramText = '';
      if (isExplicitSourceRequested) {
        diagramText = `Here is the requested Mermaid diagram source code for your **${diagramPlan.diagramType}**:\n\n\`\`\`mermaid\n${diagramPlan.mermaidCode}\n\`\`\``;
      } else {
        diagramText = `Here is the rendered visual diagram for your document:\n\n\`\`\`mermaid\n${diagramPlan.mermaidCode}\n\`\`\``;
      }

      const breakdown = instrumenter.finalize(20);

      logTelemetry({
        timestamp: new Date().toISOString(),
        docHash,
        cacheLayer: currentLayer,
        latencyMs: breakdown.totalEndToEndMs,
        queryLength: message.length,
        isCacheHit: currentLayer !== 'L5',
      });

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
            'X-Cache-Layer': currentLayer,
            'X-TTFT-Ms': breakdown.llmTtftMs.toString(),
            'X-Retrieval-Ms': breakdown.retrievalMs.toString(),
            'X-Total-Ms': breakdown.totalEndToEndMs.toString(),
          },
        }
      );
    }

    // --- ROUTER PATH A / D: NORMAL / MIXED TEXT RESPONSE STREAM ---
    const mermaidInstructions = [
      '3. WORLD-CLASS FLOWCHARTS & DIAGRAMS:',
      '   When the user asks for a flowchart, diagram, process map, architecture, or visual workflow:',
      '   - Generate a Mermaid diagram inside a ```mermaid code block.',
    ].join('\n');

    let liveWebContext = '';
    if (!context && !useLocalOffline) {
      const isLiveQuery =
        queryLower.includes('weather') ||
        queryLower.includes('news') ||
        queryLower.includes('stock') ||
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

DOCUMENT CONTEXT:
${context}`
      : `You are Insight AI, a warm, highly intelligent, and wonderfully friendly assistant.
Converse naturally and humanly!
${mermaidInstructions}${liveWebContext}`;

    let aiResponseStream: ReadableStream | null = null;
    instrumenter.startLlmRequest();

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
              'Connection': 'keep-alive',
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
            'Connection': 'keep-alive',
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

    const captureLayer = currentLayer;
    const readable = new ReadableStream({
      start(controller) {
        if (!aiResponseStream) {
          instrumenter.markFirstToken();
          const standaloneAnswer = generateStandaloneOfflineAnswer(message, context);
          storeResponseCache(docHash, message, standaloneAnswer, queryEmbedding, captureLayer);

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
          let fullContent = '';
          try {
            const reader = aiResponseStream.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              instrumenter.markFirstToken();
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

            if (fullContent.trim().length > 0) {
              storeResponseCache(docHash, message, fullContent, queryEmbedding, captureLayer);
            }
          } catch (err: any) {
            console.error('Stream error:', err);
          } finally {
            try { controller.close(); } catch {}
          }
        })();
      },
    });

    const breakdown = instrumenter.finalize(20);
    logTelemetry({
      timestamp: new Date().toISOString(),
      docHash,
      cacheLayer: captureLayer,
      latencyMs: breakdown.totalEndToEndMs,
      queryLength: message.length,
      isCacheHit: captureLayer !== 'L5',
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Cache-Layer': captureLayer,
        'X-TTFT-Ms': breakdown.llmTtftMs.toString(),
        'X-Retrieval-Ms': breakdown.retrievalMs.toString(),
        'X-Total-Ms': breakdown.totalEndToEndMs.toString(),
      },
    });
  } catch (error: any) {
    console.error('Chat route unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}

function generateStandaloneOfflineAnswer(query: string, contextStr: string): string {
  if (!contextStr) return `Hello! I am Insight AI. Upload a document to analyze!`;
  return `Based on your uploaded document context:\n\n${contextStr.slice(0, 500)}`;
}

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
            'Connection': 'keep-alive',
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
            'Connection': 'keep-alive',
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
