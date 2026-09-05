// app/api/voice-assistant/session/command/route.ts
// ╔═══════════════════════════════════════════════════════════════╗
// ║  Session Command Endpoint                                     ║
// ║  POST /api/voice-assistant/session/command                    ║
// ║  Authorization: Bearer <jwt>                                  ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Accepts two types of messages into an active session:
//   1. voice_command — a new user command to execute
//   2. hitl_answer  — resolves a pending HITL prompt
//
// All commands are logged to session history for context continuity.

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/session-jwt';
import { sessionStateManager } from '@/lib/agent/session-state';

interface CommandBody {
  sessionId: string;
  command?: string;
  type: 'voice_command' | 'hitl_answer';
  questionId?: string;
  answer?: string;
}

export async function POST(req: Request) {
  // 1. Authenticate
  const auth = await authenticateRequest(req);
  if (!auth.valid || !auth.sessionId) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const body: CommandBody = await req.json();

    // Validate sessionId matches the JWT
    if (body.sessionId !== auth.sessionId) {
      return NextResponse.json(
        { error: 'Session ID mismatch between JWT and request body' },
        { status: 403 }
      );
    }

    const session = sessionStateManager.getSession(body.sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found or expired' },
        { status: 404 }
      );
    }

    // ── HITL ANSWER ──
    if (body.type === 'hitl_answer') {
      if (!body.questionId || !body.answer) {
        return NextResponse.json(
          { error: 'hitl_answer requires questionId and answer' },
          { status: 400 }
        );
      }

      const resolved = sessionStateManager.resolveHITL(
        body.sessionId,
        body.questionId,
        body.answer
      );

      if (!resolved) {
        return NextResponse.json(
          { error: 'No pending HITL prompt found for this questionId' },
          { status: 404 }
        );
      }

      // Log the HITL answer (redact sensitive values)
      const isSensitive = body.questionId.includes('card') ||
                          body.questionId.includes('cvv') ||
                          body.questionId.includes('otp') ||
                          body.questionId.includes('password');
      const logValue = isSensitive ? '***REDACTED***' : body.answer;

      sessionStateManager.emitEvent(body.sessionId, 'action:log', {
        message: `User answered HITL prompt: ${body.questionId} = ${logValue}`,
      });

      return NextResponse.json({
        success: true,
        message: 'HITL prompt resolved',
        questionId: body.questionId,
      });
    }

    // ── VOICE COMMAND ──
    if (body.type === 'voice_command') {
      if (!body.command || typeof body.command !== 'string' || body.command.trim().length < 1) {
        return NextResponse.json(
          { error: 'voice_command requires a non-empty command string' },
          { status: 400 }
        );
      }

      const command = body.command.trim();

      // Push command to session history
      sessionStateManager.pushCommand(body.sessionId, command);

      // Log the command via SSE
      sessionStateManager.emitEvent(body.sessionId, 'action:log', {
        message: `Received command: "${command}"`,
        commandIndex: session.commandHistory.length,
      });

      // TODO: Component 2+3 will wire this to intentRouter → agentCore / inPageActionExecutor
      // For now, acknowledge receipt and emit action:executing
      sessionStateManager.emitEvent(body.sessionId, 'action:executing', {
        command,
        message: `Processing: "${command}"`,
      });

      // Placeholder response — will be replaced by real orchestrator pipeline
      return NextResponse.json({
        success: true,
        message: `Command queued: "${command}"`,
        sessionId: body.sessionId,
        commandIndex: session.commandHistory.length,
      });
    }

    return NextResponse.json(
      { error: 'Invalid type. Must be "voice_command" or "hitl_answer"' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Session command error:', error);
    return NextResponse.json(
      { error: 'Failed to process command', details: error.message },
      { status: 500 }
    );
  }
}
