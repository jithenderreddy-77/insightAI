// frontend/lib/agent/pii-store.ts
// ╔═══════════════════════════════════════════════════════════════╗
// ║  Server-Side Encrypted PII Profile Store                      ║
// ║  AES-256-GCM, fresh IV per write, key from env var            ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// SECURITY RULES:
// - Full card number: NEVER STORED. Only last-4 and cardholder name.
// - CVV: NEVER STORED. Always ask live via HITL.
// - OTP: NEVER STORED.
// - Encryption key from PII_ENCRYPTION_KEY env var.
// - Fresh random IV per encryption operation.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface PIIAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface PIIPaymentRef {
  last4: string;           // Only last-4 digits stored
  cardholderName: string;
  expiryMonth?: string;
  expiryYear?: string;
  // NO full card number. NO CVV. Ever.
}

export interface PIIProfile {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: PIIAddress;
  payment?: PIIPaymentRef;
  // Generic key-value for form answers the user has given before
  // (e.g., "company name", "job title")
  customFields?: Record<string, string>;
}

interface EncryptedPayload {
  iv: string;       // hex
  authTag: string;  // hex
  ciphertext: string; // hex
}

// ─────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const DATA_DIR = path.resolve(process.cwd(), 'data');
const PII_FILE = path.join(DATA_DIR, 'pii-profile.enc.json');

// Fields that must NEVER be stored
const FORBIDDEN_FIELDS = new Set([
  'payment.cardNumber',
  'payment.fullCardNumber',
  'payment.cvv',
  'payment.cvc',
  'payment.securityCode',
  'otp',
  'password',
]);

// ─────────────────────────────────────────────────────────
// ENCRYPTION HELPERS
// ─────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const keyHex = process.env.PII_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length < 64) {
    throw new Error(
      'PII_ENCRYPTION_KEY env var is missing or too short (need 64 hex chars = 32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(keyHex.slice(0, 64), 'hex');
}

function encrypt(plaintext: string): EncryptedPayload {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16); // Fresh IV per encryption
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    iv: iv.toString('hex'),
    authTag,
    ciphertext: encrypted,
  };
}

function decrypt(payload: EncryptedPayload): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ─────────────────────────────────────────────────────────
// PII STORE
// ─────────────────────────────────────────────────────────

class PIIStore {
  private cachedProfile: PIIProfile | null = null;

  /**
   * Load the encrypted PII profile from disk.
   */
  public loadProfile(): PIIProfile {
    if (this.cachedProfile) return { ...this.cachedProfile };

    try {
      if (!fs.existsSync(PII_FILE)) {
        this.cachedProfile = {};
        return {};
      }

      const raw = fs.readFileSync(PII_FILE, 'utf8');
      const payload: EncryptedPayload = JSON.parse(raw);
      const decrypted = decrypt(payload);
      this.cachedProfile = JSON.parse(decrypted);
      return { ...this.cachedProfile! };
    } catch (err: any) {
      console.error('Failed to load PII profile:', err.message);
      this.cachedProfile = {};
      return {};
    }
  }

  /**
   * Save the PII profile to disk (encrypted).
   */
  public saveProfile(profile: PIIProfile): void {
    // Sanitize: strip any forbidden fields that might have been injected
    this.sanitize(profile);

    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const plaintext = JSON.stringify(profile, null, 2);
    const encrypted = encrypt(plaintext);
    fs.writeFileSync(PII_FILE, JSON.stringify(encrypted, null, 2), 'utf8');
    this.cachedProfile = { ...profile };
  }

  /**
   * Update specific fields in the profile.
   */
  public updateProfile(updates: Partial<PIIProfile>): PIIProfile {
    const current = this.loadProfile();
    const merged = { ...current, ...updates };

    // Merge nested objects (address, payment, customFields)
    if (updates.address) {
      merged.address = { ...current.address, ...updates.address } as PIIAddress;
    }
    if (updates.payment) {
      merged.payment = { ...current.payment, ...updates.payment } as PIIPaymentRef;
    }
    if (updates.customFields) {
      merged.customFields = { ...current.customFields, ...updates.customFields };
    }

    this.saveProfile(merged);
    return merged;
  }

  /**
   * Check if a specific field path has a value.
   * e.g., hasField('firstName'), hasField('address.city'), hasField('payment.last4')
   */
  public hasField(fieldPath: string): boolean {
    const profile = this.loadProfile();
    const value = this.getFieldValue(profile, fieldPath);
    return value !== undefined && value !== null && value !== '';
  }

  /**
   * Get a specific field's value by dot-notation path.
   * Returns undefined for forbidden fields (CVV, full card number, etc.)
   */
  public getField(fieldPath: string): string | undefined {
    // Block access to forbidden fields
    if (FORBIDDEN_FIELDS.has(fieldPath)) {
      return undefined;
    }

    const profile = this.loadProfile();
    return this.getFieldValue(profile, fieldPath);
  }

  /**
   * Set a specific field's value by dot-notation path.
   * Rejects forbidden fields.
   */
  public setField(fieldPath: string, value: string): boolean {
    if (FORBIDDEN_FIELDS.has(fieldPath)) {
      console.warn(`PIIStore: Attempted to store forbidden field "${fieldPath}" — rejected.`);
      return false;
    }

    const profile = this.loadProfile();
    this.setFieldValue(profile, fieldPath, value);
    this.saveProfile(profile);
    return true;
  }

  /**
   * Clear all PII data.
   */
  public clear(): void {
    this.cachedProfile = {};
    try {
      if (fs.existsSync(PII_FILE)) {
        fs.unlinkSync(PII_FILE);
      }
    } catch {}
  }

  // ── Private helpers ──

  private sanitize(profile: PIIProfile): void {
    // Ensure no full card number or CVV is stored
    if (profile.payment) {
      delete (profile.payment as any).cardNumber;
      delete (profile.payment as any).fullCardNumber;
      delete (profile.payment as any).cvv;
      delete (profile.payment as any).cvc;
      delete (profile.payment as any).securityCode;
    }
  }

  private getFieldValue(obj: any, path: string): string | undefined {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return typeof current === 'string' ? current : undefined;
  }

  private setFieldValue(obj: any, path: string, value: string): void {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined || current[parts[i]] === null) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }
}

export const piiStore = new PIIStore();
