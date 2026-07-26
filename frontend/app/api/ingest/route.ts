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

// Configuration constants
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_FILES = 10;

/**
 * Check if a file is supported by MIME type or extension
 */
function isFileSupported(file: File): boolean {
  if (SUPPORTED_MIME_TYPES.includes(file.type)) {
    return true;
  }
  const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(extension);
}

// No custom embeddings class needed — OpenAIEmbeddings works with NVIDIA's OpenAI-compatible API

export async function POST(request: NextRequest) {
  try {
    // Validate env vars
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured' },
        { status: 500 },
      );
    }

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

    // Validate file types and sizes
    const invalidFiles = files.filter((file) => {
      return !isFileSupported(file) || file.size > MAX_FILE_SIZE;
    });

    if (invalidFiles.length > 0) {
      const invalidNames = invalidFiles.map((f) => f.name).join(', ');
      return NextResponse.json(
        {
          error: `Unsupported or oversized files: ${invalidNames}. Supported formats: PDF, DOC, DOCX, PPT, PPTX, TXT, CSV, XLSX, XLS, PNG, JPG, WEBP, GIF, SVG (max 50MB each).`,
        },
        { status: 400 },
      );
    }

    // Process all files into Documents
    const allDocs: Document[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        const docs = await processDocument(file);
        allDocs.push(...docs);
      } catch (error: any) {
        console.error(`Error processing file ${file.name}:`, error);
        errors.push(`${file.name}: ${error.message}`);
      }
    }

    if (!allDocs.length) {
      return NextResponse.json(
        {
          error: 'No valid documents extracted from uploaded files',
          details: errors.length > 0 ? errors : undefined,
        },
        { status: 400 },
      );
    }

    // Split documents into chunks (max 500 characters to fit embedding token limits)
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 80,
    });
    const splitDocs = await splitter.splitDocuments(allDocs);

    // Create embeddings
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    let embeddings: any;

    if (nvidiaApiKey) {
      // Custom NVIDIA embeddings using raw fetch (requires input_type)
      embeddings = {
        embedDocuments: async (texts: string[]): Promise<number[][]> => {
          const allEmbeddings: number[][] = [];
          // Process in batches of 50
          for (let i = 0; i < texts.length; i += 50) {
            const batch = texts.slice(i, i + 50);
            const res = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
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
            });
            if (!res.ok) {
              const err = await res.text();
              throw new Error(`NVIDIA embeddings failed: ${err}`);
            }
            const data = await res.json();
            for (const item of data.data) {
              allEmbeddings.push(item.embedding);
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
          if (!res.ok) {
            const err = await res.text();
            throw new Error(`NVIDIA embeddings failed: ${err}`);
          }
          const data = await res.json();
          return data.data[0].embedding;
        },
      };
    } else if (openaiApiKey) {
      embeddings = new OpenAIEmbeddings({
        model: 'text-embedding-3-small',
        apiKey: openaiApiKey,
      });
    } else {
      return NextResponse.json(
        { error: 'No embedding API key configured (NVIDIA_API_KEY or OPENAI_API_KEY required)' },
        { status: 500 },
      );
    }

    // Store in Supabase
    const supabaseClient = createClient(supabaseUrl, supabaseKey);
    const vectorStore = new SupabaseVectorStore(embeddings, {
      client: supabaseClient,
      tableName: 'documents',
      queryName: 'match_documents',
    });

    // Insert in small batches to avoid timeouts on large PDFs
    const BATCH_SIZE = 10;
    for (let i = 0; i < splitDocs.length; i += BATCH_SIZE) {
      const batch = splitDocs.slice(i, i + BATCH_SIZE);
      await vectorStore.addDocuments(batch);
    }

    return NextResponse.json({
      message: 'Documents ingested successfully',
      documentCount: splitDocs.length,
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
