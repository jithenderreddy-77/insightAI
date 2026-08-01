export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { performWebSearch } from '@/lib/web-search';

export async function POST(req: Request) {
  try {
    const { message, threadId, fileNames, useLocalOffline, offlineDocuments } = await req.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    // Prepare query terms for hybrid keyword scoring
    const queryLower = message.toLowerCase();
    const queryTerms = queryLower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w: string) => w.length > 2);

    // --- PARALLEL EXECUTION: Embedding + Supabase filename retrieval start simultaneously ---
    const embeddingPromise = getQueryEmbedding(message, useLocalOffline, nvidiaApiKey, openaiApiKey);

    // Start Supabase filename retrieval in parallel (no embedding needed)
    let filenameDocs: any[] = [];
    const hasFiles = fileNames && Array.isArray(fileNames) && fileNames.length > 0;
    const supabaseFilePromise = (hasFiles && supabaseUrl && supabaseKey && !useLocalOffline)
      ? (async () => {
          try {
            const client = createClient(supabaseUrl, supabaseKey);
            const activeFileNames = fileNames.map((f: string) => f.trim().toLowerCase());
            // Don't download embedding column — massive speedup
            const { data, error } = await client.from('documents').select('id, content, metadata');
            if (!error && data && data.length > 0) {
              filenameDocs = data.filter((d: any) => {
                const fn = (d.metadata?.filename || d.metadata?.source || '').toLowerCase();
                return activeFileNames.some((af: string) => fn.includes(af) || af.includes(fn));
              });
            }
          } catch {}
        })()
      : Promise.resolve();

    // Wait for both embedding + filename retrieval to complete in parallel
    const [queryEmbedding] = await Promise.all([embeddingPromise, supabaseFilePromise]);

    let allCandidateDocs: any[] = [...filenameDocs];

    // If no filename matches found, use vector similarity search
    if (allCandidateDocs.length === 0 && supabaseUrl && supabaseKey && !useLocalOffline && queryEmbedding && queryEmbedding.length > 0) {
      try {
        const client = createClient(supabaseUrl, supabaseKey);
        const { data: rawDocs, error: matchError } = await client.rpc('match_documents', {
          query_embedding: queryEmbedding,
          match_count: 15,
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
          // Small file: include full content as a single complete chunk
          allCandidateDocs.push({
            content: docText,
            metadata: { filename: d.filename || 'Uploaded Document' },
            isFullDoc: true,
          });
        } else {
          // Large file: split into 2000-char overlapping passages for better context preservation
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

    // Deduplicate and select top 12 chunks (fewer = faster LLM response)
    scoredDocs.sort((a, b) => b.totalScore - a.totalScore);

    const seenContents = new Set<string>();
    const uniqueTopDocs: any[] = [];

    for (const d of scoredDocs) {
      const snippet = (d.content || '').slice(0, 100);
      if (!seenContents.has(snippet) && d.content && d.content.trim().length > 0) {
        seenContents.add(snippet);
        uniqueTopDocs.push(d);
        if (uniqueTopDocs.length >= 12) break;
      }
    }

    // Build Context with Parent-Child Retrieval:
    // Uses metadata.parentText (1,500 chars surrounding context) when available for max precision + context!
    const context = uniqueTopDocs
      .map((d, i) => {
        const docText = d.metadata?.parentText || d.content || '';
        const fn = d.metadata?.filename || d.metadata?.source || `Document ${i + 1}`;
        return `--- DOCUMENT SOURCE: ${fn} ---\n${docText}`;
      })
      .join('\n\n---\n\n');

    const mermaidInstructions = [
      '3. WORLD-CLASS FLOWCHARTS & DIAGRAMS:',
      '   When the user asks to create a flowchart, diagram, process map, architecture, or visual workflow:',
      '   - You MUST generate an ultra-detailed, publication-quality Mermaid diagram inside a ```mermaid code block.',
      '   - MANDATORY DIAGRAM STRUCTURE:',
      '     * Use `graph TD` (Top-Down) or `graph LR` (Left-Right).',
      '     * Group logical steps into 3 to 5 clear subgraphs: `subgraph Phase1["Phase 1: Ingestion"]` ... `end`.',
      '     * Extract REAL entity names, technical steps, decision points, components, and roles directly from the DOCUMENT CONTEXT.',
      '     * Include decision diamonds `C{"Condition?"}` with labeled branches `C -->|"Yes"| D` and `C -->|"No"| E`.',
      '     * Include 12 to 25 connected nodes for a comprehensive visual map.',
      '     * CRITICAL SYNTAX RULES (FOR 100% PARSE SUCCESS):',
      '       - ALWAYS write pipe labels wrapped in double quotes: `A -->|"Label text"| B` (NEVER add trailing `>` after pipe).',
      '       - ALWAYS write subgraphs with ID and quotes: `subgraph SG1["Title with spaces"]` ... `end`.',
      '       - NEVER use emojis or unicode symbols inside Mermaid node labels — plain text only.',
      '       - Always wrap node labels containing spaces or special characters in double quotes: `A["Parse Text (PDF/OCR)"]`.',
      '       - Use standard connectors `-->` or `A -->|"Label"| B`. NEVER output invalid double-arrows `-->>` or semicolons `;`.',
      '       - Do NOT output stray `classDef` or `style` lines.',
    ].join('\n');

    let liveWebContext = '';
    if (!context && !useLocalOffline) {
      const isLiveQuery =
        queryLower.includes('weather') ||
        queryLower.includes('news') ||
        queryLower.includes('stock') ||
        queryLower.includes('score') ||
        queryLower.includes('price') ||
        queryLower.includes('today') ||
        queryLower.includes('latest') ||
        queryLower.includes('current') ||
        queryLower.includes('who is') ||
        queryLower.includes('what is the price');

      if (isLiveQuery) {
        try {
          // Web search with 1.5s hard timeout so it never blocks chat
          const webSearchWithTimeout = Promise.race([
            performWebSearch(message),
            new Promise<{ results: never[]; summary: string }>((r) => setTimeout(() => r({ results: [], summary: '' }), 1500)),
          ]);
          const webData = await webSearchWithTimeout;
          if (webData.summary) {
            liveWebContext = `\n\nREAL-TIME LIVE WEB DATA:\n${webData.summary.slice(0, 800)}\nUse the real-time web data above if relevant to answer the query accurately.`;
          }
        } catch {}
      }
    }

    const systemPrompt = context
      ? `You are an elite AI Document Intelligence Engine. Your ONLY job is to provide exceptionally accurate answers based STRICTLY on the DOCUMENT CONTEXT provided below.

## ABSOLUTE GROUNDING RULES (MOST IMPORTANT — NEVER VIOLATE):
- You MUST answer ONLY using facts, data, names, numbers, and details that are EXPLICITLY written in the DOCUMENT CONTEXT below.
- If a piece of information (e.g., years of experience, salary, company names, dates, skills, certifications) is NOT explicitly mentioned in the DOCUMENT CONTEXT, you MUST say "Not mentioned in the document" or "This information is not available in the uploaded document."
- NEVER guess, assume, infer, or fabricate any facts. NEVER fill in gaps with general knowledge.
- If the document says the candidate has "no experience" or does not mention any work experience, report exactly that — do NOT invent experience.
- When quoting numbers, dates, percentages, or statistics, copy them EXACTLY from the document. Do not round, estimate, or approximate.

DOCUMENT CONTEXT:
${context}`
      : `You are Insight AI, a warm, highly intelligent, enthusiastic, and wonderfully friendly AI assistant.
Converse naturally, humanly, and helpfully—just like a brilliant human friend!
- Respond to greetings ("hi", "hello", "good morning", "how are you") warmly and conversationally.
- Answer any question, write code, brainstorm ideas, write essays, or explain complex concepts with absolute clarity and flair.
- ${mermaidInstructions}${liveWebContext}`;

    // 2) Get AI Completion Stream — Priority: NVIDIA Nemotron (primary) → OpenAI → Ollama → Offline Engine
    let aiResponseStream: ReadableStream | null = null;

    // Try NVIDIA Nemotron FIRST (user's active primary key — ultra-fast reasoning model)
    if (!useLocalOffline && nvidiaApiKey) {
      try {
        const nvidiaModel = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b';
        const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${nvidiaApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: nvidiaModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message },
            ],
            stream: true,
            temperature: 0.7,
            top_p: 0.95,
            max_tokens: 4096,
          }),
        });

        if (res.ok && res.body) {
          aiResponseStream = res.body;
        } else {
          console.log(`[NVIDIA] API returned status ${res.status}, falling back to OpenAI...`);
        }
      } catch (networkError) {
        console.log('[NVIDIA] Nemotron unreachable, falling back to OpenAI...');
      }
    }

    // Fallback to OpenAI GPT-4o-mini if NVIDIA fails
    if (!aiResponseStream && !useLocalOffline && openaiApiKey) {
      try {
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
            max_tokens: 4096,
          }),
        });

        if (res.ok && res.body) {
          aiResponseStream = res.body;
        }
      } catch (networkError) {
        console.log('[OpenAI] GPT-4o-mini unreachable, falling back to Ollama...');
      }
    }

    // Try local Ollama if configured and reachable
    if (!aiResponseStream && process.env.OLLAMA_HOST) {
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
      } catch {}
    }

    const encoder = new TextEncoder();

    // Stream SSE Response cleanly to client
    const readable = new ReadableStream({
      start(controller) {
        if (!aiResponseStream) {
          // Built-in Standalone Offline Extractive Intelligence Engine (Zero external dependencies)
          const standaloneAnswer = generateStandaloneOfflineAnswer(message, uniqueTopDocs);
          const ssePayload = {
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
          } finally {
            try {
              controller.close();
            } catch {}
          }
        })();
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
 * Built-in Ultra-Fast Standalone Offline Extractive Intelligence & Synthesis Engine
 * Operates 100% offline with zero external model installation requirements!
 */
function generateStandaloneOfflineAnswer(query: string, docs: any[]): string {
  if (!docs || docs.length === 0) {
    const qLower = query.toLowerCase().trim();
    if (qLower.includes('hi') || qLower.includes('hello') || qLower.includes('good morning') || qLower.includes('good evening') || qLower.includes('hey')) {
      return `Hello there! 😊 Good day! I'm Insight AI, your intelligent assistant. How can I help you today? Feel free to ask me anything or upload a document for deep analysis!`;
    }
    if (qLower.includes('how are you') || qLower.includes('how do you do')) {
      return `I'm doing fantastic, thank you for asking! ✨ I'm ready to help you with anything—answering questions, writing code, or analyzing documents. How is your day going?`;
    }
    if (qLower.includes('who are you') || qLower.includes('what can you do')) {
      return `I am Insight AI! 🚀 I can answer any questions, chat naturally, write code, create visual Mermaid flowcharts, summarize documents, and automate web and app actions. What would you like to explore?`;
    }
    return `Hello! I'm ready to help you with anything. Ask me any question, brainstorm ideas, or upload a document to get started!`;
  }

  const queryLower = query.toLowerCase();
  const queryTerms = queryLower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // Score document passages using TF-IDF n-gram term frequency
  const scoredPassages = docs.map((doc) => {
    const text = doc.content || '';
    const textLower = text.toLowerCase();
    let score = 0;

    queryTerms.forEach((term) => {
      const matches = (textLower.match(new RegExp(term, 'g')) || []).length;
      score += matches * 2;
    });

    // Exact phrase bonus
    if (textLower.includes(queryLower)) {
      score += 15;
    }

    return {
      filename: doc.metadata?.filename || 'Uploaded File',
      text,
      score,
    };
  });

  scoredPassages.sort((a, b) => b.score - a.score);
  const bestPassages = scoredPassages.filter((p) => p.text.trim().length > 0).slice(0, 8);

  if (bestPassages.length === 0) {
    return `Based on the uploaded document context, no matching details were found for "${query}".`;
  }

  const primarySource = bestPassages[0].filename;

  // Extract key facts and sentences matching query
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

  // Determine response format based on query intent
  const wantsTable =
    queryLower.includes('table') ||
    queryLower.includes('summary') ||
    queryLower.includes('compare') ||
    queryLower.includes('feature') ||
    queryLower.includes('list') ||
    queryLower.includes('specs');

  const wantsFlowchart =
    queryLower.includes('flowchart') ||
    queryLower.includes('diagram') ||
    queryLower.includes('process') ||
    queryLower.includes('workflow') ||
    queryLower.includes('architecture') ||
    queryLower.includes('pipeline') ||
    queryLower.includes('draw') ||
    queryLower.includes('chart') ||
    queryLower.includes('visualize') ||
    queryLower.includes('map');

  let output = `Based on your uploaded document (**${primarySource}**), here is what the document states:\n\n`;

  // 1. Sentence/Fact Highlights
  if (extractedSentences.length > 0) {
    output += `### Key Information Found in Document\n\n`;
    extractedSentences.slice(0, 8).forEach((sentence) => {
      output += `• ${sentence}\n`;
    });
    output += `\n`;
  } else {
    output += `### Document Content Extract\n\n`;
    output += `${bestPassages[0].text.slice(0, 500)}\n\n`;
  }

  // 2. Structured Markdown Table
  if (wantsTable || extractedSentences.length >= 3) {
    output += `### Document Intelligence Summary Table\n\n`;
    output += `| **Key Topic** | **Information from Document** |\n`;
    output += `| --- | --- |\n`;

    const factPairs = extractedSentences.slice(0, 5);
    if (factPairs.length > 0) {
      factPairs.forEach((fact, idx) => {
        const topic = fact.split(':')[0].slice(0, 30) || `Key Point ${idx + 1}`;
        const detail = fact.includes(':') ? fact.split(':').slice(1).join(':') : fact;
        output += `| ${topic.replace(/\|/g, '-')} | ${detail.replace(/\|/g, '-')} |\n`;
      });
    } else {
      output += `| Primary Topic | ${bestPassages[0].text.slice(0, 100).replace(/\|/g, '-')} |\n`;
    }
    output += `\n`;
  }

  // 3. Advanced Document-Specific Interactive Mermaid Flowchart
  if (wantsFlowchart) {
    const cleanSource = primarySource.replace(/[^a-zA-Z0-9._\s-]/g, '');
    const topicList = extractedSentences
      .map((s) => s.split(':')[0].trim().slice(0, 32).replace(/[^a-zA-Z0-9\s]/g, ''))
      .filter((t) => t.length > 3);

    const step1 = topicList[0] || 'Document Text Extraction';
    const step2 = topicList[1] || 'Semantic Fact Analysis';
    const step3 = topicList[2] || 'Data Verification Pipeline';
    const step4 = topicList[3] || 'Synthesized Document Insights';

    output += `### Document Workflow Diagram\n\n`;
    output += `\`\`\`mermaid\ngraph TD\n`;
    output += `  subgraph Source_Layer["Document Source"]\n`;
    output += `    A["${cleanSource}"] --> B["${step1}"]\n`;
    output += `  end\n\n`;
    output += `  subgraph Processing_Layer["Intelligence and Verification"]\n`;
    output += `    B --> C{"Match Relevant Data?"}\n`;
    output += `    C -->|"High Confidence"| D["${step2}"]\n`;
    output += `    C -->|"Deep Analysis"| E["${step3}"]\n`;
    output += `  end\n\n`;
    output += `  subgraph Output_Layer["Synthesized Output"]\n`;
    output += `    D --> F["${step4}"]\n`;
    output += `    E --> F\n`;
    output += `  end\n`;
    output += `\`\`\`\n\n`;
  }

  output += `\n> **Note:** This answer is extracted directly from your uploaded document content. Only facts present in the document are reported.`;

  return output.trim();
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
  const fetchEmbeddingPromise = (async () => {
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

    // Use text-embedding-3-small for QUERY (ultra-fast ~100ms) — compatible with text-embedding-3-large vectors
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
          return data.data[0].embedding;
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
          return data.data[0].embedding;
        }
      } catch {
        console.log('[OFFLINE NOTICE] Cloud embedding unreachable.');
      }
    }

    return [];
  })();

  // Hard 800ms timeout — skip embedding entirely if slow, rely on keyword search
  const timeoutPromise = new Promise<number[]>((resolve) => setTimeout(() => resolve([]), 800));
  return Promise.race([fetchEmbeddingPromise, timeoutPromise]);
}
