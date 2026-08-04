// frontend/lib/brain/tools/website-tool.ts
// Opens websites and URLs in the browser

import { z } from 'zod';
import { type ToolDefinition, type ToolResult, type ToolContext } from '../tool-registry';

const parameterSchema = z.object({
  url: z.string().describe('Full URL to open, or a website name to search'),
  searchQuery: z.string().optional().describe('Optional search query for the website'),
});

type Params = z.infer<typeof parameterSchema>;

/** Map common site names to their URLs with optional search patterns */
const SITE_MAP: Record<string, { base: string; search?: string }> = {
  youtube: { base: 'https://www.youtube.com', search: 'https://www.youtube.com/results?search_query=' },
  google: { base: 'https://www.google.com', search: 'https://www.google.com/search?q=' },
  github: { base: 'https://github.com', search: 'https://github.com/search?q=' },
  reddit: { base: 'https://www.reddit.com', search: 'https://www.reddit.com/search/?q=' },
  twitter: { base: 'https://twitter.com', search: 'https://twitter.com/search?q=' },
  x: { base: 'https://x.com', search: 'https://x.com/search?q=' },
  linkedin: { base: 'https://www.linkedin.com', search: 'https://www.linkedin.com/search/results/all/?keywords=' },
  stackoverflow: { base: 'https://stackoverflow.com', search: 'https://stackoverflow.com/search?q=' },
  spotify: { base: 'https://open.spotify.com', search: 'https://open.spotify.com/search/' },
  netflix: { base: 'https://www.netflix.com' },
  amazon: { base: 'https://www.amazon.com', search: 'https://www.amazon.com/s?k=' },
  gmail: { base: 'https://mail.google.com' },
  maps: { base: 'https://maps.google.com', search: 'https://maps.google.com/maps?q=' },
  drive: { base: 'https://drive.google.com' },
  notion: { base: 'https://www.notion.so' },
  figma: { base: 'https://www.figma.com' },
  chatgpt: { base: 'https://chat.openai.com' },
  claude: { base: 'https://claude.ai' },
  whatsapp: { base: 'https://web.whatsapp.com' },
  instagram: { base: 'https://www.instagram.com' },
  facebook: { base: 'https://www.facebook.com' },
};

function resolveUrl(rawUrl: string, searchQuery?: string): string {
  // Check if it's already a full URL
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    return rawUrl;
  }

  // Check site map
  const siteName = rawUrl.toLowerCase().replace(/[^a-z0-9]/g, '');
  const site = SITE_MAP[siteName];

  if (site) {
    if (searchQuery && site.search) {
      return `${site.search}${encodeURIComponent(searchQuery)}`;
    }
    return site.base;
  }

  // Fallback: Google search
  return `https://www.google.com/search?q=${encodeURIComponent(rawUrl + (searchQuery ? ' ' + searchQuery : ''))}`;
}

async function execute(params: Params, _context: ToolContext): Promise<ToolResult> {
  const { url, searchQuery } = params;
  const resolvedUrl = resolveUrl(url, searchQuery);

  return {
    success: true,
    data: {
      url: resolvedUrl,
      originalRequest: url,
      searchQuery,
    },
    clientAction: {
      type: 'OPEN_URL',
      payload: {
        url: resolvedUrl,
        description: searchQuery ? `${url} — searching "${searchQuery}"` : url,
      },
    },
  };
}

export const websiteTool: ToolDefinition<Params> = {
  name: 'open_website',
  description:
    'Open a website or URL in the browser. Knows common sites by name (YouTube, GitHub, Reddit, Gmail, Google Maps, Spotify, etc.). Can also search within a site (e.g. "open YouTube and search for lofi hip hop").',
  parameterDescriptions: {
    url: 'Website name or full URL (e.g. "YouTube", "https://github.com/user/repo")',
    searchQuery: '(Optional) Search query to perform on the website (e.g. "lofi hip hop")',
  },
  parameterSchema,
  execute,
};
