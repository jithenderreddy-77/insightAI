// app/api/auth/verify-otp/route.ts
// Server-side OTP verification endpoint — compares user input code against stored OTP and marks account as verified.

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { verifyOTP } from '@/lib/otp-store';

export async function POST(req: Request) {
  try {
    const { email, otpCode } = await req.json();

    if (!email || !otpCode) {
      return NextResponse.json({ success: false, error: 'Email and verification code are required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Verify OTP server-side
    const result = verifyOTP(normalizedEmail, String(otpCode).trim());

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error || 'Verification failed',
        attemptsLeft: result.attemptsLeft,
      });
    }

    // 2. SUCCESS: Return verified flag
    return NextResponse.json({
      success: true,
      verified: true,
      message: 'Account verified successfully',
    });
  } catch (error: any) {
    console.error('Verify OTP route error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
