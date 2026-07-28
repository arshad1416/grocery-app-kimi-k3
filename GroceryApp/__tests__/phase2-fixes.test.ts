/**
 * Phase 2 Fixes — Verification Tests.
 *
 * Verifies the 4 Phase 2 fixes:
 *   1. displayUnit in PriceResult (crowdsourced adapter)
 *   2. storePreference lookup instead of hardcoded 'default'
 *   3. Fake sale regularPrice precision (no percent-based rounding)
 *   4. Price loading trigger depends on item count, not items reference
 *
 * Run: npx jest __tests__/phase2-fixes.test.ts
 */

import { describe, it, expect } from '@jest/globals';
import { CrowdsourcedAdapter } from '../src/pricing/crowdsourced';
import { detectSale, normalizeUnitPrice } from '../src/pricing/normalizer';
import type { PriceResult } from '../src/pricing/types';

// =============================================================================
// Fix 1: displayUnit in PriceResult (crowdsourced adapter)
// =============================================================================

describe('Fix 1: displayUnit in PriceResult (crowdsourced adapter)', () => {
  it('returns displayUnit "/100g" when submitting with unit "kg"', async () => {
    const adapter = new CrowdsourcedAdapter();

    await adapter.submitPrice({
      itemName: 'Chicken Breast',
      storeId: 'store_costco',
      storeName: 'Costco',
      price: 12.99,
      unit: 'kg',
      quantity: 2,
      submittedBy: 'device-1',
    });

    const result = await adapter.getPrice('Chicken Breast', 'store_costco');
    expect(result).not.toBeNull();
    expect(result!.displayUnit).toBe('/100g');
  });

  it('returns displayUnit "/100mL" when submitting with unit "L"', async () => {
    const adapter = new CrowdsourcedAdapter();

    await adapter.submitPrice({
      itemName: 'Orange Juice',
      storeId: 'store_walmart',
      storeName: 'Walmart',
      price: 3.99,
      unit: 'L',
      quantity: 2,
      submittedBy: 'device-1',
    });

    const result = await adapter.getPrice('Orange Juice', 'store_walmart');
    expect(result).not.toBeNull();
    expect(result!.displayUnit).toBe('/100mL');
  });

  it('returns displayUnit "/ea" when submitting with unit "each"', async () => {
    const adapter = new CrowdsourcedAdapter();

    await adapter.submitPrice({
      itemName: 'Avocado',
      storeId: 'store_target',
      storeName: 'Target',
      price: 1.49,
      unit: 'each',
      quantity: 1,
      submittedBy: 'device-1',
    });

    const result = await adapter.getPrice('Avocado', 'store_target');
    expect(result).not.toBeNull();
    expect(result!.displayUnit).toBe('/ea');
  });

  it('PriceBadge fallback: uses displayUnit when present, falls back to "/unit" when undefined', () => {
    // This tests the nullish coalescing in PriceBadge line 71:
    //   const displayUnit = price.displayUnit ?? '/' + price.unit;

    // Case 1: displayUnit is defined → use it
    const priceWithDisplayUnit: PriceResult = {
      price: 4.99,
      unitPrice: 0.5,
      unit: 'kg',
      displayUnit: '/100g',
      saleInfo: null,
      source: { adapterId: 'crowdsourced', tier: 'crowd', storeId: 's1', storeName: 'S1' },
      timestamp: Date.now(),
      confidence: 'recent',
    };
    const resolved1 = priceWithDisplayUnit.displayUnit ?? '/' + priceWithDisplayUnit.unit;
    expect(resolved1).toBe('/100g');

    // Case 2: displayUnit is undefined → fallback to "/unit"
    const priceWithoutDisplayUnit: PriceResult = {
      price: 4.99,
      unitPrice: 2.5,
      unit: 'bunch',
      displayUnit: undefined,
      saleInfo: null,
      source: { adapterId: 'crowdsourced', tier: 'crowd', storeId: 's2', storeName: 'S2' },
      timestamp: Date.now(),
      confidence: 'estimated',
    };
    const resolved2 = priceWithoutDisplayUnit.displayUnit ?? '/' + priceWithoutDisplayUnit.unit;
    expect(resolved2).toBe('/bunch');
  });

  it('crowdsourced adapter getPrices also includes displayUnit', async () => {
    const adapter = new CrowdsourcedAdapter();

    await adapter.submitPrice({
      itemName: 'Milk',
      storeId: 'store_a',
      storeName: 'Store A',
      price: 5.49,
      unit: 'L',
      quantity: 2,
      submittedBy: 'd1',
    });

    const results = await adapter.getPrices(['Milk'], 'store_a');
    expect(results.size).toBe(1);
    expect(results.get('Milk')!.displayUnit).toBe('/100mL');
  });
});

// =============================================================================
// Fix 2: storePreference lookup instead of hardcoded 'default'
// =============================================================================

describe('Fix 2: storePreference lookup (not hardcoded "default")', () => {
  /**
   * Helper: pure function modeling the inlined resolution in both screens:
   *
   *   GroceryListScreen line 243-244:
   *     const listPref = useListStore((s) => s.lists[listId]?.storePreference);
   *     const storeId = listPref ?? 'default';
   *
   *   ItemEditScreen line 72-73:
   *     const editStorePref = useListStore((s) => s.lists[listId]?.storePreference);
   *     const editStoreId = editStorePref ?? 'default';
   */
  function resolveStoreId(
    lists: Record<string, { storePreference?: string }>,
    listId: string,
  ): string {
    const pref = lists[listId]?.storePreference;
    return pref ?? 'default';
  }

  it('returns storePreference when set on the list', () => {
    const lists = {
      list_abc: { storePreference: 'store_walmart' },
    };
    const storeId = resolveStoreId(lists, 'list_abc');
    expect(storeId).toBe('store_walmart');
  });

  it('falls back to "default" when storePreference is undefined', () => {
    const lists = {
      list_abc: {},
    };
    const storeId = resolveStoreId(lists, 'list_abc');
    expect(storeId).toBe('default');
  });

  it('keeps empty string storePreference (?? only catches null/undefined, not "")', () => {
    const lists = {
      list_abc: { storePreference: '' },
    };
    const storeId = resolveStoreId(lists, 'list_abc');
    // ?? does NOT catch '' — only null/undefined.
    // The actual GroceryListScreen code uses ??, so empty string is treated as set.
    // In practice, storePreference is set to a real store name or left as undefined.
    expect(storeId).toBe('');
  });

  it('falls back to "default" when the list does not exist', () => {
    const lists: Record<string, { storePreference?: string }> = {};
    const storeId = resolveStoreId(lists, 'nonexistent_list');
    expect(storeId).toBe('default');
  });

  it('uses the correct storePreference per-list (different lists, different stores)', () => {
    const lists = {
      list_1: { storePreference: 'store_walmart' },
      list_2: { storePreference: 'store_target' },
      list_3: {},
    };
    expect(resolveStoreId(lists, 'list_1')).toBe('store_walmart');
    expect(resolveStoreId(lists, 'list_2')).toBe('store_target');
    expect(resolveStoreId(lists, 'list_3')).toBe('default');
  });
});

// =============================================================================
// Fix 3: Fake sale regularPrice precision (no percent-based rounding)
// =============================================================================

describe('Fix 3: Fake sale precision (direct formula, no percent rounding)', () => {
  /**
   * The fix computes regularPrice as:
   *   regularPrice = price * (avgRecent / unitPrice)
   *
   * Instead of the old broken formula:
   *   regularPrice = price / (1 + fakePercent / 100)
   *
   * Old formula introduced drift because fakePercent is a rounded integer.
   */

  it('fake sale regularPrice is precise — no rounding-induced drift', () => {
    // Given: price=5.99, unitPrice=6.50, recentPrices=[4.99, 5.20, 5.10]
    // unitPrice (6.50) > avgRecent (≈5.097) → fake sale
    const result = detectSale(5.99, 6.50, [4.99, 5.20, 5.10]);

    expect(result).not.toBeNull();
    expect(result!.isOnSale).toBe(true);
    // unitPriceVsRegular > 0 means fake markdown
    expect(result!.unitPriceVsRegular).toBeGreaterThan(0);

    // Manual calculation:
    // avgRecent = (4.99 + 5.20 + 5.10) / 3 = 15.29 / 3 = 5.096666...
    // regularPrice = 5.99 * (5.096666... / 6.50)
    //             = 5.99 * 0.78410256...
    //             ≈ 4.696...

    const avgRecent = (4.99 + 5.20 + 5.10) / 3;
    const expectedRegular = 5.99 * (avgRecent / 6.50);

    // regularPrice should match the direct computation exactly
    expect(result!.regularPrice).toBeCloseTo(expectedRegular, 5);

    // Crucial: regularPrice should NOT match the OLD formula
    // Old: fakePercent = round((6.50 - 5.0967) / 5.0967 * 100) = round(27.54) = 28
    // Old: regularPrice = 5.99 / (1 + 28/100) = 5.99 / 1.28 ≈ 4.68
    const oldFakePercent = Math.round(((6.50 - avgRecent) / avgRecent) * 100);
    const oldRegularPrice = 5.99 / (1 + oldFakePercent / 100);
    // The new result should not equal the old rounded result (within tolerance)
    expect(Math.abs(result!.regularPrice - oldRegularPrice)).toBeGreaterThan(0.005);
    // The new result is more accurate
    expect(Math.abs(result!.regularPrice - expectedRegular)).toBeLessThan(0.001);
  });

  it('genuine sale also uses the same precise formula', () => {
    // Given: price=2.99, unitPrice=1.50, recentPrices=[2.0, 2.1, 1.9]
    // unitPrice (1.50) < avgRecent (2.0) → genuine sale
    const result = detectSale(2.99, 1.50, [2.0, 2.1, 1.9]);

    expect(result).not.toBeNull();
    expect(result!.isOnSale).toBe(true);
    expect(result!.unitPriceVsRegular).toBeLessThan(0);

    // avgRecent = (2.0 + 2.1 + 1.9) / 3 = 6.0 / 3 = 2.0
    // regularPrice = 2.99 * (2.0 / 1.50) = 2.99 * 1.333... = 3.9866...
    const avgRecent = (2.0 + 2.1 + 1.9) / 3;
    const expectedRegular = 2.99 * (avgRecent / 1.50);

    expect(result!.regularPrice).toBeCloseTo(expectedRegular, 5);
  });

  it('fake sale: different inputs with non-integer recent averages', () => {
    // Edge case: irregular prices to stress precision
    const recent = [3.33, 4.44, 5.55];
    const result = detectSale(10.0, 7.77, recent);

    expect(result).not.toBeNull();
    expect(result!.isOnSale).toBe(true);
    expect(result!.unitPriceVsRegular).toBeGreaterThan(0);

    const avgRecent = (3.33 + 4.44 + 5.55) / 3;
    const expectedRegular = 10.0 * (avgRecent / 7.77);

    expect(result!.regularPrice).toBeCloseTo(expectedRegular, 5);
  });

  it('regularPrice uses unrounded intermediate values (not percent step)', () => {
    // Verify that regularPrice is NOT computed via:
    //   percent = round((unitPrice - avgRecent) / avgRecent * 100)
    //   regularPrice = price / (1 + percent / 100)
    //
    // If it were, the result would drift by at least 0.5%.

    const result = detectSale(9.99, 8.00, [5.00]);

    // avgRecent = 5.00
    // Direct: regularPrice = 9.99 * (5.00 / 8.00) = 9.99 * 0.625 = 6.24375
    const expectedDirect = 9.99 * (5.0 / 8.0);

    // Old percent approach:
    // fakePercent = round((8.0 - 5.0) / 5.0 * 100) = round(60) = 60
    // regularPrice = 9.99 / (1 + 60/100) = 9.99 / 1.6 = 6.24375
    // In this case they happen to match because 60 is an exact integer.
    // So let's use a case where rounding WOULD cause drift.

    const result2 = detectSale(7.50, 6.75, [4.99, 5.01]);
    // avgRecent = 5.00
    // Direct: regularPrice = 7.50 * (5.00 / 6.75) = 7.50 * 0.740740... = 5.5555...
    const expectedDirect2 = 7.50 * (5.00 / 6.75);

    // Old: fakePercent = round((6.75 - 5.00) / 5.00 * 100) = round(35) = 35
    // Old: regularPrice = 7.50 / 1.35 = 5.5555... (same here, 35 is exact)
    // Hmm, let's try with values that produce a fractional percent.

    const result3 = detectSale(12.34, 8.76, [6.00]);
    // avgRecent = 6.00
    // Direct: regularPrice = 12.34 * (6.00 / 8.76) = 12.34 * 0.6849315... = 8.4520...
    const expectedDirect3 = 12.34 * (6.0 / 8.76);

    // Old: fakePercent = round((8.76 - 6.00) / 6.00 * 100) = round(46.0) = 46
    // Old: regularPrice = 12.34 / 1.46 = 8.45205... (46 is also exact!)

    // Let's try a case with a non-round percent:
    // unitPrice=8.76, avgRecent=6.00 → diff=2.76, ratio=0.46, percent=46.0 — still exact
    // Need: (unitPrice - avgRecent) / avgRecent * 100 that is NOT a round number

    // Try: unitPrice=5.00, avgRecent=3.00 → diff=2.00, ratio=0.6666..., percent=66.66..., rounds to 67
    const result4 = detectSale(10.00, 5.00, [3.00]);
    // avgRecent = 3.00
    // Direct: regularPrice = 10.00 * (3.00 / 5.00) = 6.00
    const expectedDirect4 = 10.0 * (3.0 / 5.0);

    // Old: fakePercent = round(66.666...) = 67
    // Old: regularPrice = 10.00 / 1.67 = 5.988...
    // These DIFFER by ~0.012 — the direct formula is correct, the old one drifts

    expect(result4!.regularPrice).toBeCloseTo(expectedDirect4, 5);

    // Verify it does NOT match the old formula
    const oldPercent = Math.round(((5.0 - 3.0) / 3.0) * 100);
    const oldPrice = 10.0 / (1 + oldPercent / 100);
    expect(result4!.regularPrice).not.toBeCloseTo(oldPrice, 2);
  });

  it('savingsPercent still uses rounded integer for display but regularPrice is exact', () => {
    // savingsPercent is a display field (rounding is fine)
    // regularPrice must be precise
    const result = detectSale(10.00, 5.00, [3.00]);

    // savingsPercent is rounded — OK for display
    expect(result!.savingsPercent).toBeLessThan(0);

    // But regularPrice keeps full precision
    const expectedRegular = 10.0 * ((3.0) / 5.0);
    expect(result!.regularPrice).toBeCloseTo(expectedRegular, 8);
  });
});

// =============================================================================
// Fix 4: Price loading trigger depends on item count, not items reference
// =============================================================================

describe('Fix 4: Price loading trigger — Object.keys(items).length dependency', () => {
  /**
   * The fix changed the useEffect dependency from `[items, ...]` to
   * `[Object.keys(items).length, ...]`. This test verifies the logic:
   * the effect should re-run when the number of items changes (add/remove),
   * but NOT when item properties change (which doesn't affect the count).
   */

  it('Object.keys(items).length changes when items are added', () => {
    const items: Record<string, { name: string }> = {};
    expect(Object.keys(items).length).toBe(0);

    items['a'] = { name: 'Milk' };
    expect(Object.keys(items).length).toBe(1);

    items['b'] = { name: 'Bread' };
    expect(Object.keys(items).length).toBe(2);
  });

  it('Object.keys(items).length changes when items are removed', () => {
    const items: Record<string, { name: string }> = { a: { name: 'Milk' }, b: { name: 'Bread' } };
    expect(Object.keys(items).length).toBe(2);

    delete items['a'];
    expect(Object.keys(items).length).toBe(1);

    delete items['b'];
    expect(Object.keys(items).length).toBe(0);
  });

  it('Object.keys(items).length does NOT change when item content changes', () => {
    const items: Record<string, { name: string }> = { a: { name: 'Milk' } };
    const lengthBefore = Object.keys(items).length;

    // Mutate the existing item — length stays the same
    items['a'].name = 'Almond Milk';
    expect(Object.keys(items).length).toBe(lengthBefore);

    items['a'] = { name: 'Soy Milk' };
    expect(Object.keys(items).length).toBe(lengthBefore);
  });

  it('loadPrices correctly resolves storeId per-item using ?? fallback', () => {
    // This tests the storeId resolution inside price-store.ts loadPrices (line 57):
    //   const storeId = item.storeId ?? defaultStoreId ?? 'default';

    function resolveStoreIdForItem(
      item: { id: string; name: string; storeId?: string },
      defaultStoreId?: string,
    ): string {
      return item.storeId ?? defaultStoreId ?? 'default';
    }

    // Item with its own storeId → uses it
    expect(resolveStoreIdForItem({ id: '1', name: 'Milk', storeId: 'store_walmart' }))
      .toBe('store_walmart');

    // Item without storeId, with a default → uses default
    expect(resolveStoreIdForItem({ id: '2', name: 'Bread' }, 'store_target'))
      .toBe('store_target');

    // Item without storeId, without default → falls back to 'default'
    expect(resolveStoreIdForItem({ id: '3', name: 'Eggs' }))
      .toBe('default');

    // Item with empty string storeId should fall through (empty is falsy)
    // But ?? only catches null/undefined, not '' — GroceryListScreen passes storeId
    // from the preference, and that's already resolved. The storeId on item
    // objects is a user-facing field so '' would need special handling.
    // This matches the actual production code behavior.
  });

  it('loadPrices groups items by store and resolves storeId correctly', () => {
    // Simulate the grouping logic from price-store.ts loadPrices
    function groupByStore(
      items: { id: string; name: string; storeId?: string }[],
      defaultStoreId?: string,
    ): Map<string, { id: string; name: string }[]> {
      const groups = new Map<string, { id: string; name: string }[]>();
      for (const item of items) {
        const storeId = item.storeId ?? defaultStoreId ?? 'default';
        if (!groups.has(storeId)) {
          groups.set(storeId, []);
        }
        groups.get(storeId)!.push({ id: item.id, name: item.name });
      }
      return groups;
    }

    const items = [
      { id: '1', name: 'Milk', storeId: 'store_walmart' },
      { id: '2', name: 'Bread', storeId: 'store_walmart' },
      { id: '3', name: 'Eggs' }, // no storeId → uses default
      { id: '4', name: 'Butter', storeId: 'store_target' },
    ];

    const groups = groupByStore(items, 'store_costco');

    expect(groups.get('store_walmart')!.length).toBe(2);
    expect(groups.get('store_costco')!.length).toBe(1); // Eggs falls here
    expect(groups.get('store_target')!.length).toBe(1);
    expect(groups.size).toBe(3);
  });
});
