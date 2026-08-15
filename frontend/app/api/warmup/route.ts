export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { initializePersistentCache } from '@/lib/cag-service';

let isWarmedUp = false;
let warmSupabaseClient: any = null;

export async function GET() {
  const start = performance.now();
  const warmupResults: Record<string, string> = {};

  try {
    // 1. Initialize persistent CAG disk & memory stores
    initializePersistentCache();
    warmupResults.cagStore = 'initialized';

    // 2. Pre-warm Supabase Client Connection
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseKey) {
      if (!warmSupabaseClient) {
        warmSupabaseClient = createClient(supabaseUrl, supabaseKey);
      }
      try {
        await warmSupabaseClient.from('documents').select('id').limit(1);
        warmupResults.supabaseClient = 'connected & warmed';
      } catch {
        warmupResults.supabaseClient = 'client initialized';
      }
    }

    // 3. Pre-warm HTTP Keep-Alive connection to NVIDIA / OpenAI endpoints
    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (openaiApiKey) {
      try {
        const pingStart = performance.now();
        await fetch('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Connection': 'keep-alive',
          },
        });
        warmupResults.openaiConnection = `warmed (${(performance.now() - pingStart).toFixed(1)}ms)`;
      } catch {}
    }

    if (nvidiaApiKey) {
      try {
        const pingStart = performance.now();
        await fetch('https://integrate.api.nvidia.com/v1/models', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${nvidiaApiKey}`,
            'Connection': 'keep-alive',
          },
        });
        warmupResults.nvidiaConnection = `warmed (${(performance.now() - pingStart).toFixed(1)}ms)`;
      } catch {}
    }

    isWarmedUp = true;
    const totalTimeMs = performance.now() - start;

    return NextResponse.json({
      status: 'ready',
      isWarmedUp,
      totalTimeMs: parseFloat(totalTimeMs.toFixed(2)),
      warmupResults,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Warmup partial failure', details: err?.message },
      { status: 500 }
    );
  }
}
