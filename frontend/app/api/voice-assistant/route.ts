// app/api/voice-assistant/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { transcript, hasActiveDocuments } = await req.json();

    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json({ error: 'Transcript is required' }, { status: 400 });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const queryLower = transcript.toLowerCase().trim();

    // 1) Fast deterministic pattern matching for common instant actions (Sub-second execution)
    const directAction = matchDirectPattern(queryLower, hasActiveDocuments);
    if (directAction) {
      return NextResponse.json(directAction);
    }

    // 2) AI Intent Parser using GPT-4o or NVIDIA API with Tool Calling
    const systemPrompt = `You are "Insight Voice", an ultra-fast Siri/Alexa-style voice assistant automation engine.
Analyze the user's spoken voice command and return a JSON object indicating the action to perform and a friendly spoken response (1-2 short sentences max).

MODES AND JSON RESPONSES:

1. OPEN WEBSITE OR YOUTUBE VIDEO:
   User: "Open YouTube and play iPhone 16 review" or "Search Google for Next.js 14" or "Open GitHub"
   JSON: {
     "spokenResponse": "Opening YouTube and searching for iPhone 16 review.",
     "actionType": "OPEN_WEBSITE",
     "targetUrl": "https://www.youtube.com/results?search_query=iPhone+16+review",
     "searchQuery": "iPhone 16 review"
   }

2. INTERNAL APP AUTOMATION:
   User: "Upload document" / "New chat" / "Open history" / "Sign in" / "Install app"
   JSON: {
     "spokenResponse": "Opening document upload file picker.",
     "actionType": "APP_ACTION",
     "appAction": "upload_document" // Options: upload_document, new_chat, open_history, open_auth, install_app
   }

3. DOCUMENT Q&A (If user asks about their document/PDF/resume):
   User: "Summarize my uploaded resume" or "What are the key points in the document?"
   JSON: {
     "spokenResponse": "Checking your uploaded document now.",
     "actionType": "DOCUMENT_QA",
     "query": "Summarize my uploaded resume"
   }

4. GENERAL CONVERSATION OR ASSISTANT CHAT:
   User: "Who created you?" / "What can you do?" / "What is the capital of France?"
   JSON: {
     "spokenResponse": "I am Insight Voice, your AI automation assistant. I can open websites, search YouTube, trigger app actions, and analyze your PDFs.",
     "actionType": "GENERAL_CHAT"
   }

CRITICAL RULES:
- Output ONLY a valid JSON object matching one of the 4 formats above. Do NOT include markdown code fences or extra text.
- Spoken responses MUST be concise, clear, and natural (15 words max) so Text-to-Speech reads it aloud instantly.`;

    if (openaiApiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: transcript },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 300,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content);
            return NextResponse.json(parsed);
          }
        }
      } catch (err) {
        console.error('OpenAI voice intent parser error:', err);
      }
    }

    if (nvidiaApiKey) {
      try {
        const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${nvidiaApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'meta/llama-3.1-8b-instruct',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: transcript },
            ],
            temperature: 0.1,
            max_tokens: 300,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || '';
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return NextResponse.json(parsed);
          }
        }
      } catch (err) {
        console.error('NVIDIA voice intent parser error:', err);
      }
    }

    // Fallback intelligent parser
    const fallback = generateFallbackAction(queryLower, transcript, hasActiveDocuments);
    return NextResponse.json(fallback);
  } catch (error: any) {
    console.error('Voice Assistant API Route error:', error);
    return NextResponse.json(
      {
        spokenResponse: 'Sorry, I encountered an issue processing that command.',
        actionType: 'GENERAL_CHAT',
      },
      { status: 500 }
    );
  }
}

/**
 * Fast Sub-Second Pattern Matcher for direct commands
 */
function matchDirectPattern(query: string, hasActiveDocs: boolean) {
  // App Actions
  if (query.includes('upload') || query.includes('add file') || query.includes('add pdf') || query.includes('select document')) {
    return {
      spokenResponse: 'Opening document upload picker.',
      actionType: 'APP_ACTION',
      appAction: 'upload_document',
    };
  }
  if (query.includes('new chat') || query.includes('start chat') || query.includes('clear chat') || query.includes('reset session')) {
    return {
      spokenResponse: 'Starting a new chat session.',
      actionType: 'APP_ACTION',
      appAction: 'new_chat',
    };
  }
  if (query.includes('history') || query.includes('past chat') || query.includes('saved chat')) {
    return {
      spokenResponse: 'Opening your chat and file history.',
      actionType: 'APP_ACTION',
      appAction: 'open_history',
    };
  }
  if (query.includes('sign in') || query.includes('login') || query.includes('register') || query.includes('create account')) {
    return {
      spokenResponse: 'Opening sign in window.',
      actionType: 'APP_ACTION',
      appAction: 'open_auth',
    };
  }
  if (query.includes('install app') || query.includes('download app')) {
    return {
      spokenResponse: 'Launching app installer.',
      actionType: 'APP_ACTION',
      appAction: 'install_app',
    };
  }

  // YouTube search / play
  if (query.includes('youtube') || query.startsWith('play ') || query.includes('watch ')) {
    let search = query
      .replace(/open youtube (and )?/g, '')
      .replace(/search (on )?youtube (for )?/g, '')
      .replace(/^play /g, '')
      .replace(/^watch /g, '')
      .trim();

    if (!search || search === 'youtube') {
      return {
        spokenResponse: 'Opening YouTube.',
        actionType: 'OPEN_WEBSITE',
        targetUrl: 'https://www.youtube.com',
        searchQuery: '',
      };
    }

    const encoded = encodeURIComponent(search);
    return {
      spokenResponse: `Opening YouTube search for ${search}.`,
      actionType: 'OPEN_WEBSITE',
      targetUrl: `https://www.youtube.com/results?search_query=${encoded}`,
      searchQuery: search,
    };
  }

  // Google Search
  if (query.includes('google') || query.startsWith('search for ')) {
    const search = query.replace(/^search (google )?(for )?/g, '').replace(/^google /g, '').trim();
    const encoded = encodeURIComponent(search || 'Insight AI');
    return {
      spokenResponse: `Searching Google for ${search || 'Insight AI'}.`,
      actionType: 'OPEN_WEBSITE',
      targetUrl: `https://www.google.com/search?q=${encoded}`,
      searchQuery: search,
    };
  }

  // Common Popular Websites
  const websiteMappings: Record<string, string> = {
    github: 'https://github.com',
    twitter: 'https://x.com',
    x: 'https://x.com',
    wikipedia: 'https://wikipedia.org',
    linkedin: 'https://linkedin.com',
    reddit: 'https://reddit.com',
    amazon: 'https://amazon.com',
    netflix: 'https://netflix.com',
    spotify: 'https://open.spotify.com',
    gmail: 'https://mail.google.com',
  };

  for (const [key, url] of Object.entries(websiteMappings)) {
    if (query.includes(`open ${key}`) || query === key || query === `go to ${key}`) {
      return {
        spokenResponse: `Opening ${key.toUpperCase()}.`,
        actionType: 'OPEN_WEBSITE',
        targetUrl: url,
        searchQuery: key,
      };
    }
  }

  // Document Q&A trigger
  if (hasActiveDocs && (query.includes('resume') || query.includes('pdf') || query.includes('document') || query.includes('summary') || query.includes('candidate'))) {
    return {
      spokenResponse: 'Analyzing your uploaded document now.',
      actionType: 'DOCUMENT_QA',
      query,
    };
  }

  return null;
}

/**
 * Intelligent Fallback Action Generator
 */
function generateFallbackAction(query: string, rawTranscript: string, hasActiveDocs: boolean) {
  if (query.startsWith('open ') || query.startsWith('go to ')) {
    const target = query.replace(/^open /g, '').replace(/^go to /g, '').trim();
    if (target.includes('.') && !target.includes(' ')) {
      const url = target.startsWith('http') ? target : `https://${target}`;
      return {
        spokenResponse: `Opening ${target}.`,
        actionType: 'OPEN_WEBSITE',
        targetUrl: url,
        searchQuery: target,
      };
    }
    const encoded = encodeURIComponent(target);
    return {
      spokenResponse: `Searching for ${target}.`,
      actionType: 'OPEN_WEBSITE',
      targetUrl: `https://www.google.com/search?q=${encoded}`,
      searchQuery: target,
    };
  }

  if (hasActiveDocs) {
    return {
      spokenResponse: 'Querying your uploaded documents.',
      actionType: 'DOCUMENT_QA',
      query: rawTranscript,
    };
  }

  return {
    spokenResponse: `I heard: "${rawTranscript}". You can ask me to open websites, search YouTube, upload documents, or answer queries!`,
    actionType: 'GENERAL_CHAT',
  };
}
