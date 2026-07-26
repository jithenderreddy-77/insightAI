// app/api/chat/route.ts
// Direct chat — queries Supabase/Vector store and streams AI response (Cloud API GPU + Built-in Standalone Offline RAG Engine)

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

    // 1) Get query embedding with automatic offline fallback
    const queryEmbedding = await getQueryEmbedding(message, useLocalOffline, nvidiaApiKey, openaiApiKey);

    let docs: any[] = [];

    // Attempt Supabase document retrieval if configured & connected
    if (supabaseUrl && supabaseKey && !useLocalOffline) {
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
              docs = scoredDocs.slice(0, 10);
            }
          }
        }

        if (docs.length === 0 && queryEmbedding && queryEmbedding.length > 0) {
          const { data: rawDocs, error: matchError } = await supabaseClient.rpc('match_documents', {
            query_embedding: queryEmbedding,
            match_count: 10,
          });
          if (!matchError && rawDocs) {
            docs = rawDocs;
          }
        }
      } catch (err) {
        console.log('[OFFLINE NOTICE] Supabase cloud unreachable. Running standalone local offline RAG engine.');
      }
    }

    // Offline Document Text Fallback (when Supabase Cloud DB is unreachable or operating offline)
    if (docs.length === 0 && offlineDocuments && Array.isArray(offlineDocuments) && offlineDocuments.length > 0) {
      docs = offlineDocuments.map((d: any) => ({
        content: d.text,
        metadata: { filename: d.filename || 'Uploaded Document' },
      }));
    }

    // Build clean context block
    const context = docs
      .map((doc: any, i: number) => {
        const sourceName = doc.metadata?.filename || doc.metadata?.source || 'Uploaded Document';
        return `[DOCUMENT SOURCE: ${sourceName} — Chunk ${i + 1}]\n${doc.content}`;
      })
      .filter(Boolean)
      .join('\n\n---\n\n');

    const systemPrompt = context
      ? `You are a world-class AI document analyst that produces exceptionally rich, publication-quality responses. Answer the user's question with absolute accuracy using ONLY facts from the DOCUMENT CONTEXT below.

RESPONSE FORMAT RULES:
1. ANSWER: Provide a clear, comprehensive answer based ONLY on the DOCUMENT CONTEXT.
2. MARKDOWN TABLES: For any structured, comparative, or multi-attribute data, produce a well-formatted Markdown table with headers and proper alignment.
3. MERMAID DIAGRAMS: When the user requests a flowchart, diagram, process map, architecture, workflow, pipeline, overview, or any visual representation, you MUST produce a professional-grade Mermaid diagram. Follow ALL these rules:

   MERMAID SYNTAX RULES (MANDATORY):
   a) Start with \`graph TD\` (top-down) or \`graph LR\` (left-right).
   b) Use \`subgraph ID["Readable Title"]\` to group logical phases. End each with \`end\`.
   c) Use \`NodeID["Label"]\` for process steps, \`NodeID{"Label"}\` for decisions, \`NodeID(["Label"])\` for start/end terminals, \`NodeID[["Label"]]\` for subroutines.
   d) Connect nodes with \`-->\` arrows. Use labeled edges like \`A -- "label text" --> B\`.
   e) For decisions, create branches: \`D -- "Yes" --> E\` and \`D -- "No" --> F\`.
   f) Use parallel paths, loops, and feedback arrows where the document describes iterative or branching processes.
   g) Style with \`classDef\` for color-coded nodes: \`classDef primary fill:#4f46e5,stroke:#3730a3,color:#fff\`.
   h) NEVER use emoji or unicode characters inside node labels — plain ASCII text only.
   i) Always wrap labels containing special characters (parentheses, colons, ampersands, commas) in double quotes.
   j) Extract REAL entity names, system components, phases, roles, and data flows from the document text. DO NOT use generic placeholder labels.
   k) Aim for 10-25 nodes across 3-5 subgraphs for a comprehensive, detailed diagram.
   l) Close every \`subgraph\` with \`end\`.
   m) Apply classDef styles at the end with \`class NodeID className\`.

   EXAMPLE of a correct, high-quality diagram:
   \`\`\`mermaid
   graph TD
     subgraph Input_Phase["Data Collection"]
       A(["Start"]) --> B["Receive user query"]
       B --> C["Load uploaded document"]
     end
     subgraph Analysis_Phase["Intelligent Processing"]
       C --> D{"Document type?"}
       D -- "PDF" --> E["Extract text via parser"]
       D -- "Image" --> F["Run OCR engine"]
       D -- "Spreadsheet" --> G["Parse tabular data"]
       E --> H["Chunk text into segments"]
       F --> H
       G --> H
     end
     subgraph AI_Phase["AI Reasoning"]
       H --> I["Generate vector embeddings"]
       I --> J["Semantic similarity search"]
       J --> K{"Relevant match found?"}
       K -- "Yes" --> L["Synthesize AI answer"]
       K -- "No" --> M["Request clarification"]
     end
     subgraph Output_Phase["Response Delivery"]
       L --> N["Format with tables and diagrams"]
       M --> N
       N --> O(["End"])
     end
     classDef primary fill:#4f46e5,stroke:#3730a3,color:#fff
     classDef decision fill:#f59e0b,stroke:#d97706,color:#000
     classDef terminal fill:#10b981,stroke:#059669,color:#fff
     class B,C,E,F,G,H,I,J,L,M,N primary
     class D,K decision
     class A,O terminal
   \`\`\`

4. Do NOT invent or extrapolate facts outside the DOCUMENT CONTEXT.
5. If unanswerable from context, state: "Based on the uploaded document, this information is not mentioned in the text."

DOCUMENT CONTEXT:
${context}`
      : `You are a world-class AI assistant. Answer clearly and accurately. When asked for diagrams or flowcharts, produce professional-grade Mermaid diagrams with subgraphs, decision diamonds, styled classDef nodes, labeled edges, and 10+ nodes. Do NOT use emoji in Mermaid labels. Always wrap special characters in quotes.`;

    // 2) Get AI Completion Stream — Priority: GPT-4o > NVIDIA > Ollama > Offline Engine
    let aiResponseStream: ReadableStream | null = null;

    // Try OpenAI GPT-4o FIRST (best diagram quality)
    if (!useLocalOffline && openaiApiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message },
            ],
            stream: true,
            temperature: 0.2,
            max_tokens: 4096,
          }),
        });

        if (res.ok && res.body) {
          aiResponseStream = res.body;
        }
      } catch (networkError) {
        console.log('[GPT-4o] OpenAI unreachable, falling back to NVIDIA...');
      }
    }

    // Fallback to NVIDIA if OpenAI fails
    if (!aiResponseStream && !useLocalOffline && nvidiaApiKey) {
      try {
        const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${nvidiaApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'meta/llama-3.1-8b-instruct',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message },
            ],
            stream: true,
            temperature: 0.2,
            max_tokens: 4096,
          }),
        });

        if (res.ok && res.body) {
          aiResponseStream = res.body;
        }
      } catch (networkError) {
        console.log('[NVIDIA] Cloud API unreachable. Switching to Offline Engine...');
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
          const standaloneAnswer = generateStandaloneOfflineAnswer(message, docs);
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
    return `Based on the uploaded document, no document content was found to answer "${query}". Please ensure your PDF, Word, Excel, or Text file is uploaded.`;
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
  const bestPassages = scoredPassages.filter((p) => p.text.trim().length > 0).slice(0, 5);

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
    queryLower.includes('step') ||
    queryLower.includes('draw') ||
    queryLower.includes('create') ||
    queryLower.includes('make') ||
    queryLower.includes('chart') ||
    queryLower.includes('visualize') ||
    queryLower.includes('how');

  let output = `Based on your uploaded document (**${primarySource}**), here is the answer to your query:\n\n`;

  // 1. Sentence/Fact Highlights
  if (extractedSentences.length > 0) {
    extractedSentences.slice(0, 6).forEach((sentence) => {
      output += `• ${sentence}\n`;
    });
    output += `\n`;
  } else {
    output += `${bestPassages[0].text.slice(0, 300)}...\n\n`;
  }

  // 2. Structured Markdown Table
  if (wantsTable || extractedSentences.length >= 3) {
    output += `### 📊 Document Intelligence Summary Table\n\n`;
    output += `| **Key Feature / Topic** | **Document Extracted Information** |\n`;
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

    output += `### Advanced Document Workflow Diagram\n\n`;
    output += `\`\`\`mermaid\ngraph TD\n`;
    output += `  subgraph Source_Layer["Document Source"]\n`;
    output += `    A["${cleanSource}"] --> B["${step1}"]\n`;
    output += `  end\n\n`;
    output += `  subgraph Processing_Layer["Intelligence and Verification"]\n`;
    output += `    B --> C{"Match Relevant Data?"}\n`;
    output += `    C -- High Confidence --> D["${step2}"]\n`;
    output += `    C -- Deep Analysis --> E["${step3}"]\n`;
    output += `  end\n\n`;
    output += `  subgraph Output_Layer["Synthesized Output"]\n`;
    output += `    D --> F["${step4}"]\n`;
    output += `    E --> F\n`;
    output += `  end\n`;
    output += `\`\`\`\n\n`;
  }

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

  const timeoutPromise = new Promise<number[]>((resolve) => setTimeout(() => resolve([]), 1000));
  return Promise.race([fetchEmbeddingPromise, timeoutPromise]);
}
