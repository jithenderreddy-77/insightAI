// frontend/__tests__/safety-gate.test.ts
// Unit tests for SafetyGate — payment/purchase buttons must ALWAYS block

import { SafetyGate } from '../lib/agent/safety-gate';

const gate = new SafetyGate();

const makeEntry = (label: string, text: string = '', index: number = 0) => ({
  index,
  role: 'button',
  label,
  selector: `#btn-${index}`,
  text: text || label,
  bounds: { x: 0, y: 0, width: 100, height: 40 },
});

describe('SafetyGate', () => {
  describe('Payment button detection', () => {
    const paymentButtons = [
      'Place Order',
      'Pay Now',
      'Confirm Purchase',
      'Submit Payment',
      'Buy Now',
      'Complete Purchase',
      'Proceed to Pay',
      'Confirm and Pay',
      'Pay ₹599',
      'Pay $29.99',
    ];

    test.each(paymentButtons)('CLICK on "%s" must be blocked', (buttonText) => {
      const entry = makeEntry(buttonText);
      const result = gate.checkAction('CLICK', entry);
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.reason).toBe('payment_confirmation');
      }
    });
  });

  describe('Non-payment buttons should NOT be blocked', () => {
    const safeButtons = [
      'Add to Cart',
      'Search',
      'Submit Review',
      'Load More',
      'Next Page',
      'Apply Coupon',
    ];

    test.each(safeButtons)('CLICK on "%s" should NOT be blocked', (buttonText) => {
      const entry = makeEntry(buttonText);
      const result = gate.checkAction('CLICK', entry);
      expect(result.blocked).toBe(false);
    });
  });

  describe('OTP field detection', () => {
    test('TYPE on OTP field must be blocked', () => {
      const entry = makeEntry('Enter OTP');
      const result = gate.checkAction('TYPE', entry);
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.reason).toBe('otp_entry');
      }
    });

    test('TYPE on verification code field must be blocked', () => {
      const entry = makeEntry('Enter verification code');
      const result = gate.checkAction('TYPE', entry);
      expect(result.blocked).toBe(true);
    });

    test('TYPE on normal field should NOT be blocked', () => {
      const entry = makeEntry('First Name');
      const result = gate.checkAction('TYPE', entry);
      expect(result.blocked).toBe(false);
    });
  });

  describe('Confirmation parsing', () => {
    test.each(['yes', 'Yeah', 'sure', 'go ahead', 'proceed', 'confirm', 'do it'])(
      '"%s" should be a confirmation', (answer) => {
        expect(gate.isConfirmation(answer)).toBe(true);
      }
    );

    test.each(['no', 'Nope', 'stop', 'cancel', 'wait', 'hold on', 'not yet'])(
      '"%s" should be a denial', (answer) => {
        expect(gate.isDenial(answer)).toBe(true);
      }
    );
  });
});
