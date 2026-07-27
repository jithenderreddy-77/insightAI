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
    const openaiApiKey = process.env.OPENAI_API_KEY;    // Prepare query terms for hybrid keyword scoring
    const queryLower = message.toLowerCase();
    const queryTerms = queryLower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w: string) => w.length > 2);

    let allCandidateDocs: any[] = [];

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
              allCandidateDocs.push(...matchingFileDocs);
            }
          }
        }

        if (allCandidateDocs.length === 0 && queryEmbedding && queryEmbedding.length > 0) {
          const { data: rawDocs, error: matchError } = await supabaseClient.rpc('match_documents', {
            query_embedding: queryEmbedding,
            match_count: 30,
          });
          if (!matchError && rawDocs) {
            allCandidateDocs.push(...rawDocs);
          }
        }
      } catch (err) {
        console.log('[OFFLINE NOTICE] Supabase cloud unreachable. Running standalone local offline RAG engine.');
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
          // Large file: split into 1500-char overlapping passages
          const chunkSize = 1500;
          const overlap = 300;
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

    // Deduplicate and select top 25 chunks
    scoredDocs.sort((a, b) => b.totalScore - a.totalScore);

    const seenContents = new Set<string>();
    const uniqueTopDocs: any[] = [];

    for (const d of scoredDocs) {
      const snippet = (d.content || '').slice(0, 100);
      if (!seenContents.has(snippet) && d.content && d.content.trim().length > 0) {
        seenContents.add(snippet);
        uniqueTopDocs.push(d);
        if (uniqueTopDocs.length >= 25) break;
      }
    }

    docs = uniqueTopDocs;

    // Build clean context block with up to 12,000 tokens
    const context = docs
      .map((doc: any, i: number) => {
        const sourceName = doc.metadata?.filename || doc.metadata?.source || 'Uploaded Document';
        return `[DOCUMENT SOURCE: ${sourceName} — Passage ${i + 1}]\n${doc.content}`;
      })
      .filter(Boolean)
      .join('\n\n---\n\n');

    const systemPrompt = context
      ? `You are an elite AI Document Intelligence Engine powered by GPT-4o. Your mission is to provide exceptionally accurate, thorough, and insightful answers to the user's questions based ONLY on the DOCUMENT CONTEXT below.

CRITICAL INSTRUCTIONS FOR TOUGH & COMPLEX QUESTIONS:
1. DEEP ANALYTICAL REASONING: For complex, detailed, multi-part, or challenging questions, analyze all provided passages thoroughly. Synthesize facts across different sections of the document to form a complete, comprehensive answer.
2. ACCURACY & EVIDENCE: Base your answer STRICTLY on facts, figures, tables, and statements explicitly present in the DOCUMENT CONTEXT. Quote or cite specific data points when answering technical questions.
3. RICH FORMATTING:
   - HEADINGS & BULLET LISTS: Use bold headings (###) and bullet points to break down complex explanations into clear, readable sections.
   - MARKDOWN TABLES: Whenever comparing attributes, presenting specs, metrics, numerical data, or lists of features, ALWAYS generate a well-structured Markdown table (| Feature | Details |).
   - MERMAID DIAGRAMS: When asked for a flowchart, workflow, architecture, process map, or visual representation, generate a professional Mermaid diagram in a \`\`\`mermaid code block with subgraphs, decision diamonds, and color-coded classDef nodes.
     * Use \`graph TD\` or \`graph LR\`.
     * Group logical phases with \`subgraph Phase_Name["Phase Title"]\` ... \`end\`.
     * Use decision diamonds \`C{"Condition?"}\` with labeled branches \`C -- "Yes" --> D\` and \`C -- "No" --> E\`.
     * NEVER use emojis inside Mermaid node labels.
     * Always wrap special characters in double quotes.
4. ABSOLUTE HONESTY: Do NOT invent, assume, or extrapolate facts outside the DOCUMENT CONTEXT. If the specific answer is not mentioned in the provided document, state: "Based on the uploaded document, this specific information is not mentioned in the text."

DOCUMENT CONTEXT:
${context}`
      : `You are a world-class AI assistant powered by GPT-4o. Answer clearly and accurately. When asked for diagrams or flowcharts, produce professional-grade Mermaid diagrams with subgraphs, decision diamonds, styled classDef nodes, labeled edges, and 10+ nodes. Do NOT use emoji in Mermaid labels. Always wrap special characters in quotes.`;

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
