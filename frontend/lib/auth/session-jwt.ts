// frontend/lib/auth/session-jwt.ts
// JWT Authentication for SSE Session Endpoints
// Uses 'jose' library (Edge/Node compatible, zero dependencies)

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface SessionTokenPayload extends JWTPayload {
  sessionId: string;
  iat: number;
  exp: number;
}

// ─────────────────────────────────────────────────────────
// KEY MANAGEMENT
// ─────────────────────────────────────────────────────────

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_JWT_SECRET env var is missing or too short (min 32 chars). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return new TextEncoder().encode(secret);
}

// ─────────────────────────────────────────────────────────
// TOKEN GENERATION
// ─────────────────────────────────────────────────────────

/**
 * Generate a signed JWT for a session.
 * Token is valid for 30 minutes by default.
 */
export async function generateSessionToken(
  sessionId: string,
  expiresInSeconds: number = 1800
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ sessionId } as SessionTokenPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .setIssuer('insight-ai')
    .setAudience('insight-session')
    .sign(getSecretKey());

  return token;
}

// ─────────────────────────────────────────────────────────
// TOKEN VERIFICATION
// ─────────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  sessionId?: string;
  error?: string;
}

/**
 * Verify and decode a session JWT.
 * Returns { valid: true, sessionId } on success.
 * Returns { valid: false, error } on any failure.
 */
export async function verifySessionToken(token: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: 'insight-ai',
      audience: 'insight-session',
    });

    const sessionPayload = payload as SessionTokenPayload;

    if (!sessionPayload.sessionId || typeof sessionPayload.sessionId !== 'string') {
      return { valid: false, error: 'Token missing sessionId claim' };
    }

    return { valid: true, sessionId: sessionPayload.sessionId };
  } catch (err: any) {
    if (err.code === 'ERR_JWT_EXPIRED') {
      return { valid: false, error: 'Token expired' };
    }
    if (err.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      return { valid: false, error: 'Invalid token signature' };
    }
    return { valid: false, error: err.message || 'Token verification failed' };
  }
}

// ─────────────────────────────────────────────────────────
// REQUEST HELPER
// ─────────────────────────────────────────────────────────

/**
 * Extract and verify JWT from an incoming Request's Authorization header.
 * Expects: Authorization: Bearer <token>
 */
export async function authenticateRequest(req: Request): Promise<VerifyResult> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return { valid: false, error: 'Missing Authorization header' };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return { valid: false, error: 'Authorization header must be: Bearer <token>' };
  }

  return verifySessionToken(parts[1]);
}
