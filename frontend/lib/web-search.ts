// lib/web-search.ts
// Utility for real-time web knowledge retrieval using Tavily Search API with DuckDuckGo fallback

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
}

export async function performWebSearch(query: string): Promise<{ results: WebSearchResult[]; summary: string }> {
  const tavilyApiKey = process.env.TAVILY_API_KEY;

  if (tavilyApiKey) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query: query,
          search_depth: 'basic',
          include_answer: true,
          max_results: 3,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const results: WebSearchResult[] = (data.results || []).map((r: any) => ({
          title: r.title || 'Web Search Result',
          url: r.url || '',
          content: r.content || r.snippet || '',
        }));

        const answer = data.answer || results.map((r) => r.content).join('\n\n');
        return { results, summary: answer };
      }
    } catch (err) {
      console.error('Tavily search error:', err);
    }
  }

  // Fallback: DuckDuckGo Instant Answer API (Free, zero config)
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`);
    if (res.ok) {
      const data = await res.json();
      const abstract = data.AbstractText || data.Definition || '';
      const related = (data.RelatedTopics || [])
        .map((t: any) => t.Text)
        .filter(Boolean)
        .slice(0, 3)
        .join('. ');

      const combinedText = [abstract, related].filter(Boolean).join('\n\n');
      if (combinedText.trim()) {
        return {
          results: [{ title: data.Heading || query, url: data.AbstractURL || '', content: combinedText }],
          summary: combinedText,
        };
      }
    }
  } catch (err) {
    console.error('DuckDuckGo fallback search error:', err);
  }

  return { results: [], summary: '' };
}
