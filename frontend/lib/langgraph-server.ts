import { Client } from '@langchain/langgraph-sdk';
import { LangGraphBase } from './langgraph-base';

// Server client singleton instance
let clientInstance: LangGraphBase | null = null;

/**
 * Creates or returns a singleton instance of the LangGraph client for server-side use
 * @returns LangGraph Client instance
 */
export const createServerClient = () => {
  if (clientInstance) {
    return clientInstance;
  }

  if (!process.env.NEXT_PUBLIC_LANGGRAPH_API_URL) {
    throw new Error('NEXT_PUBLIC_LANGGRAPH_API_URL is not set');
  }

  const apiUrl = process.env.NEXT_PUBLIC_LANGGRAPH_API_URL;
  const apiKey = process.env.LANGCHAIN_API_KEY;

  // Build headers — API key is optional for local development
  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    defaultHeaders['X-Api-Key'] = apiKey;
  }

  const client = new Client({
    apiUrl,
    defaultHeaders,
  });

  clientInstance = new LangGraphBase(client);
  return clientInstance;
};

// Lazy initialization to avoid crashing at import time
let _langGraphServerClient: LangGraphBase | null = null;
export const langGraphServerClient = new Proxy({} as LangGraphBase, {
  get(_target, prop, receiver) {
    if (!_langGraphServerClient) {
      _langGraphServerClient = createServerClient();
    }
    return Reflect.get(_langGraphServerClient, prop, receiver);
  },
});
