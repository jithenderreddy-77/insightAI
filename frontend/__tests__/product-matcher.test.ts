// frontend/__tests__/product-matcher.test.ts
// Unit tests for ProductMatcher — ordinal selection, fuzzy matching

import { ProductMatcher } from '../lib/agent/product-matcher';

const matcher = new ProductMatcher();

const makeSelectorMap = (...labels: string[]) => {
  const map: Record<number, any> = {};
  labels.forEach((label, i) => {
    map[i] = {
      index: i,
      role: 'button',
      label,
      selector: `#item-${i}`,
      text: label,
      bounds: { x: 0, y: i * 50, width: 200, height: 40 },
    };
  });
  return map;
};

describe('ProductMatcher', () => {
  const selectorMap = makeSelectorMap(
    'Sony WH-1000XM5 Black Wireless Headphones',
    'boAt Rockerz 450 Blue Bluetooth Headphones',
    'JBL Tune 760NC White Over-Ear Headphones',
    'Sennheiser HD 350BT Black Wireless Headphones',
    'Apple AirPods Max Silver'
  );

  describe('Ordinal selection', () => {
    test('"the first one" selects index 0', async () => {
      const result = await matcher.match('the first one', selectorMap);
      expect(result.matched).toBe(true);
      expect(result.entry?.index).toBe(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.source).toBe('deterministic');
    });

    test('"the second one" selects index 1', async () => {
      const result = await matcher.match('the second one', selectorMap);
      expect(result.matched).toBe(true);
      expect(result.entry?.index).toBe(1);
    });

    test('"the third product" selects index 2', async () => {
      const result = await matcher.match('the third product', selectorMap);
      expect(result.matched).toBe(true);
      expect(result.entry?.index).toBe(2);
    });

    test('"the last one" selects the last item', async () => {
      const result = await matcher.match('the last one', selectorMap);
      expect(result.matched).toBe(true);
      expect(result.entry?.index).toBe(4);
    });
  });

  describe('Keyword matching', () => {
    test('"JBL headphones" matches JBL entry', async () => {
      const result = await matcher.match('JBL headphones', selectorMap);
      expect(result.matched).toBe(true);
      expect(result.entry?.label).toContain('JBL');
    });

    test('"Apple AirPods" matches AirPods entry', async () => {
      const result = await matcher.match('Apple AirPods', selectorMap);
      expect(result.matched).toBe(true);
      expect(result.entry?.label).toContain('Apple');
    });
  });

  describe('Color matching', () => {
    test('"black headphones" favors entries with "Black"', async () => {
      const result = await matcher.match('black headphones', selectorMap);
      expect(result.matched).toBe(true);
      expect(result.entry?.label.toLowerCase()).toContain('black');
    });

    test('"white headphones" favors entries with "White"', async () => {
      const result = await matcher.match('white headphones', selectorMap);
      expect(result.matched).toBe(true);
      expect(result.entry?.label.toLowerCase()).toContain('white');
    });
  });

  describe('Empty selector map', () => {
    test('empty map returns no match', async () => {
      const result = await matcher.match('anything', {});
      expect(result.matched).toBe(false);
      expect(result.confidence).toBe(0);
    });
  });
});
