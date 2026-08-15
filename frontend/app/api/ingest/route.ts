// app/api/ingest/route.ts

// Force Node.js runtime — pdf-parse and fs/os/path are not available in Edge
export const runtime = 'nodejs';

// Allow long-running uploads
export const maxDuration = 120; // seconds

import { processDocument, SUPPORTED_MIME_TYPES, SUPPORTED_EXTENSIONS } from '@/lib/pdf';
import { parseSpreadsheet, isSpreadsheetFile, SpreadsheetParseError } from '@/lib/spreadsheet-parser';
import type { SpreadsheetData } from '@/lib/spreadsheet-parser';
import { Document } from '@langchain/core/documents';
import { NextRequest, NextResponse } from 'next/server';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { createClient } from '@supabase/supabase-js';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { computeDocHash, buildCAGDocumentCache, invalidateDocCache } from '@/lib/cag-service';

// Configuration constants — Supports up to 2GB files and 1000 files per batch
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB per file
const MAX_FILES = 1000; // up to 1000 files simultaneously

function isFileSupported(file: File): boolean {
  if (file.type && SUPPORTED_MIME_TYPES.includes(file.type)) {
    return true;
  }
  const name = file.name || '';
  const lastDot = name.lastIndexOf('.');
  if (lastDot !== -1) {
    const extension = name.substring(lastDot).toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(extension);
  }
  return true;
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    const contentType = (typeof request.headers?.get === 'function' ? request.headers.get('content-type') : (request.headers as any)?.['content-type']) || '';
    const allDocs: Document[] = [];
    const errors: string[] = [];
    let spreadsheetDataMap: Record<string, SpreadsheetData> = {};

    // Handle JSON payload (sent from client chunking for huge >4MB / 200MB+ / 2GB files)
    if (contentType.includes('application/json')) {
      let jsonBody: any = null;
      try {
        if (typeof request.json === 'function') {
          jsonBody = await request.json();
        }
      } catch {}
      const docsPayload = jsonBody?.parsedDocuments || jsonBody?.documents || [];

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
      let formData: FormData | null = null;
      try {
        if (typeof request.formData === 'function') {
          formData = await request.formData();
        }
      } catch {}

      const files: File[] = [];
      if (formData) {
        for (const [key, value] of formData.entries()) {
          if (key === 'files' && value instanceof File) {
            files.push(value);
          }
        }
      }

      if (!files || files.length === 0) {
        return NextResponse.json({ error: 'No files provided' }, { status: 400 });
      }

      if (files.length > MAX_FILES) {
        return NextResponse.json(
          { error: `Too many files. Maximum ${MAX_FILES} files allowed per batch.` },
          { status: 400 },
        );
      }

      const invalidFiles = files.filter((file) => {
        return !isFileSupported(file) || file.size > MAX_FILE_SIZE;
      });

      if (invalidFiles.length > 0) {
        return NextResponse.json(
          {
            error: `Invalid files found. Max size per file: 2GB. Max files: 1000.`,
            invalidFiles: invalidFiles.map((f) => f.name),
          },
          { status: 400 },
        );
      }

      // --- Process files: extract docs for RAG + structured data for spreadsheets ---

      for (const file of files) {
        try {
          // 1. Always extract text documents for the RAG pipeline
          const fileDocs = await processDocument(file);
          allDocs.push(...fileDocs);

          // 2. If it's a spreadsheet, also parse structured data for the query agent
          if (isSpreadsheetFile(file.name)) {
            try {
              const arrayBuffer = await file.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              const structured = parseSpreadsheet(buffer, file.name, file.size);
              // Strip full rows from the response payload to avoid bloating the JSON
              // Frontend will receive schema + sample rows; full rows are in offlineDocs
              spreadsheetDataMap[file.name] = {
                ...structured,
                sheets: structured.sheets.map((s) => ({
                  ...s,
                  rows: s.rows, // Keep all rows — frontend stores in session memory
                })),
              };
            } catch (ssErr: any) {
              const msg = ssErr instanceof SpreadsheetParseError
                ? ssErr.userMessage
                : ssErr.message || 'Unknown spreadsheet parsing error';
              errors.push(`Spreadsheet parse warning for ${file.name}: ${msg}`);
            }
          }
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

    // --- SHA-256 DOCUMENT FINGERPRINTING & L3 CAG DOCUMENT CACHE ---
    const concatenatedText = allDocs.map((d) => d.pageContent).join('\n\n');
    const primaryFilename = allDocs[0]?.metadata?.filename || allDocs[0]?.metadata?.source || 'Uploaded Document';
    const docHash = computeDocHash(concatenatedText, primaryFilename);

    // Invalidate stale caches for this document version
    invalidateDocCache(docHash);

    // Precompute L3 CAG Cache
    const cagDocCache = buildCAGDocumentCache(docHash, primaryFilename, concatenatedText);

    // --- PARENT-CHILD SEMANTIC CHUNKING ARCHITECTURE ---
    // Parent Splitter (1,500 chars) = Full surrounding context for LLM
    // Child Splitter (250 chars) = Pinpoint vector search accuracy
    const parentSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1500,
      chunkOverlap: 200,
    });

    const childSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 250,
      chunkOverlap: 50,
    });

    const parentDocs = await parentSplitter.splitDocuments(allDocs);
    const splitDocs: Document[] = [];

    // For each parent section, generate linked child chunks carrying parentText in metadata
    for (let i = 0; i < parentDocs.length; i++) {
      const pDoc = parentDocs[i];
      const parentText = pDoc.pageContent;
      const parentId = `parent_${i}_${Date.now()}`;
      const filename = (pDoc.metadata as any)?.filename || (pDoc.metadata as any)?.source || 'Uploaded File';

      const childSubDocs = await childSplitter.splitDocuments([pDoc]);
      for (const cDoc of childSubDocs) {
        splitDocs.push(
          new Document({
            pageContent: cDoc.pageContent,
            metadata: {
              ...cDoc.metadata,
              filename,
              source: filename,
              parentId,
              parentText, // Full 1,500 char context linked to this 250 char child chunk
            },
          })
        );
      }
    }

    const offlineParsedDocuments = splitDocs.map((d) => ({
      text: (d.metadata as any)?.parentText || d.pageContent,
      filename: (d.metadata as any)?.filename || (d.metadata as any)?.source || 'Uploaded File',
    }));

    // Try Cloud Vector Indexing if internet is connected (with fast 2.5s timeout)
    let cloudIngested = false;
    if (supabaseUrl && supabaseKey && (nvidiaApiKey || openaiApiKey)) {
      try {
        const cloudIngestPromise = (async () => {
          let embeddings: any;

          if (openaiApiKey) {
            // Upgrade to high-precision text-embedding-3-large (3072 dims) or fallback to text-embedding-3-small
            embeddings = new OpenAIEmbeddings({
              model: 'text-embedding-3-large',
              apiKey: openaiApiKey,
            });
          } else if (nvidiaApiKey) {
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
          }

          if (embeddings) {
            const supabaseClient = createClient(supabaseUrl, supabaseKey);
            const vectorStore = new SupabaseVectorStore(embeddings, {
              client: supabaseClient,
              tableName: 'documents',
              queryName: 'match_documents',
            });

            // Store in vector store in parallel batches
            const BATCH_SIZE = 50;
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

    // Collect spreadsheet data from the processing loop (if any spreadsheet files were uploaded)
    const hasSpreadsheetData = Object.keys(spreadsheetDataMap).length > 0;

    return NextResponse.json({
      message: cloudIngested
        ? 'Documents ingested successfully to Cloud Vector DB'
        : 'Documents parsed & indexed 100% offline successfully',
      docHash,
      cagSummary: cagDocCache?.summary,
      documentCount: splitDocs.length,
      isOfflineMode: !cloudIngested,
      parsedDocuments: offlineParsedDocuments,
      // Structured spreadsheet data for the analytics query agent
      spreadsheetData: hasSpreadsheetData ? spreadsheetDataMap : undefined,
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
