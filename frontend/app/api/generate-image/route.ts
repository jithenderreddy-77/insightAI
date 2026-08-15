export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { generateVisualIllustration } from '@/lib/image-generation-service';

export async function POST(req: NextRequest) {
  try {
    const { prompt, pdfContext, aspectRatio, style, provider } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const result = await generateVisualIllustration({
      prompt,
      pdfContext: pdfContext || '',
      aspectRatio: aspectRatio || '16:9',
      style: style || 'educational',
      provider: provider || 'auto',
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to generate visual image' },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Image generation route error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err?.message },
      { status: 500 }
    );
  }
}
