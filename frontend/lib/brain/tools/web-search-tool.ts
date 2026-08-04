// frontend/lib/brain/tools/web-search-tool.ts
// Wraps Tavily + DuckDuckGo web search for real-time live data

import { z } from 'zod';
import { type ToolDefinition, type ToolResult, type ToolContext } from '../tool-registry';
import { performWebSearch } from '@/lib/web-search';

const parameterSchema = z.object({
  query: z.string().describe('The search query to look up on the web'),
});

type Params = z.infer<typeof parameterSchema>;

async function execute(params: Params, context: ToolContext): Promise<ToolResult> {
  const { query } = params;

  try {
    const webData = await performWebSearch(query);

    if (webData.summary) {
      return {
        success: true,
        data: {
          summary: webData.summary,
          results: webData.results.slice(0, 3),
          query,
        },
      };
    }

    return {
      success: true,
      data: {
        summary: '',
        results: [],
        query,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Web search failed: ${err.message}`,
    };
  }
}

export const webSearchTool: ToolDefinition<Params> = {
  name: 'web_search',
  description:
    'Search the web for real-time live data: weather, news, sports scores, stock prices, current events, latest updates. Use ONLY when the user asks for information that changes frequently or requires up-to-date data.',
  parameterDescriptions: {
    query: 'The search query (e.g. "weather in Hyderabad today", "latest SpaceX launch")',
  },
  parameterSchema,
  execute,
};
