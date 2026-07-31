// app/api/voice-assistant/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

import { performWebSearch } from '@/lib/web-search';

export async function POST(req: Request) {
  try {
    const { transcript, hasActiveDocuments, history = [] } = await req.json();

    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json({ error: 'Transcript is required' }, { status: 400 });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const queryLower = transcript.toLowerCase().replace(/[.,!?;:]/g, '').replace(/\s+/g, ' ').trim();

    // 1) Fast deterministic pattern matching for common instant actions (Sub-second execution)
    const directAction = matchDirectPattern(queryLower, hasActiveDocuments);
    if (directAction) {
      return NextResponse.json(directAction);
    }

    // 2) Check if query asks for live/real-time info (news, weather, sports, stock, prices, current events)
    let liveWebContext = '';
    const isLiveQuery =
      queryLower.includes('weather') ||
      queryLower.includes('news') ||
      queryLower.includes('stock') ||
      queryLower.includes('score') ||
      queryLower.includes('price') ||
      queryLower.includes('today') ||
      queryLower.includes('latest') ||
      queryLower.includes('current') ||
      queryLower.includes('who is') ||
      queryLower.includes('what is the price');

    if (isLiveQuery) {
      try {
        const webData = await performWebSearch(transcript);
        if (webData.summary) {
          liveWebContext = `\nREAL-TIME LIVE WEB DATA:\n${webData.summary.slice(0, 800)}\n`;
        }
      } catch (searchErr) {
        console.log('Live web search skipped:', searchErr);
      }
    }

    // 3) AI Intent Parser using GPT-4o or NVIDIA DeepSeek v4 Pro
    const systemPrompt = `You are "Insight Voice", an elite AI voice assistant modeled after Apple Siri and Google Assistant. You can automate tasks, answer any question with expert knowledge, handle multi-step requests, and carry out complex instructions.
${liveWebContext}
You MUST respond with a single valid JSON object (no markdown, no code fences, no extra text).

MODES AND JSON RESPONSE FORMATS:

1. OPEN WEBSITE / SEARCH / PLAY VIDEO:
   Triggers: User explicitly says "open", "go to", "search for", "play", "watch", "visit", "navigate to"
   User: "Open YouTube and play iPhone 16 review" or "Search Google for Next.js 14" or "Open GitHub"
   JSON: {
     "spokenResponse": "Opening YouTube and searching for iPhone 16 review.",
     "actionType": "OPEN_WEBSITE",
     "targetUrl": "https://www.youtube.com/results?search_query=iPhone+16+review",
     "searchQuery": "iPhone 16 review"
   }

2. INTERNAL APP AUTOMATION:
   Triggers: User mentions uploading, new chat, history, signing in, installing
   User: "Upload document" / "New chat" / "Open history" / "Sign in" / "Install app"
   JSON: {
     "spokenResponse": "Opening document upload file picker.",
     "actionType": "APP_ACTION",
     "appAction": "upload_document"
   }
   Valid appAction values: upload_document, new_chat, open_history, open_auth, install_app

3. DOCUMENT Q&A (If user asks about their uploaded document/PDF/resume):
   User: "Summarize my uploaded resume" or "What are the key points in the document?"
   JSON: {
     "spokenResponse": "Analyzing your document now.",
     "actionType": "DOCUMENT_QA",
     "query": "Summarize my uploaded resume"
   }

4. KNOWLEDGE ANSWER (For ANY question, doubt, theory, fact, math, coding, science, history, trivia, explanation, definition, comparison, how-to, tutorial, etc.):
   THIS IS YOUR DEFAULT MODE. If the user asks ANY question or wants information, use this mode.
   User: "What is machine learning?" / "Explain quantum physics" / "Who is the president of the US?" / "How does photosynthesis work?" / "Write a Python function to reverse a string" / "Compare React vs Vue" / "What are the side effects of ibuprofen?"
   JSON: {
     "spokenResponse": "Machine learning is a subset of artificial intelligence where computers learn patterns from data without being explicitly programmed. It uses algorithms like neural networks, decision trees, and support vector machines to make predictions and decisions.",
     "actionType": "KNOWLEDGE_ANSWER"
   }

5. MULTI-STEP / COMPLEX TASKS:
   If the user gives a multi-part instruction, break it into the MOST IMPORTANT single action and answer.
   User: "Tell me about React and then open the documentation"
   JSON: {
     "spokenResponse": "React is a JavaScript library for building user interfaces using a component-based architecture. It uses a virtual DOM for efficient rendering. Opening the React documentation now.",
     "actionType": "OPEN_WEBSITE",
     "targetUrl": "https://react.dev",
     "searchQuery": "React documentation"
   }

6. GENERAL CONVERSATION:
   User: "Hi" / "How are you?" / "Who created you?" / "What can you do?" / "Thank you" / "Good morning"
   JSON: {
     "spokenResponse": "Hi there! I'm Insight Voice, your AI assistant. I can answer any question, open apps, search the web, analyze documents, do math, write code, and much more. Just ask me anything!",
     "actionType": "GENERAL_CHAT"
   }

CRITICAL RULES:
- Output ONLY a valid JSON object. No markdown, no code fences, no explanation outside the JSON.
- For KNOWLEDGE_ANSWER: Give a REAL, DETAILED, ACCURATE, EXPERT-LEVEL answer in 2-4 sentences. You are a world-class expert. Answer directly and thoroughly. NEVER say "I don't know" or "Search Google" — always provide your best answer.
- For GENERAL_CHAT: Be warm, friendly, enthusiastic, and natural — like a smart human friend.
- For automation actions (OPEN_WEBSITE, APP_ACTION): Keep spoken responses concise (under 15 words).
- ALWAYS prefer KNOWLEDGE_ANSWER over OPEN_WEBSITE for factual questions. Only use OPEN_WEBSITE when the user EXPLICITLY asks to open/search/visit/play something.
- Use previous conversation history if provided to resolve follow-up questions (e.g. "Who is Sundar Pichai?" followed by "How old is he?").
- If unsure between modes, default to KNOWLEDGE_ANSWER.`;

    // Format recent history for LLM context (up to 4 previous messages)
    const recentHistory = Array.isArray(history)
      ? history.slice(-4).map((h: any) => ({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: typeof h.content === 'string' ? h.content : JSON.stringify(h.content),
        }))
      : [];

    const messagesPayload = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: transcript },
    ];

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
            messages: messagesPayload,
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 350,
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
            model: process.env.NVIDIA_MODEL || 'deepseek-ai/deepseek-v4-pro',
            messages: messagesPayload,
            temperature: 0.1,
            max_tokens: 500,
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

  // WhatsApp Messaging Automation (Deep Link)
  if (query.includes('whatsapp') && (query.includes('message') || query.includes('send') || query.includes('saying') || query.includes('text'))) {
    let msg = query
      .replace(/^(send\s+)?(a\s+)?(whatsapp\s+)?message\s+(on\s+whatsapp\s+)?(saying\s+)?/gi, '')
      .replace(/^open\s+whatsapp\s+(and\s+)?(send\s+)?/gi, '')
      .replace(/\s+on\s+whatsapp$/gi, '')
      .trim();
    if (!msg || msg === 'whatsapp') {
      return {
        spokenResponse: 'Opening WhatsApp Web.',
        actionType: 'OPEN_WEBSITE',
        targetUrl: 'https://web.whatsapp.com',
        searchQuery: '',
      };
    }
    const encodedMsg = encodeURIComponent(msg);
    return {
      spokenResponse: `Opening WhatsApp to send: "${msg}".`,
      actionType: 'OPEN_WEBSITE',
      targetUrl: `https://web.whatsapp.com/send?text=${encodedMsg}`,
      searchQuery: msg,
    };
  }

  // Gmail Compose Messaging Automation (Deep Link)
  if ((query.includes('gmail') || query.includes('email')) && (query.includes('send') || query.includes('compose') || query.includes('write') || query.includes('saying'))) {
    let msg = query
      .replace(/^(send\s+)?(a\s+)?(gmail|email)\s+(message\s+)?(saying\s+)?/gi, '')
      .replace(/^compose\s+(a\s+)?(gmail|email)\s+(saying\s+)?/gi, '')
      .replace(/^write\s+(a\s+)?(gmail|email)\s+(saying\s+)?/gi, '')
      .trim();
    if (!msg || msg === 'gmail' || msg === 'email') {
      return {
        spokenResponse: 'Opening Gmail compose window.',
        actionType: 'OPEN_WEBSITE',
        targetUrl: 'https://mail.google.com/mail/?view=cm&fs=1',
        searchQuery: '',
      };
    }
    const encodedMsg = encodeURIComponent(msg);
    return {
      spokenResponse: `Opening Gmail to compose message: "${msg}".`,
      actionType: 'OPEN_WEBSITE',
      targetUrl: `https://mail.google.com/mail/?view=cm&fs=1&body=${encodedMsg}`,
      searchQuery: msg,
    };
  }

  // Common Popular Websites — Check FIRST before YouTube search
  const websiteMappings: Record<string, string> = {
    youtube: 'https://www.youtube.com',
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
    whatsapp: 'https://web.whatsapp.com',
    instagram: 'https://instagram.com',
    chatgpt: 'https://chat.openai.com',
    facebook: 'https://facebook.com',
    stackoverflow: 'https://stackoverflow.com',
  };

  // Check "open <site>" commands against website mappings using regex
  for (const [key, url] of Object.entries(websiteMappings)) {
    const regex = new RegExp(`^(open|go to|launch|open up)?\\s*${key}\\s*$`, 'i');
    if (regex.test(query)) {
      return {
        spokenResponse: `Opening ${key.charAt(0).toUpperCase() + key.slice(1)}.`,
        actionType: 'OPEN_WEBSITE',
        targetUrl: url,
        searchQuery: key,
      };
    }
  }

  // YouTube search / play — ONLY if it has a search query after the youtube keyword
  if (query.includes('youtube') || query.startsWith('play ') || query.includes('watch ')) {
    let search = query
      .replace(/^open\s+youtube\s*(and\s+)?(search\s+)?(for\s+)?(play\s+)?/gi, '')
      .replace(/^search\s+(on\s+)?youtube\s+(for\s+)?/gi, '')
      .replace(/^play\s+/g, '')
      .replace(/^watch\s+/g, '')
      .replace(/\s+on\s+youtube$/gi, '')
      .replace(/\byoutube\b/gi, '')
      .trim();

    if (!search) {
      return {
        spokenResponse: 'Opening YouTube.',
        actionType: 'OPEN_WEBSITE',
        targetUrl: 'https://www.youtube.com',
        searchQuery: '',
      };
    }

    const encoded = encodeURIComponent(search);
    return {
      spokenResponse: `Searching YouTube for ${search}.`,
      actionType: 'OPEN_WEBSITE',
      targetUrl: `https://www.youtube.com/results?search_query=${encoded}`,
      searchQuery: search,
    };
  }

  // Google Search
  if (query.includes('google') || query.startsWith('search for ') || query.startsWith('search ')) {
    let search = query
      .replace(/^(open\s+)?google\s*(and\s+)?(search\s+)?(for\s+)?/gi, '')
      .replace(/^search\s+(google\s+)?(for\s+)?/gi, '')
      .trim();

    if (!search) {
      return {
        spokenResponse: 'Opening Google.',
        actionType: 'OPEN_WEBSITE',
        targetUrl: 'https://www.google.com',
        searchQuery: '',
      };
    }

    const encoded = encodeURIComponent(search);
    return {
      spokenResponse: `Searching Google for ${search}.`,
      actionType: 'OPEN_WEBSITE',
      targetUrl: `https://www.google.com/search?q=${encoded}`,
      searchQuery: search,
    };
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
 * Now defaults to KNOWLEDGE_ANSWER instead of always redirecting to Google search.
 * This makes the voice assistant act more like Siri/Alexa — answering questions directly.
 */
function generateFallbackAction(query: string, rawTranscript: string, hasActiveDocs: boolean) {
  // Explicit "open" or "go to" commands → website action
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

  // Document-related queries → DOCUMENT_QA
  if (hasActiveDocs && (query.includes('document') || query.includes('pdf') || query.includes('resume') || query.includes('summary'))) {
    return {
      spokenResponse: 'Querying your uploaded documents.',
      actionType: 'DOCUMENT_QA',
      query: rawTranscript,
    };
  }

  // Explicit search commands → Google search
  if (query.startsWith('search ') || query.startsWith('look up ') || query.startsWith('find ')) {
    const searchTerm = query.replace(/^(search|look up|find)\s+(for\s+)?/g, '').trim();
    const encoded = encodeURIComponent(searchTerm || rawTranscript);
    return {
      spokenResponse: `Searching Google for ${searchTerm || rawTranscript}.`,
      actionType: 'OPEN_WEBSITE',
      targetUrl: `https://www.google.com/search?q=${encoded}`,
      searchQuery: searchTerm || rawTranscript,
    };
  }

  // Greetings
  const greetings = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'good afternoon', 'howdy', 'whats up', 'sup'];
  if (greetings.some(g => query === g || query.startsWith(g + ' '))) {
    return {
      spokenResponse: "Hello! I'm Insight Voice, your AI assistant. Ask me anything or tell me to open an app!",
      actionType: 'GENERAL_CHAT',
    };
  }

  // DEFAULT: Treat as a knowledge question → send to chat AI for a real answer
  // This is the key improvement: instead of redirecting to Google, we let the chat AI answer.
  return {
    spokenResponse: `Let me think about that. I'll answer in the chat.`,
    actionType: 'KNOWLEDGE_ANSWER',
    query: rawTranscript,
  };
}
