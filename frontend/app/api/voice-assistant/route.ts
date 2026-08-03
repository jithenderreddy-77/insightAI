// app/api/voice-assistant/route.ts
// Three-Stage Intelligent Voice Architecture:
// Stage 1: Fast LLM Intent Classification & Entity Extraction
// Stage 2: Intent-Specific Processing (Tavily Web Search tool ONLY for live factual queries; Double Metaphone / Jaro-Winkler Entity Resolution for contacts)
// Stage 3: Dynamic Action Dispatch & Speech Synthesis

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { performWebSearch } from '@/lib/web-search';
import { resolveContactEntity } from '@/lib/fuzzy-entity-resolution';

export async function POST(req: Request) {
  try {
    const { transcript, hasActiveDocuments, history = [], userContacts = [] } = await req.json();

    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json({ error: 'Transcript is required' }, { status: 400 });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const queryLower = transcript.toLowerCase().replace(/[.,!?;:]/g, '').replace(/\s+/g, ' ').trim();

    // ─────────────────────────────────────────────────────────
    // STAGE 1: FAST LLM INTENT CLASSIFICATION & ENTITY EXTRACTION
    // ─────────────────────────────────────────────────────────
    const systemPrompt = `You are "Insight Voice", an ultra-intelligent, fast AI voice assistant modeled after Apple Siri & Google Assistant.
Your task is to classify the user's voice transcript and extract intent & entities into a JSON object.

JSON OUTPUT SPECIFICATION:
You MUST respond with a single valid JSON object (no markdown, no code fences, no text outside JSON).

INTENT CATEGORIES & JSON SCHEMAS:

1. CONTACT_ACTION (When user wants to message, call, text, or email a person/contact e.g. "open Thanoj's WhatsApp chat", "message Thanos saying hello", "call Tanoj", "email Alex"):
   JSON: {
     "intent": "CONTACT_ACTION",
     "contactTargetName": "Thanoj",
     "channel": "whatsapp" | "call" | "email",
     "messageText": "hello there",
     "spokenResponse": "Connecting with your contact."
   }

2. NEEDS_WEB_SEARCH (When user asks for real-time live data: weather, news, sports scores, stock prices, current events, latest updates, "what is the weather right now", "who won the match today"):
   JSON: {
     "intent": "NEEDS_WEB_SEARCH",
     "searchQuery": "current weather in London",
     "spokenResponse": "Checking the latest web search results."
   }

3. APP_ACTION (Internal app UI triggers: upload document, start new chat, view history, sign in, install app):
   JSON: {
     "intent": "APP_ACTION",
     "appAction": "upload_document" | "new_chat" | "open_history" | "open_auth" | "install_app",
     "spokenResponse": "Opening document upload picker."
   }

4. OPEN_WEBSITE (Explicit website opening e.g. "open YouTube and play lofi", "go to GitHub", "open Reddit"):
   JSON: {
     "intent": "OPEN_WEBSITE",
     "targetUrl": "https://www.youtube.com/results?search_query=lofi",
     "searchQuery": "lofi",
     "spokenResponse": "Opening YouTube for lofi."
   }

5. DOCUMENT_QA (Questions about uploaded PDF/document/resume):
   JSON: {
     "intent": "DOCUMENT_QA",
     "query": "Summarize the uploaded document",
     "spokenResponse": "Analyzing your document."
   }

6. KNOWLEDGE_ANSWER (For ANY general knowledge question, math, science, history, coding, definitions, explanations):
   JSON: {
     "intent": "KNOWLEDGE_ANSWER",
     "spokenResponse": "Provide a real, detailed, accurate 2-3 sentence answer directly here."
   }

7. GENERAL_CHAT (Greetings, small talk):
   JSON: {
     "intent": "GENERAL_CHAT",
     "spokenResponse": "Hello! I am Insight Voice, your AI assistant. How can I help you today?"
   }

RULES:
- NEVER assign NEEDS_WEB_SEARCH to contact messages or internal app actions.
- Output ONLY JSON. No markdown backticks.`;

    const recentHistory = Array.isArray(history)
      ? history.slice(-3).map((h: any) => ({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: typeof h.content === 'string' ? h.content : JSON.stringify(h.content),
        }))
      : [];

    const messagesPayload = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: transcript },
    ];

    let llmIntent: any = null;

    // Fast LLM Execution (Priority: OpenAI gpt-4o-mini / gpt-4o -> NVIDIA High-Speed Llama 3.1 8B)
    if (openaiApiKey && !llmIntent) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: messagesPayload,
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 300,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            llmIntent = JSON.parse(content);
          }
        }
      } catch (err) {
        console.error('OpenAI voice intent parser error:', err);
      }
    }

    if (nvidiaApiKey && !llmIntent) {
      try {
        const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${nvidiaApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'meta/llama-3.1-8b-instruct',
            messages: messagesPayload,
            temperature: 0.1,
            max_tokens: 350,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || '';
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            llmIntent = JSON.parse(jsonMatch[0]);
          }
        }
      } catch (err) {
        console.error('NVIDIA voice intent parser error:', err);
      }
    }

    // Fallback deterministic pattern matcher if LLM is unavailable
    if (!llmIntent) {
      llmIntent = fallbackIntentMatcher(queryLower, transcript, hasActiveDocuments);
    }

    // ─────────────────────────────────────────────────────────
    // STAGE 2: INTENT-SPECIFIC DYNAMIC EXECUTION
    // ─────────────────────────────────────────────────────────

    // PATH A: CONTACT_ACTION — Perform Phonetic + String + Recency Entity Resolution (Tavily NEVER called!)
    if (llmIntent.intent === 'CONTACT_ACTION' || llmIntent.contactTargetName) {
      const searchedName = llmIntent.contactTargetName || extractNameFromQuery(queryLower);
      const resolution = resolveContactEntity(searchedName, userContacts);

      const channel = llmIntent.channel || (queryLower.includes('whatsapp') ? 'whatsapp' : queryLower.includes('email') || queryLower.includes('gmail') ? 'email' : 'call');
      const messageText = llmIntent.messageText || extractMessageBody(queryLower);

      if (resolution.status === 'RESOLVED' && resolution.resolvedContact) {
        const contact = resolution.resolvedContact;
        const cleanPhone = contact.phone.replace(/\D/g, '');

        if (channel === 'whatsapp') {
          const encodedMsg = messageText ? encodeURIComponent(messageText) : '';
          const targetUrl = cleanPhone
            ? `https://web.whatsapp.com/send?phone=${cleanPhone}${encodedMsg ? `&text=${encodedMsg}` : ''}`
            : `https://web.whatsapp.com/send?text=${encodedMsg}`;

          return NextResponse.json({
            spokenResponse: `Opening WhatsApp for ${contact.name}${messageText ? ` to send: "${messageText}"` : ''}.`,
            actionType: 'OPEN_WEBSITE',
            targetUrl,
            resolvedContact: contact,
            confidence: resolution.confidence,
          });
        }

        if (channel === 'email') {
          const encodedMsg = messageText ? encodeURIComponent(messageText) : '';
          const targetUrl = contact.email
            ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(contact.email)}${encodedMsg ? `&body=${encodedMsg}` : ''}`
            : `https://mail.google.com/mail/?view=cm&fs=1${encodedMsg ? `&body=${encodedMsg}` : ''}`;

          return NextResponse.json({
            spokenResponse: `Opening Gmail to email ${contact.name}.`,
            actionType: 'OPEN_WEBSITE',
            targetUrl,
            resolvedContact: contact,
            confidence: resolution.confidence,
          });
        }

        // Default: Voice Phone Call
        return NextResponse.json({
          spokenResponse: `Calling ${contact.name} at ${contact.phone}.`,
          actionType: 'PHONE_CALL',
          phoneNumber: contact.phone,
          resolvedContact: contact,
          confidence: resolution.confidence,
        });
      }

      if (resolution.status === 'DISAMBIGUATE' && resolution.candidates && resolution.candidates.length > 0) {
        const topCandidateName = resolution.candidates[0].name;
        return NextResponse.json({
          spokenResponse: `Did you mean ${topCandidateName}?`,
          actionType: 'DISAMBIGUATE_CONTACT',
          searchedName,
          candidates: resolution.candidates,
          clarifyingQuestion: resolution.clarifyingQuestion || `Did you mean ${topCandidateName}?`,
          pendingChannel: channel,
          pendingMessage: messageText,
        });
      }

      // Not found — but still tell client which app to open (decoupled)
      return NextResponse.json({
        spokenResponse: `I've opened ${channel === 'whatsapp' ? 'WhatsApp' : 'your phone app'}, but I couldn't find a contact matching ${searchedName}. Could you repeat the name or say it differently?`,
        actionType: 'CONTACT_NOT_FOUND',
        searchedName,
        channel,
        appToOpen: channel === 'whatsapp' ? 'https://web.whatsapp.com' : undefined,
      });
    }

    // PATH B: NEEDS_WEB_SEARCH — Real-Time Live Lookups via Tavily Tool
    if (llmIntent.intent === 'NEEDS_WEB_SEARCH') {
      const searchQuery = llmIntent.searchQuery || transcript;
      let liveSummary = '';
      try {
        const webData = await performWebSearch(searchQuery);
        if (webData.summary) {
          liveSummary = webData.summary;
        }
      } catch (err) {
        console.error('Tavily tool error:', err);
      }

      if (liveSummary) {
        // Synthesize spoken answer using real-time Tavily search results
        const synthPrompt = `Answer the user's question concisely in 2-3 spoken sentences using this REAL-TIME LIVE WEB SEARCH DATA:
${liveSummary}
Question: ${transcript}`;

        let liveAnswer = '';
        if (openaiApiKey) {
          try {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'system', content: synthPrompt }],
                max_tokens: 200,
              }),
            });
            if (res.ok) {
              const data = await res.json();
              liveAnswer = data.choices?.[0]?.message?.content || '';
            }
          } catch {}
        }

        return NextResponse.json({
          spokenResponse: liveAnswer || liveSummary.slice(0, 250),
          actionType: 'KNOWLEDGE_ANSWER',
          liveDataUsed: true,
        });
      }
    }

    // PATH C: APP_ACTION
    if (llmIntent.intent === 'APP_ACTION') {
      return NextResponse.json({
        spokenResponse: llmIntent.spokenResponse || 'Executing app command.',
        actionType: 'APP_ACTION',
        appAction: llmIntent.appAction || 'upload_document',
      });
    }

    // PATH D: OPEN_WEBSITE
    if (llmIntent.intent === 'OPEN_WEBSITE') {
      return NextResponse.json({
        spokenResponse: llmIntent.spokenResponse || 'Opening requested page.',
        actionType: 'OPEN_WEBSITE',
        targetUrl: llmIntent.targetUrl || 'https://www.google.com',
        searchQuery: llmIntent.searchQuery || transcript,
      });
    }

    // PATH E: DOCUMENT_QA
    if (llmIntent.intent === 'DOCUMENT_QA') {
      return NextResponse.json({
        spokenResponse: 'Analyzing your uploaded documents.',
        actionType: 'DOCUMENT_QA',
        query: transcript,
      });
    }

    // DEFAULT: KNOWLEDGE_ANSWER & GENERAL_CHAT
    return NextResponse.json({
      spokenResponse: llmIntent.spokenResponse || "I'm here to help. What would you like to know or automate?",
      actionType: llmIntent.intent === 'GENERAL_CHAT' ? 'GENERAL_CHAT' : 'KNOWLEDGE_ANSWER',
      query: transcript,
    });
  } catch (error: any) {
    console.error('Voice Assistant API Route error:', error);
    return NextResponse.json(
      {
        spokenResponse: 'Sorry, I encountered an issue processing your request.',
        actionType: 'GENERAL_CHAT',
      },
      { status: 500 }
    );
  }
}

/**
 * Fallback intent matcher if LLM service is offline
 */
function fallbackIntentMatcher(query: string, transcript: string, hasDocs: boolean) {
  if (query.includes('whatsapp') || query.includes('call') || query.includes('message') || query.includes('email') || query.includes('text')) {
    return {
      intent: 'CONTACT_ACTION',
      contactTargetName: extractNameFromQuery(query),
      channel: query.includes('whatsapp') ? 'whatsapp' : query.includes('email') ? 'email' : 'call',
      messageText: extractMessageBody(query),
    };
  }

  const isLive = query.includes('weather') || query.includes('news') || query.includes('stock') || query.includes('score') || query.includes('price') || query.includes('today') || query.includes('latest');
  if (isLive) {
    return {
      intent: 'NEEDS_WEB_SEARCH',
      searchQuery: transcript,
    };
  }

  if (query.includes('upload') || query.includes('add file')) {
    return { intent: 'APP_ACTION', appAction: 'upload_document', spokenResponse: 'Opening document picker.' };
  }

  if (query.startsWith('open ') || query.startsWith('go to ')) {
    const target = query.replace(/^open /, '').replace(/^go to /, '').trim();
    return {
      intent: 'OPEN_WEBSITE',
      targetUrl: `https://www.google.com/search?q=${encodeURIComponent(target)}`,
      spokenResponse: `Opening search for ${target}.`,
    };
  }

  return {
    intent: 'KNOWLEDGE_ANSWER',
    spokenResponse: `I'll answer your question about "${transcript}" right here.`,
  };
}

function extractNameFromQuery(query: string): string {
  let name = query
    .replace(/^(open|send|call|message|text|email)\s+/i, '')
    .replace(/(whatsapp|chat|message|call)\s+/i, '')
    .replace(/\s+(on|via|using)\s+(whatsapp|gmail|email)$/i, '')
    .replace(/\s+saying.*$/i, '')
    .trim();
  return name || 'Thanoj';
}

function extractMessageBody(query: string): string {
  const match = query.match(/saying\s+(.+)$/i) || query.match(/message\s+(.+)$/i);
  return match ? match[1].trim() : '';
}
