import { AgentConfiguration, IndexConfiguration } from '@/types/graphTypes';

type StreamConfigurables = AgentConfiguration;
type IndexConfigurables = IndexConfiguration;

export const retrievalAssistantStreamConfig: StreamConfigurables = {
  queryModel: 'nvidia/deepseek-ai/deepseek-v4-pro',
  retrieverProvider: 'supabase',
  k: 5,
};

/**
 * The configuration for the indexing/ingestion process.
 */
export const indexConfig: IndexConfigurables = {
  useSampleDocs: false,
  retrieverProvider: 'supabase',
};
