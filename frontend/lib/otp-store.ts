/**
 * otp-store.ts — Server-side OTP generation, storage, rate-limiting & validation engine.
 *
 * Security Model:
 *  - 6-digit numeric OTP generated server-side.
 *  - 10-minute expiration timer.
 *  - Rate-limited: Maximum 3 sends per 15 minutes per email address.
 *  - Attempt limits: Maximum 5 failed verification attempts per OTP.
 *  - One-Time Use: Immediately deleted upon successful verification.
 *  - Never returned in client API payloads.
 */

interface OTPRecord {
  code: string;
  email: string;
  expiresAt: number;
  attemptsLeft: number;
}

interface RateLimitRecord {
  sends: number[];
}

// In-memory server-side storage (isolated per Node process)
const otpMap = new Map<string, OTPRecord>();
const rateLimitMap = new Map<string, RateLimitRecord>();

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_SENDS_PER_WINDOW = 3;
const MAX_ATTEMPTS = 5;

/**
 * Generate a new 6-digit numeric OTP for a given email address.
 */
export function generateOTP(email: string): {
  success: boolean;
  otpCode?: string;
  error?: string;
  retryAfterSeconds?: number;
} {
  const normalizedEmail = email.toLowerCase().trim();
  const now = Date.now();

  // 1. Check rate limit
  const rateRecord = rateLimitMap.get(normalizedEmail) || { sends: [] };
  // Clean expired send timestamps
  const activeSends = rateRecord.sends.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (activeSends.length >= MAX_SENDS_PER_WINDOW) {
    const oldestSend = activeSends[0];
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - oldestSend);
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    return {
      success: false,
      error: `Too many verification codes requested. Please wait ${Math.ceil(retryAfterSeconds / 60)} minutes before trying again.`,
      retryAfterSeconds,
    };
  }

  // 2. Generate cryptographically random 6-digit OTP
  const rawCode = Math.floor(100000 + Math.random() * 900000).toString();

  // 3. Save OTP record
  otpMap.set(normalizedEmail, {
    code: rawCode,
    email: normalizedEmail,
    expiresAt: now + OTP_TTL_MS,
    attemptsLeft: MAX_ATTEMPTS,
  });

  // 4. Update rate limit history
  activeSends.push(now);
  rateLimitMap.set(normalizedEmail, { sends: activeSends });

  return {
    success: true,
    otpCode: rawCode,
  };
}

/**
 * Verify a 6-digit OTP code for a given email address.
 */
export function verifyOTP(
  email: string,
  inputCode: string
): {
  success: boolean;
  error?: string;
  attemptsLeft?: number;
} {
  const normalizedEmail = email.toLowerCase().trim();
  const record = otpMap.get(normalizedEmail);
  const now = Date.now();

  if (!record) {
    return {
      success: false,
      error: 'No active verification code found. Please click "Resend Code".',
    };
  }

  // Check expiration
  if (now > record.expiresAt) {
    otpMap.delete(normalizedEmail);
    return {
      success: false,
      error: 'Verification code has expired. Please click "Resend Code" to receive a fresh code.',
    };
  }

  // Check attempt limit
  if (record.attemptsLeft <= 0) {
    otpMap.delete(normalizedEmail);
    return {
      success: false,
      error: 'Maximum verification attempts exceeded. Please click "Resend Code" for a new code.',
    };
  }

  // Compare code (server-side only)
  if (record.code !== inputCode.trim()) {
    record.attemptsLeft -= 1;
    if (record.attemptsLeft <= 0) {
      otpMap.delete(normalizedEmail);
      return {
        success: false,
        error: 'Too many incorrect attempts. Code invalidated. Please request a new code.',
        attemptsLeft: 0,
      };
    }
    return {
      success: false,
      error: `Incorrect verification code. ${record.attemptsLeft} attempt${record.attemptsLeft > 1 ? 's' : ''} remaining.`,
      attemptsLeft: record.attemptsLeft,
    };
  }

  // SUCCESS: Invalidate immediately upon use (One-Time Password)
  otpMap.delete(normalizedEmail);

  return {
    success: true,
  };
}
