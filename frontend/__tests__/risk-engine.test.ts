// frontend/__tests__/risk-engine.test.ts
// Unit tests for RiskEngine — PURCHASE always HIGH, FILL_FORM with card = HIGH

import { riskEngine } from '../lib/agent/risk-engine';

describe('RiskEngine', () => {
  describe('PURCHASE actions', () => {
    test('PURCHASE is always HIGH risk regardless of target', () => {
      expect(riskEngine.classifyRisk('PURCHASE')).toBe('HIGH');
      expect(riskEngine.classifyRisk('PURCHASE', 'random button')).toBe('HIGH');
      expect(riskEngine.classifyRisk('PURCHASE', undefined, 'low value')).toBe('HIGH');
    });

    test('PURCHASE always requires confirmation', () => {
      expect(riskEngine.requiresConfirmation('PURCHASE', 'HIGH')).toBe(true);
    });
  });

  describe('CLICK payment buttons', () => {
    test('Click on "Place Order" is HIGH', () => {
      expect(riskEngine.classifyRisk('CLICK', 'Place Order')).toBe('HIGH');
    });

    test('Click on "Buy Now" is HIGH', () => {
      expect(riskEngine.classifyRisk('CLICK', 'Buy Now')).toBe('HIGH');
    });

    test('Click on "Proceed to Checkout" is HIGH', () => {
      expect(riskEngine.classifyRisk('CLICK', 'Proceed to Checkout')).toBe('HIGH');
    });

    test('Click on "Submit Payment" is HIGH', () => {
      expect(riskEngine.classifyRisk('CLICK', 'Submit Payment')).toBe('HIGH');
    });

    test('Click on "Add to Cart" is LOW', () => {
      expect(riskEngine.classifyRisk('CLICK', 'Add to Cart')).toBe('LOW');
    });
  });

  describe('FILL_FORM actions', () => {
    test('FILL_FORM with card data is HIGH', () => {
      expect(riskEngine.classifyRisk('FILL_FORM', 'checkout', 'card number')).toBe('HIGH');
    });

    test('FILL_FORM with CVV is HIGH', () => {
      expect(riskEngine.classifyRisk('FILL_FORM', 'checkout', 'cvv code')).toBe('HIGH');
    });

    test('FILL_FORM with OTP is HIGH', () => {
      expect(riskEngine.classifyRisk('FILL_FORM', 'form', 'otp verification')).toBe('HIGH');
    });

    test('FILL_FORM with normal data is MEDIUM', () => {
      expect(riskEngine.classifyRisk('FILL_FORM', 'form', 'John Doe')).toBe('MEDIUM');
    });
  });

  describe('TYPE actions', () => {
    test('TYPE with password is HIGH', () => {
      expect(riskEngine.classifyRisk('TYPE', undefined, 'my password123')).toBe('HIGH');
    });

    test('TYPE in message field is MEDIUM', () => {
      expect(riskEngine.classifyRisk('TYPE', 'message input', 'hello')).toBe('MEDIUM');
    });
  });

  describe('Low risk actions', () => {
    test('SCROLL is LOW', () => {
      expect(riskEngine.classifyRisk('SCROLL')).toBe('LOW');
    });

    test('NAVIGATE is LOW', () => {
      expect(riskEngine.classifyRisk('NAVIGATE', 'https://google.com')).toBe('LOW');
    });

    test('SEARCH is LOW', () => {
      expect(riskEngine.classifyRisk('SEARCH', 'wireless earbuds')).toBe('LOW');
    });
  });
});
