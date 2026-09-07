// app/api/voice-assistant/session/route.ts
// ╔═══════════════════════════════════════════════════════════════╗
// ║  SSE Persistent Session Endpoint                              ║
// ║  GET /api/voice-assistant/session?sessionId=xxx               ║
// ║  Authorization: Bearer <jwt>                                  ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Opens a long-lived Server-Sent Events stream for a session.
// The client receives real-time events: action progress, HITL prompts,
// safety gate confirmations, task completion signals, and error reports.
//
// Also exposes POST for session creation (returns JWT + sessionId).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { generateSessionToken, authenticateRequest } from '@/lib/auth/session-jwt';
import { sessionStateManager } from '@/lib/agent/session-state';

// ─────────────────────────────────────────────────────────
// GET — Open SSE Stream
// ─────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // 1. Authenticate — try Authorization header first, then ?token= query param (EventSource compat)
  let auth = await authenticateRequest(req);

  if (!auth.valid) {
    // EventSource can't send headers, so accept token as query param
    const url = new URL(req.url);
    const queryToken = url.searchParams.get('token');
    if (queryToken) {
      const { verifySessionToken } = await import('@/lib/auth/session-jwt');
      auth = await verifySessionToken(queryToken);
    }
  }

  if (!auth.valid || !auth.sessionId) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }

  const sessionId = auth.sessionId;

  // 2. Get or create session
  const session = sessionStateManager.getOrCreateSession(sessionId);

  // 3. Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      // Register the SSE controller so other parts of the system can push events
      sessionStateManager.setSSEController(sessionId, controller);

      // Send initial session:started event
      const startEvent = {
        type: 'session:started',
        data: {
          sessionId,
          currentUrl: session.currentUrl,
          currentPageTitle: session.currentPageTitle,
          commandHistoryLength: session.commandHistory.length,
          activeSessions: sessionStateManager.getActiveSessionCount(),
        },
        timestamp: Date.now(),
      };

      const payload = `event: session:started\ndata: ${JSON.stringify(startEvent)}\n\n`;
      controller.enqueue(new TextEncoder().encode(payload));

      // Send keepalive every 25 seconds to prevent connection timeout
      const keepaliveInterval = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));
        } catch {
          // Controller closed, clean up
          clearInterval(keepaliveInterval);
        }
      }, 25000);

      // Cleanup on abort (client disconnect)
      req.signal.addEventListener('abort', () => {
        clearInterval(keepaliveInterval);
        try {
          controller.close();
        } catch {}
      });
    },

    cancel() {
      // Client disconnected — don't destroy session, just detach SSE controller
      const s = sessionStateManager.getSession(sessionId);
      if (s) {
        s.sseController = undefined;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

// ─────────────────────────────────────────────────────────
// POST — Create New Session (returns JWT)
// ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    // Generate a new sessionId
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Create the session
    sessionStateManager.getOrCreateSession(sessionId);

    // Generate JWT for this session
    const token = await generateSessionToken(sessionId);

    return NextResponse.json({
      sessionId,
      token,
      expiresIn: 1800, // 30 minutes
      endpoints: {
        sse: `/api/voice-assistant/session?sessionId=${sessionId}`,
        command: `/api/voice-assistant/session/command`,
        profile: `/api/voice-assistant/session/profile`,
      },
    });
  } catch (error: any) {
    console.error('Session creation error:', error);
    return NextResponse.json(
      { error: 'Failed to create session', details: error.message },
      { status: 500 }
    );
  }
}
