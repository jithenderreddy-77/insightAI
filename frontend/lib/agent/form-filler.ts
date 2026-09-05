// frontend/lib/agent/form-filler.ts
// ╔═══════════════════════════════════════════════════════════════╗
// ║  Universal Form Filler Engine                                 ║
// ║  Deterministic → LLM → HITL, in that order always            ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Works for any form: checkout, address, Google Forms, sign-up pages.
// NEVER autofills full card number or CVV — always asks live via HITL.
//
// Step 1: Match form fields to PII by autocomplete/name/placeholder/label (instant)
// Step 2: Unresolved fields → LLM with constrained enum output (Ollama)
// Step 3: Missing data → HITL prompt (pause + resume via promise)

import type { SelectorMapEntry } from './session-state';
import { piiStore, type PIIProfile } from './pii-store';
import { ollamaJSON } from './ollama-client';

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface FormFieldMapping {
  selectorIndex: number;
  selector: string;
  fieldPath: string;           // PII field path: 'firstName', 'address.city', etc.
  value: string;
  confidence: number;
  source: 'deterministic' | 'llm' | 'hitl';
}

export interface FormFillResult {
  mappings: FormFieldMapping[];
  unmappedFields: Array<{ index: number; label: string; reason: string }>;
  hitlQuestions: Array<{ questionId: string; question: string; fieldName: string }>;
}

// ─────────────────────────────────────────────────────────
// FIELD ENUM (valid PII field paths the LLM can output)
// ─────────────────────────────────────────────────────────

const VALID_FIELD_PATHS = [
  'firstName', 'lastName', 'email', 'phone',
  'address.line1', 'address.line2', 'address.city',
  'address.state', 'address.zip', 'address.country',
  'payment.cardholderName', 'payment.last4',
  'payment.expiryMonth', 'payment.expiryYear',
] as const;

type ValidFieldPath = typeof VALID_FIELD_PATHS[number];

// Fields that must ALWAYS be asked live (HITL), never autofilled from storage
const ALWAYS_HITL_FIELDS = new Set([
  'payment.cardNumber', 'payment.fullCardNumber',
  'payment.cvv', 'payment.cvc', 'payment.securityCode',
  'otp', 'verificationCode',
]);

// ─────────────────────────────────────────────────────────
// AUTOCOMPLETE → PII FIELD MAPPING
// ─────────────────────────────────────────────────────────

const AUTOCOMPLETE_MAP: Record<string, ValidFieldPath> = {
  'given-name': 'firstName',
  'family-name': 'lastName',
  'name': 'firstName',
  'email': 'email',
  'tel': 'phone',
  'telephone': 'phone',
  'street-address': 'address.line1',
  'address-line1': 'address.line1',
  'address-line2': 'address.line2',
  'address-level2': 'address.city',
  'address-level1': 'address.state',
  'postal-code': 'address.zip',
  'country': 'address.country',
  'country-name': 'address.country',
  'cc-name': 'payment.cardholderName',
  'cc-exp-month': 'payment.expiryMonth',
  'cc-exp-year': 'payment.expiryYear',
};

// ─────────────────────────────────────────────────────────
// NAME/ID HEURISTIC PATTERNS
// ─────────────────────────────────────────────────────────

const NAME_HEURISTICS: Array<{ pattern: RegExp; fieldPath: ValidFieldPath }> = [
  { pattern: /^(first.?name|fname|given.?name|f_name)$/i, fieldPath: 'firstName' },
  { pattern: /^(last.?name|lname|surname|family.?name|l_name)$/i, fieldPath: 'lastName' },
  { pattern: /^(email|e.?mail|emailaddress|email.?address)$/i, fieldPath: 'email' },
  { pattern: /^(phone|tel|telephone|mobile|phone.?number|contact.?number)$/i, fieldPath: 'phone' },
  { pattern: /^(address|addr|street|address.?line.?1|addr1|street.?address)$/i, fieldPath: 'address.line1' },
  { pattern: /^(address.?line.?2|addr2|apt|suite|apartment)$/i, fieldPath: 'address.line2' },
  { pattern: /^(city|town|locality)$/i, fieldPath: 'address.city' },
  { pattern: /^(state|province|region)$/i, fieldPath: 'address.state' },
  { pattern: /^(zip|zipcode|zip.?code|postal|postal.?code|pincode|pin.?code)$/i, fieldPath: 'address.zip' },
  { pattern: /^(country|nation)$/i, fieldPath: 'address.country' },
  { pattern: /^(cardholder|card.?holder|name.?on.?card|cc.?name)$/i, fieldPath: 'payment.cardholderName' },
];

// ─────────────────────────────────────────────────────────
// PLACEHOLDER/LABEL HEURISTIC PATTERNS
// ─────────────────────────────────────────────────────────

const LABEL_HEURISTICS: Array<{ pattern: RegExp; fieldPath: ValidFieldPath }> = [
  { pattern: /first\s*name/i, fieldPath: 'firstName' },
  { pattern: /last\s*name|surname/i, fieldPath: 'lastName' },
  { pattern: /e-?mail/i, fieldPath: 'email' },
  { pattern: /phone|mobile|contact/i, fieldPath: 'phone' },
  { pattern: /address\s*(line\s*1)?|street/i, fieldPath: 'address.line1' },
  { pattern: /address\s*line\s*2|apartment|suite/i, fieldPath: 'address.line2' },
  { pattern: /\bcity\b|town/i, fieldPath: 'address.city' },
  { pattern: /\bstate\b|province/i, fieldPath: 'address.state' },
  { pattern: /zip|postal|pin\s*code/i, fieldPath: 'address.zip' },
  { pattern: /country/i, fieldPath: 'address.country' },
  { pattern: /name\s+on\s+card|cardholder/i, fieldPath: 'payment.cardholderName' },
];

// ─────────────────────────────────────────────────────────
// FORM FILLER ENGINE
// ─────────────────────────────────────────────────────────

export class FormFiller {
  /**
   * Analyze form fields in the selector map and produce fill instructions.
   *
   * 1. Deterministic: autocomplete, name/id, placeholder/label heuristics
   * 2. LLM-assisted: for unresolved fields (Ollama, constrained enum)
   * 3. HITL: for missing PII data
   *
   * Returns mappings (ready to fill), unmapped fields, and HITL questions to ask.
   */
  public async analyzeFillableFields(
    selectorMap: Record<number, SelectorMapEntry>
  ): Promise<FormFillResult> {
    const profile = piiStore.loadProfile();
    const entries = Object.values(selectorMap);

    // Filter to fillable elements only (textbox, searchbox, select, combobox, textarea)
    const fillable = entries.filter(e =>
      ['textbox', 'searchbox', 'select', 'combobox', 'textarea', 'input'].includes(e.role)
    );

    const mappings: FormFieldMapping[] = [];
    const unmapped: Array<{ index: number; label: string; reason: string }> = [];
    const hitlQuestions: Array<{ questionId: string; question: string; fieldName: string }> = [];
    const resolvedIndices = new Set<number>();

    // ── STEP 1: DETERMINISTIC ──

    for (const field of fillable) {
      const resolved = this.deterministicMatch(field);
      if (resolved) {
        // Check if this field should always be asked live
        if (ALWAYS_HITL_FIELDS.has(resolved)) {
          hitlQuestions.push({
            questionId: `hitl_${field.index}_${resolved}`,
            question: this.getHITLQuestion(resolved, field.label),
            fieldName: resolved,
          });
          resolvedIndices.add(field.index);
          continue;
        }

        const value = piiStore.getField(resolved);
        if (value) {
          mappings.push({
            selectorIndex: field.index,
            selector: field.selector,
            fieldPath: resolved,
            value,
            confidence: 0.95,
            source: 'deterministic',
          });
          resolvedIndices.add(field.index);
        } else {
          // We know what field this is, but don't have the data → HITL
          hitlQuestions.push({
            questionId: `hitl_${field.index}_${resolved}`,
            question: this.getHITLQuestion(resolved, field.label),
            fieldName: resolved,
          });
          resolvedIndices.add(field.index);
        }
      }
    }

    // ── STEP 2: LLM-ASSISTED (for remaining unresolved fields) ──

    const unresolvedFields = fillable.filter(f => !resolvedIndices.has(f.index));

    if (unresolvedFields.length > 0) {
      const llmMappings = await this.llmResolveFields(unresolvedFields, profile);
      for (const mapping of llmMappings) {
        if (ALWAYS_HITL_FIELDS.has(mapping.fieldPath)) {
          const field = selectorMap[mapping.selectorIndex];
          hitlQuestions.push({
            questionId: `hitl_${mapping.selectorIndex}_${mapping.fieldPath}`,
            question: this.getHITLQuestion(mapping.fieldPath, field?.label || ''),
            fieldName: mapping.fieldPath,
          });
          resolvedIndices.add(mapping.selectorIndex);
          continue;
        }

        const value = piiStore.getField(mapping.fieldPath);
        if (value) {
          const fieldEntry = selectorMap[mapping.selectorIndex];
          mappings.push({
            ...mapping,
            selector: fieldEntry?.selector || '',
            value,
            source: 'llm',
          });
          resolvedIndices.add(mapping.selectorIndex);
        } else {
          const field = selectorMap[mapping.selectorIndex];
          hitlQuestions.push({
            questionId: `hitl_${mapping.selectorIndex}_${mapping.fieldPath}`,
            question: this.getHITLQuestion(mapping.fieldPath, field?.label || ''),
            fieldName: mapping.fieldPath,
          });
          resolvedIndices.add(mapping.selectorIndex);
        }
      }
    }

    // ── Collect remaining unmapped ──

    for (const field of fillable) {
      if (!resolvedIndices.has(field.index)) {
        unmapped.push({
          index: field.index,
          label: field.label,
          reason: 'Could not determine field type by deterministic or LLM analysis',
        });
      }
    }

    return { mappings, unmappedFields: unmapped, hitlQuestions };
  }

  // ── DETERMINISTIC MATCHING ──

  private deterministicMatch(field: SelectorMapEntry): string | null {
    // 1. Check autocomplete attribute (embedded in selector or label)
    const autocompleteMatch = field.selector.match(/autocomplete="([^"]+)"/);
    if (autocompleteMatch) {
      const mapped = AUTOCOMPLETE_MAP[autocompleteMatch[1]];
      if (mapped) return mapped;
    }

    // 2. Check name/id via selector
    const nameMatch = field.selector.match(/name="([^"]+)"/);
    const idMatch = field.selector.match(/#([a-zA-Z0-9_-]+)/);
    const identifiers = [nameMatch?.[1], idMatch?.[1]].filter(Boolean);

    for (const id of identifiers) {
      if (!id) continue;
      for (const { pattern, fieldPath } of NAME_HEURISTICS) {
        if (pattern.test(id)) return fieldPath;
      }
    }

    // Check if name/id suggests a card number field (ALWAYS HITL)
    for (const id of identifiers) {
      if (!id) continue;
      if (/^(card.?number|cc.?number|ccnum|credit.?card|debit.?card)$/i.test(id)) {
        return 'payment.cardNumber'; // Will trigger ALWAYS_HITL
      }
      if (/^(cvv|cvc|security.?code|card.?verification)$/i.test(id)) {
        return 'payment.cvv'; // Will trigger ALWAYS_HITL
      }
      if (/^(otp|verification.?code|verify.?code)$/i.test(id)) {
        return 'otp'; // Will trigger ALWAYS_HITL
      }
    }

    // 3. Check placeholder/label text
    const labelText = field.label.toLowerCase();
    for (const { pattern, fieldPath } of LABEL_HEURISTICS) {
      if (pattern.test(labelText)) return fieldPath;
    }

    // Check for card/CVV in label
    if (/card\s*number|credit\s*card|debit\s*card/i.test(labelText)) {
      return 'payment.cardNumber';
    }
    if (/cvv|cvc|security\s*code/i.test(labelText)) {
      return 'payment.cvv';
    }

    return null;
  }

  // ── LLM-ASSISTED MATCHING ──

  private async llmResolveFields(
    fields: SelectorMapEntry[],
    profile: PIIProfile
  ): Promise<Array<{ selectorIndex: number; fieldPath: string; confidence: number }>> {
    const fieldDescriptions = fields
      .slice(0, 10) // Limit to 10 fields per LLM call
      .map(f => `Index ${f.index}: role="${f.role}", label="${f.label}", text="${f.text}"`)
      .join('\n');

    const validPaths = VALID_FIELD_PATHS.join(', ');

    const prompt = `You are a form-field identifier. Given these HTML form fields, identify which PII data field each one corresponds to.

Form fields:
${fieldDescriptions}

Valid field paths (respond ONLY with these values): ${validPaths}

Respond with ONLY a JSON array, no other text:
[{"index": <number>, "fieldPath": "<valid_field_path>"}]

Rules:
- Only include fields you are confident about (>80%)
- The fieldPath MUST be one of the valid paths listed above
- Do NOT invent new field paths`;

    const result = await ollamaJSON<Array<{ index: number; fieldPath: string }>>(prompt, {
      timeoutMs: 5000,
      maxTokens: 200,
    });

    if (!Array.isArray(result)) return [];

    // Schema validation: reject any invalid fieldPath or index
    return result
      .filter(item => {
        if (typeof item.index !== 'number') return false;
        if (!fields.some(f => f.index === item.index)) return false;
        if (!(VALID_FIELD_PATHS as readonly string[]).includes(item.fieldPath) &&
            !ALWAYS_HITL_FIELDS.has(item.fieldPath)) return false;
        return true;
      })
      .map(item => ({
        selectorIndex: item.index,
        fieldPath: item.fieldPath,
        confidence: 0.7,
      }));
  }

  // ── HITL QUESTION GENERATOR ──

  private getHITLQuestion(fieldPath: string, fieldLabel: string): string {
    const questions: Record<string, string> = {
      'firstName': 'What is your first name?',
      'lastName': 'What is your last name?',
      'email': 'What is your email address?',
      'phone': 'What is your phone number?',
      'address.line1': 'What is your street address?',
      'address.line2': 'Apartment, suite, or unit number?',
      'address.city': 'What city are you in?',
      'address.state': 'What state or province?',
      'address.zip': 'What is your zip or postal code?',
      'address.country': 'What country?',
      'payment.cardNumber': 'Please provide your card number (I will not store it).',
      'payment.fullCardNumber': 'Please provide your card number (I will not store it).',
      'payment.cvv': 'What is the CVV on your card? (I will not store it)',
      'payment.cvc': 'What is the CVC on your card? (I will not store it)',
      'payment.securityCode': 'What is your card security code? (I will not store it)',
      'payment.cardholderName': 'What name is on the card?',
      'payment.expiryMonth': 'What is the card expiry month?',
      'payment.expiryYear': 'What is the card expiry year?',
      'otp': 'Please provide the OTP or verification code you received.',
      'verificationCode': 'Please enter the verification code.',
    };

    return questions[fieldPath] || `Please provide a value for: ${fieldLabel || fieldPath}`;
  }
}

export const formFiller = new FormFiller();
