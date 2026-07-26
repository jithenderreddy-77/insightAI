import { VectorStoreRetriever } from '@langchain/core/vectorstores';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { createClient } from '@supabase/supabase-js';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseConfigurationAnnotation,
  ensureBaseConfiguration,
} from './configuration.js';

/**
 * Custom OpenAI-compatible embeddings that adds the extra_body
 * parameter required by NVIDIA's asymmetric embedding models.
 */
class NvidiaOpenAIEmbeddings extends OpenAIEmbeddings {
  constructor(
    opts: ConstructorParameters<typeof OpenAIEmbeddings>[0],
  ) {
    super(opts);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    // Override to pass input_type for document embedding
    const client = this['client'] as any;
    const batchSize = this['batchSize'] || 50;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await client.embeddings.create({
        model: this.model,
        input: batch,
        input_type: 'passage',
      });
      for (const item of response.data) {
        allEmbeddings.push(item.embedding);
      }
    }
    return allEmbeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    // Override to pass input_type for query embedding
    const client = this['client'] as any;
    const response = await client.embeddings.create({
      model: this.model,
      input: [text],
      input_type: 'query',
    });
    return response.data[0].embedding;
  }
}

export async function makeSupabaseRetriever(
  configuration: typeof BaseConfigurationAnnotation.State,
): Promise<VectorStoreRetriever> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables are not defined',
    );
  }

  // Use NVIDIA AI Endpoints for embeddings (OpenAI-compatible API)
  const nvidiaApiKey = process.env.NVIDIA_API_KEY;

  let embeddings: OpenAIEmbeddings;

  if (nvidiaApiKey) {
    embeddings = new NvidiaOpenAIEmbeddings({
      model: 'nvidia/nv-embedqa-e5-v5',
      apiKey: nvidiaApiKey,
      configuration: {
        baseURL: 'https://integrate.api.nvidia.com/v1',
      },
    });
  } else {
    embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-3-small',
    });
  }

  const supabaseClient = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  );
  const vectorStore = new SupabaseVectorStore(embeddings, {
    client: supabaseClient,
    tableName: 'documents',
    queryName: 'match_documents',
  });
  return vectorStore.asRetriever({
    k: configuration.k,
    filter: configuration.filterKwargs,
  });
}

export async function makeRetriever(
  config: RunnableConfig,
): Promise<VectorStoreRetriever> {
  const configuration = ensureBaseConfiguration(config);
  switch (configuration.retrieverProvider) {
    case 'supabase':
      return makeSupabaseRetriever(configuration);
    default:
      throw new Error(
        `Unsupported retriever provider: ${configuration.retrieverProvider}`,
      );
  }
}
