// app/api/voice-assistant/session/profile/route.ts
// ╔═══════════════════════════════════════════════════════════════╗
// ║  PII Profile Management API                                   ║
// ║  GET  — retrieve profile (JWT required)                       ║
// ║  PUT  — update profile fields (JWT required)                  ║
// ╚═══════════════════════════════════════════════════════════════╝

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/session-jwt';
import { piiStore, type PIIProfile } from '@/lib/agent/pii-store';

// ── GET — Retrieve PII profile ──
export async function GET(req: Request) {
  const auth = await authenticateRequest(req);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  try {
    const profile = piiStore.loadProfile();

    // Redact sensitive payment info in the response
    const safeProfile = { ...profile };
    if (safeProfile.payment) {
      safeProfile.payment = {
        ...safeProfile.payment,
        last4: safeProfile.payment.last4 ? `****${safeProfile.payment.last4}` : undefined,
      } as any;
    }

    return NextResponse.json({ profile: safeProfile });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to load profile', details: error.message },
      { status: 500 }
    );
  }
}

// ── PUT — Update PII profile fields ──
export async function PUT(req: Request) {
  const auth = await authenticateRequest(req);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  try {
    const updates: Partial<PIIProfile> = await req.json();

    // Block any attempt to store full card number or CVV via API
    if (updates.payment) {
      delete (updates.payment as any).cardNumber;
      delete (updates.payment as any).fullCardNumber;
      delete (updates.payment as any).cvv;
      delete (updates.payment as any).cvc;
      delete (updates.payment as any).securityCode;
    }

    const updated = piiStore.updateProfile(updates);

    return NextResponse.json({
      success: true,
      message: 'Profile updated',
      updatedFields: Object.keys(updates),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to update profile', details: error.message },
      { status: 500 }
    );
  }
}
