// app/api/voice-assistant/tts/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text, voice = 'nova' } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (!openaiApiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY is not configured' }, { status: 503 });
    }

    // Clean text of markdown symbols before sending to TTS
    const cleanedText = text
      .replace(/[#*`>\-|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanedText) {
      return NextResponse.json({ error: 'Cleaned text is empty' }, { status: 400 });
    }

    // Limit text length to ~500 chars max for fast voice response (< 1s latency)
    const truncatedText = cleanedText.length > 500 ? cleanedText.slice(0, 500) + '...' : cleanedText;

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: truncatedText,
        voice: voice, // Options: alloy, echo, fable, onyx, nova, shimmer
        speed: 1.05,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI TTS API error:', errText);
      return NextResponse.json({ error: 'OpenAI TTS synthesis failed' }, { status: response.status });
    }

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error: any) {
    console.error('TTS Route unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}
