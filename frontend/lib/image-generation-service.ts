import { NextResponse } from 'next/server';

export interface ImageGenOptions {
  prompt: string;
  pdfContext?: string;
  aspectRatio?: '16:9' | '1:1' | '4:3' | '9:16';
  style?: 'educational' | 'technical' | 'infographic' | 'realistic' | 'vector';
  provider?: 'auto' | 'openai' | 'replicate' | 'pollinations';
}

export interface ImageGenResult {
  success: boolean;
  imageUrl?: string;
  promptUsed: string;
  provider: string;
  groundedFacts?: string[];
  error?: string;
}

/**
 * Image Generation Service Abstraction Layer
 * Server-side service that transforms PDF facts into high-quality visual illustrations.
 * Supports OpenAI (DALL-E 3), Replicate, and Pollinations AI (free zero-config fallback).
 */
export async function generateVisualIllustration(options: ImageGenOptions): Promise<ImageGenResult> {
  const {
    prompt,
    pdfContext = '',
    aspectRatio = '16:9',
    style = 'educational',
    provider = 'auto',
  } = options;

  const openaiApiKey = process.env.OPENAI_API_KEY;
  const replicateApiKey = process.env.REPLICATE_API_KEY;
  const preferredProvider = process.env.IMAGE_GEN_PROVIDER || provider;

  // Extract grounding facts from PDF context
  const groundedFacts = extractGroundedFacts(pdfContext, prompt);

  // Construct grounded visual prompt
  const enhancedPrompt = buildGroundedVisualPrompt(prompt, groundedFacts, style, aspectRatio);

  // 1. Try OpenAI DALL-E 3 if requested or auto with API key
  if ((preferredProvider === 'openai' || preferredProvider === 'auto') && openaiApiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: enhancedPrompt.slice(0, 1000), // DALL-E 3 limit
          n: 1,
          size: aspectRatio === '16:9' ? '1792x1024' : '1024x1024',
          quality: 'standard',
          style: style === 'technical' ? 'vivid' : 'natural',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const imageUrl = data.data?.[0]?.url;
        if (imageUrl) {
          return {
            success: true,
            imageUrl,
            promptUsed: enhancedPrompt,
            provider: 'dall-e-3',
            groundedFacts,
          };
        }
      } else {
        console.log(`[IMAGE GEN] OpenAI DALL-E 3 failed (status ${res.status}), trying next provider...`);
      }
    } catch (err: any) {
      console.log(`[IMAGE GEN] OpenAI DALL-E 3 error: ${err?.message}, trying next provider...`);
    }
  }

  // 2. Try Replicate if API key is present
  if ((preferredProvider === 'replicate' || preferredProvider === 'auto') && replicateApiKey) {
    try {
      const res = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${replicateApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: 'bytedance/sdxl-lightning-4step:557905cd77024344c207b71329c0f993f41c305c26b3a3aa582f3b97b0a70f5e',
          input: {
            prompt: enhancedPrompt.slice(0, 500),
            aspect_ratio: aspectRatio === '16:9' ? '16:9' : '1:1',
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const output = data.output;
        const imageUrl = Array.isArray(output) ? output[0] : output;
        if (imageUrl) {
          return {
            success: true,
            imageUrl,
            promptUsed: enhancedPrompt,
            provider: 'replicate-sdxl',
            groundedFacts,
          };
        }
      }
    } catch (err: any) {
      console.log(`[IMAGE GEN] Replicate error: ${err?.message}`);
    }
  }

  // 3. Fallback to Pollinations AI (High-Quality, Free, Zero-Config AI Image REST API)
  try {
    const encodedPrompt = encodeURIComponent(enhancedPrompt.slice(0, 400));
    const width = aspectRatio === '16:9' ? 1280 : 1024;
    const height = aspectRatio === '16:9' ? 720 : 1024;
    const seed = Math.floor(Math.random() * 1000000);
    const pollinationsUrl = `https://pollinations.ai/p/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true`;

    return {
      success: true,
      imageUrl: pollinationsUrl,
      promptUsed: enhancedPrompt,
      provider: 'pollinations-ai',
      groundedFacts,
    };
  } catch (err: any) {
    return {
      success: false,
      promptUsed: enhancedPrompt,
      provider: 'none',
      error: `Failed to generate visual image: ${err?.message || 'Unknown error'}`,
    };
  }
}

/**
 * Extracts key grounding facts from retrieved PDF context
 */
function extractGroundedFacts(pdfContext: string, query: string): string[] {
  if (!pdfContext || pdfContext.trim().length === 0) return [];

  const lines = pdfContext.split('\n');
  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const facts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 20 || trimmed.startsWith('---')) continue;

    const lower = trimmed.toLowerCase();
    if (queryTerms.some((t) => lower.includes(t)) || facts.length < 4) {
      // Clean snippet
      const cleanFact = trimmed.replace(/^[\s•*-]+/, '').slice(0, 150);
      if (!facts.includes(cleanFact)) {
        facts.push(cleanFact);
        if (facts.length >= 5) break;
      }
    }
  }

  return facts;
}

/**
 * Builds a visual prompt grounded strictly in PDF content
 */
function buildGroundedVisualPrompt(
  userQuery: string,
  groundedFacts: string[],
  style: string,
  aspectRatio: string
): string {
  const factSummary = groundedFacts.length > 0
    ? `Key concepts from document: ${groundedFacts.slice(0, 3).join('; ')}.`
    : '';

  const styleDirections: Record<string, string> = {
    educational: 'Professional modern infographic style with high visual clarity, clean typography, soft background, sharp vectors.',
    technical: 'High-tech architectural visualization, isometric technical diagram aesthetic, vibrant blue/indigo color palette, clean grid overlay.',
    infographic: 'Clean corporate infographic visual, flat design vector art, clear visual hierarchy, elegant icons.',
    realistic: 'High resolution digital artwork, photorealistic lighting, 8k resolution, crisp detail.',
    vector: 'Minimalist flat vector graphic, vibrant colors, clean geometric shapes, high contrast.',
  };

  const selectedStyle = styleDirections[style] || styleDirections.educational;

  return `${userQuery}. ${factSummary} ${selectedStyle} High resolution, professional composition, visually stunning, no clutter, high quality visual artwork.`.trim();
}
