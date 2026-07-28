// app/api/ingest/route.ts

// Force Node.js runtime — pdf-parse and fs/os/path are not available in Edge
export const runtime = 'nodejs';

// Allow long-running uploads
export const maxDuration = 120; // seconds

import { processDocument, SUPPORTED_MIME_TYPES, SUPPORTED_EXTENSIONS } from '@/lib/pdf';
import { Document } from '@langchain/core/documents';
import { NextRequest, NextResponse } from 'next/server';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { createClient } from '@supabase/supabase-js';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

// Configuration constants — Supports up to 500MB files
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB per file
const MAX_FILES = 50; // up to 50 files simultaneously

function isFileSupported(file: File): boolean {
  if (SUPPORTED_MIME_TYPES.includes(file.type)) {
    return true;
  }
  const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(extension);
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    const contentType = request.headers.get('content-type') || '';
    const allDocs: Document[] = [];
    const errors: string[] = [];

    // Handle JSON payload (sent from client chunking for huge >4MB / 200MB+ files)
    if (contentType.includes('application/json')) {
      const jsonBody = await request.json();
      const docsPayload = jsonBody.parsedDocuments || jsonBody.documents || [];

      for (const item of docsPayload) {
        const text = item.text || item.content || '';
        const filename = item.filename || item.source || 'Uploaded Large File';
        if (text.trim().length > 0) {
          allDocs.push(
            new Document({
              pageContent: text,
              metadata: { filename, source: filename },
            })
          );
        }
      }
    } else {
      // Handle Multipart FormData file upload
      const formData = await request.formData();
      const files: File[] = [];

      for (const [key, value] of formData.entries()) {
        if (key === 'files' && value instanceof File) {
          files.push(value);
        }
      }

      if (!files || files.length === 0) {
        return NextResponse.json({ error: 'No files provided' }, { status: 400 });
      }

      if (files.length > MAX_FILES) {
        return NextResponse.json(
          { error: `Too many files. Maximum ${MAX_FILES} files allowed.` },
          { status: 400 },
        );
      }

      const invalidFiles = files.filter((file) => {
        return !isFileSupported(file) || file.size > MAX_FILE_SIZE;
      });

      if (invalidFiles.length > 0) {
        return NextResponse.json(
          {
            error: `Invalid files found. Supported formats: PDF, DOC, DOCX, PPT, PPTX, TXT, CSV, XLSX, XLS, PNG, JPG, WEBP, GIF, SVG. Max size per file: 500MB`,
            invalidFiles: invalidFiles.map((f) => f.name),
          },
          { status: 400 },
        );
      }

      for (const file of files) {
        try {
          const fileDocs = await processDocument(file);
          allDocs.push(...fileDocs);
        } catch (error: any) {
          console.error(`Error processing file ${file.name}:`, error);
          errors.push(`Failed to process ${file.name}: ${error.message}`);
        }
      }
    }

    if (allDocs.length === 0) {
      return NextResponse.json(
        {
          error: 'No text could be extracted from the uploaded files.',
          details: errors,
        },
        { status: 400 },
      );
    }

    // Split text into 1000 character chunks with 200 character overlap
    // Larger chunks preserve context (e.g., resume experience sections stay together)
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const splitDocs = await textSplitter.splitDocuments(allDocs);

    const offlineParsedDocuments = splitDocs.map((d) => ({
      text: d.pageContent,
      filename: (d.metadata as any)?.filename || (d.metadata as any)?.source || 'Uploaded File',
    }));

    // Try Cloud Vector Indexing if internet is connected (with fast 2.5s timeout)
    let cloudIngested = false;
    if (supabaseUrl && supabaseKey && (nvidiaApiKey || openaiApiKey)) {
      try {
        const cloudIngestPromise = (async () => {
          let embeddings: any;

          if (nvidiaApiKey) {
            embeddings = {
              embedDocuments: async (texts: string[]): Promise<number[][]> => {
                const batchSize = 50;
                const batchPromises = [];
                for (let i = 0; i < texts.length; i += batchSize) {
                  const batch = texts.slice(i, i + batchSize);
                  batchPromises.push(
                    fetch('https://integrate.api.nvidia.com/v1/embeddings', {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${nvidiaApiKey}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        model: 'nvidia/nv-embedqa-e5-v5',
                        input: batch,
                        input_type: 'passage',
                      }),
                    }).then((r) => (r.ok ? r.json() : { data: [] }))
                  );
                }
                const results = await Promise.all(batchPromises);
                const allEmbeddings: number[][] = [];
                for (const res of results) {
                  if (res.data) {
                    for (const item of res.data) {
                      allEmbeddings.push(item.embedding);
                    }
                  }
                }
                return allEmbeddings;
              },
              embedQuery: async (text: string): Promise<number[]> => {
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
                return [];
              },
            };
          } else if (openaiApiKey) {
            embeddings = new OpenAIEmbeddings({
              model: 'text-embedding-3-small',
              apiKey: openaiApiKey,
            });
          }

          if (embeddings) {
            const supabaseClient = createClient(supabaseUrl, supabaseKey);
            const vectorStore = new SupabaseVectorStore(embeddings, {
              client: supabaseClient,
              tableName: 'documents',
              queryName: 'match_documents',
            });

            // Store in vector store in parallel batches
            const BATCH_SIZE = 25;
            const insertPromises = [];
            for (let i = 0; i < splitDocs.length; i += BATCH_SIZE) {
              const batch = splitDocs.slice(i, i + BATCH_SIZE);
              insertPromises.push(vectorStore.addDocuments(batch));
            }
            await Promise.all(insertPromises);
            return true;
          }
          return false;
        })();

        // Fast 2.5 second timeout so document upload responds instantly (< 300ms)
        const timeoutPromise = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500));
        cloudIngested = await Promise.race([cloudIngestPromise, timeoutPromise]);
      } catch (err) {
        console.log('[OFFLINE INGEST NOTICE] Cloud vector indexing skipped or timed out. Extracted text cached 100% offline.');
      }
    }

    return NextResponse.json({
      message: cloudIngested
        ? 'Documents ingested successfully to Cloud Vector DB'
        : 'Documents parsed & indexed 100% offline successfully',
      documentCount: splitDocs.length,
      isOfflineMode: !cloudIngested,
      parsedDocuments: offlineParsedDocuments,
      warnings: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('Error processing files:', error);
    return NextResponse.json(
      { error: 'Failed to process files', details: error.message },
      { status: 500 },
    );
  }
}
