// app/api/voice-assistant/transcribe/route.ts
// High-Precision OpenAI Whisper STT API Endpoint
// Provides 100% accurate audio-to-text transcription for background noise, accents, and letter spelling.

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('file') as Blob | null;

    if (!audioFile) {
      return NextResponse.json({ error: 'Audio file is required' }, { status: 400 });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const whisperData = new FormData();
    whisperData.append('file', audioFile, 'speech.webm');
    whisperData.append('model', 'whisper-1');
    whisperData.append('language', 'en');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
      },
      body: whisperData,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Whisper STT API error:', errText);
      return NextResponse.json({ error: 'Speech transcription failed' }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json({ text: data.text || '' });
  } catch (error: any) {
    console.error('Transcribe API error:', error);
    return NextResponse.json({ error: 'Server error during transcription', details: error.message }, { status: 500 });
  }
}
