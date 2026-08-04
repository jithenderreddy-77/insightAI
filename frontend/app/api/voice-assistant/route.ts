// app/api/voice-assistant/route.ts
// ╔═══════════════════════════════════════════════════════════════╗
// ║  INSIGHT BRAIN — Autonomous AI Voice Operating System        ║
// ║  Single entry point → Brain Orchestrator → Tool Execution    ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Architecture:
//   Voice Input → STT → Brain.orchestrate() → Tool Registry → Response
//
// The Brain uses ReAct reasoning (Reason → Act → Observe) to decide
// which tool to use, execute it, and synthesize a natural response.
// All the old if/else intent routing is now handled by the LLM.

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { orchestrate, type BrainInput } from '@/lib/brain/brain-orchestrator';

export async function POST(req: Request) {
  try {
    const { transcript, hasActiveDocuments, history = [], userContacts = [] } = await req.json();

    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json({ error: 'Transcript is required' }, { status: 400 });
    }

    // Build Brain input
    const brainInput: BrainInput = {
      transcript,
      hasActiveDocuments: !!hasActiveDocuments,
      history: Array.isArray(history) ? history : [],
      userContacts: Array.isArray(userContacts) ? userContacts : [],
      userName: 'friend', // Will be overridden by client-sent userName in future
    };

    // ── ORCHESTRATE ──
    // The Brain reasons about the request, selects a tool (if needed),
    // executes it, and returns a structured response.
    const result = await orchestrate(brainInput);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Voice Assistant Brain error:', error);
    return NextResponse.json(
      {
        spokenResponse: 'Sorry, I encountered an issue. Please try again.',
        actionType: 'GENERAL_CHAT',
      },
      { status: 500 },
    );
  }
}
