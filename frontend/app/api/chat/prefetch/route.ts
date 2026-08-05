export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const { message, fileNames, useLocalOffline, offlineDocuments } = await req.json();

    const trimmed = (message || '').trim();
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

    // Minimum Threshold Gate: Requires >= 10 characters and >= 2 words to avoid pre-fetching on incomplete tokens
    if (!trimmed || trimmed.length < 10 || wordCount < 2) {
      return NextResponse.json(
        { prefetched: false, reason: 'Query below length/word threshold' },
        { status: 200 }
      );
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    // Prepare query terms for hybrid keyword scoring
    const queryLower = trimmed.toLowerCase();
    const queryTerms = queryLower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w: string) => w.length > 2);

    // Fast Embedding Promise (400ms hard timeout)
    const embeddingPromise = getQueryEmbedding(trimmed, useLocalOffline, nvidiaApiKey, openaiApiKey);

    let filenameDocs: any[] = [];
    const hasFiles = fileNames && Array.isArray(fileNames) && fileNames.length > 0;
    const hasOfflineDocs = offlineDocuments && Array.isArray(offlineDocuments) && offlineDocuments.length > 0;

    const supabaseFilePromise = (hasFiles && !hasOfflineDocs && supabaseUrl && supabaseKey && !useLocalOffline)
      ? (async () => {
          try {
            const client = createClient(supabaseUrl, supabaseKey);
            const activeFileNames = fileNames.map((f: string) => f.trim().toLowerCase());
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

    const [queryEmbedding] = await Promise.all([embeddingPromise, supabaseFilePromise]);

    let allCandidateDocs: any[] = [...filenameDocs];

    if (allCandidateDocs.length === 0 && !hasOfflineDocs && supabaseUrl && supabaseKey && !useLocalOffline && queryEmbedding && queryEmbedding.length > 0) {
      try {
        const client = createClient(supabaseUrl, supabaseKey);
        const { data: rawDocs, error: matchError } = await client.rpc('match_documents', {
          query_embedding: queryEmbedding,
          match_count: 15,
        });
        if (!matchError && rawDocs) {
          allCandidateDocs.push(...rawDocs);
        }
      } catch {}
    }

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

    // Hybrid Scoring & Selection
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
      if (textLower.includes(queryLower)) {
        exactBonus = 15;
      }

      const totalScore = (vectorScore * 10) + keywordScore + exactBonus + (doc.isFullDoc ? 5 : 0);

      return {
        ...doc,
        totalScore,
      };
    });

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

    return NextResponse.json({
      prefetched: true,
      draftQuery: trimmed,
      candidateDocs: uniqueTopDocs,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { prefetched: false, error: error?.message || 'Prefetch error' },
      { status: 500 }
    );
  }
}

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
      } catch {}
    }

    return [];
  })();

  const timeoutPromise = new Promise<number[]>((resolve) => setTimeout(() => resolve([]), 400));
  return Promise.race([fetchEmbeddingPromise, timeoutPromise]);
}
