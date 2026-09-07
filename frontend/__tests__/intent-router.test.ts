// frontend/__tests__/intent-router.test.ts
// Unit tests for IntentRouter heuristic classification

import { IntentRouter } from '../lib/agent/intent-router';

describe('IntentRouter', () => {
  const router = new IntentRouter();

  const noPage = { currentUrl: undefined, currentApplication: undefined, hasActivePage: false };
  const onAmazon = { currentUrl: 'https://www.amazon.in/results', currentApplication: 'Amazon', hasActivePage: true };
  const onYouTube = { currentUrl: 'https://www.youtube.com', currentApplication: 'YouTube', hasActivePage: true };

  describe('NAVIGATION intent', () => {
    const navCommands = [
      'open amazon',
      'go to youtube',
      'navigate to google',
      'visit instagram',
      'launch spotify',
      'take me to flipkart',
    ];

    test.each(navCommands)('"%s" should classify as NAVIGATION', (cmd) => {
      const result = router.classifySync(cmd, noPage);
      expect(result.intent).toBe('NAVIGATION');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    test('"search youtube" should be NAVIGATION even on active page', () => {
      const result = router.classifySync('search youtube', onAmazon);
      expect(result.intent).toBe('NAVIGATION');
    });
  });

  describe('IN_PAGE_ACTION intent', () => {
    const inPageCommands = [
      'scroll down',
      'scroll up',
      'click buy now',
      'click on the search button',
      'select the second one',
      'add to cart',
      'checkout',
      'go back',
      'type hello in search box',
      'fill the form',
      'select the black wallet',
      'the third product',
    ];

    test.each(inPageCommands)('"%s" should classify as IN_PAGE_ACTION', (cmd) => {
      const result = router.classifySync(cmd, onAmazon);
      expect(result.intent).toBe('IN_PAGE_ACTION');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('Context-dependent classification', () => {
    test('"search wireless earbuds" on active page = IN_PAGE_ACTION', () => {
      const result = router.classifySync('search wireless earbuds', onAmazon);
      expect(result.intent).toBe('IN_PAGE_ACTION');
    });

    test('"search wireless earbuds" with no active page = NAVIGATION', () => {
      const result = router.classifySync('search wireless earbuds', noPage);
      expect(result.intent).toBe('NAVIGATION');
    });

    test('ambiguous command with active page defaults to IN_PAGE_ACTION', () => {
      const result = router.classifySync('compare these options', onAmazon);
      expect(result.intent).toBe('IN_PAGE_ACTION');
      expect(result.source).toBe('default');
    });

    test('ambiguous command with no active page defaults to NAVIGATION', () => {
      const result = router.classifySync('compare these options', noPage);
      expect(result.intent).toBe('NAVIGATION');
      expect(result.source).toBe('default');
    });
  });
});
