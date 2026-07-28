/**
 * Flyer Scan Adapter Tests — Additive, Expiry, Threshold.
 *
 * Tests:
 *  - Adapter registration and basic price retrieval
 *  - submitScannedPrices / getPrice round-trip
 *  - Expiry detection: validTo in the past → stale confidence
 *  - Confidence threshold: different scores map to correct confidence levels
 *  - Batch retrieval via getPrices
 *  - Clear and re-test
 *
 * Run: npx jest __tests__/flyer-adapter.test.ts
 */

import { describe, it, expect } from '@jest/globals';
import { FlyerScanAdapter } from '../src/pricing/flyer-scan';
import type { ScannedFlyerPrice } from '../src/pricing/flyer-types';

// ─── Helpers ────────────────────────────────────────────────────────────────

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function makePrice(overrides: Partial<ScannedFlyerPrice> = {}): ScannedFlyerPrice {
  return {
    itemName: 'Organic Milk',
    storeId: 'store_walmart',
    storeName: 'Walmart',
    price: 4.99,
    unit: 'L',
    quantity: 2,
    scannedAt: Date.now(),
    validTo: Date.now() + 30 * DAY,
    confidence: 0.92,
    saleInfo: null,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('FlyerScanAdapter — Additive Storage', () => {
  it('stores and retrieves a scanned price', async () => {
    const adapter = new FlyerScanAdapter();
    const price = makePrice();

    await adapter.submitScannedPrices([price]);
    const result = await adapter.getPrice('Organic Milk', 'store_walmart');

    expect(result).not.toBeNull();
    expect(result!.price).toBeCloseTo(4.99, 2);
    expect(result!.source.adapterId).toBe('flyer-scan');
    expect(result!.source.storeName).toBe('Walmart');
    expect(result!.source.tier).toBe('flyer');
  });

  it('stores multiple prices and returns the newest', async () => {
    const adapter = new FlyerScanAdapter();
    const oldPrice = makePrice({ price: 3.99, scannedAt: Date.now() - 7 * DAY });
    const newPrice = makePrice({ price: 5.49, scannedAt: Date.now() });

    await adapter.submitScannedPrices([oldPrice, newPrice]);
    const result = await adapter.getPrice('Organic Milk', 'store_walmart');

    expect(result).not.toBeNull();
    expect(result!.price).toBeCloseTo(5.49, 2);
  });

  it('returns null for unknown item', async () => {
    const adapter = new FlyerScanAdapter();
    const result = await adapter.getPrice('Nonexistent Item', 'store_any');
    expect(result).toBeNull();
  });

  it('returns null for unknown store', async () => {
    const adapter = new FlyerScanAdapter();
    await adapter.submitScannedPrices([makePrice()]);
    const result = await adapter.getPrice('Organic Milk', 'store_target');
    expect(result).toBeNull();
  });
});

describe('FlyerScanAdapter — Expiry Detection', () => {
  it('marks price as stale when validTo is in the past', async () => {
    const adapter = new FlyerScanAdapter();
    const expiredPrice = makePrice({
      validTo: Date.now() - 1 * DAY, // expired yesterday
      confidence: 0.95,
    });

    await adapter.submitScannedPrices([expiredPrice]);
    const result = await adapter.getPrice('Organic Milk', 'store_walmart');

    // Expired prices should not be returned
    expect(result).toBeNull();
  });

  it('returns price normally when validTo is in the future', async () => {
    const adapter = new FlyerScanAdapter();
    const validPrice = makePrice({
      validTo: Date.now() + 30 * DAY, // valid for 30 more days
    });

    await adapter.submitScannedPrices([validPrice]);
    const result = await adapter.getPrice('Organic Milk', 'store_walmart');

    expect(result).not.toBeNull();
    expect(result!.confidence).not.toBe('stale');
  });

  it('returns price with no validTo date as non-expired', async () => {
    const adapter = new FlyerScanAdapter();
    const noExpiryPrice = makePrice({ validTo: null });

    await adapter.submitScannedPrices([noExpiryPrice]);
    const result = await adapter.getPrice('Organic Milk', 'store_walmart');

    expect(result).not.toBeNull();
    expect(result!.confidence).not.toBe('stale');
  });
});

describe('FlyerScanAdapter — Confidence Threshold', () => {
  it('maps confidence >= 0.9 to real_time', async () => {
    const adapter = new FlyerScanAdapter();
    await adapter.submitScannedPrices([
      makePrice({ confidence: 0.95 }),
    ]);
    const result = await adapter.getPrice('Organic Milk', 'store_walmart');
    expect(result!.confidence).toBe('real_time');
  });

  it('maps confidence 0.75-0.89 to recent', async () => {
    const adapter = new FlyerScanAdapter();
    await adapter.submitScannedPrices([
      makePrice({ confidence: 0.8 }),
    ]);
    const result = await adapter.getPrice('Organic Milk', 'store_walmart');
    expect(result!.confidence).toBe('recent');
  });

  it('maps confidence 0.6-0.74 to estimated', async () => {
    const adapter = new FlyerScanAdapter();
    await adapter.submitScannedPrices([
      makePrice({ confidence: 0.65 }),
    ]);
    const result = await adapter.getPrice('Organic Milk', 'store_walmart');
    expect(result!.confidence).toBe('estimated');
  });
});

describe('FlyerScanAdapter — Batch Retrieval', () => {
  it('returns prices for multiple items via getPrices', async () => {
    const adapter = new FlyerScanAdapter();

    await adapter.submitScannedPrices([
      makePrice({ itemName: 'Apples', price: 3.99 }),
      makePrice({ itemName: 'Bananas', price: 1.99 }),
      makePrice({ itemName: 'Oranges', price: 5.49 }),
    ]);

    const results = await adapter.getPrices(
      ['Apples', 'Bananas', 'Oranges', 'Mangoes'],
      'store_walmart',
    );

    expect(results.size).toBe(3);
    expect(results.get('Apples')!.price).toBeCloseTo(3.99, 2);
    expect(results.get('Bananas')!.price).toBeCloseTo(1.99, 2);
    expect(results.get('Oranges')!.price).toBeCloseTo(5.49, 2);
    expect(results.has('Mangoes')).toBe(false);
  });
});

describe('FlyerScanAdapter — Clear', () => {
  it('clears all stored prices', async () => {
    const adapter = new FlyerScanAdapter();

    await adapter.submitScannedPrices([makePrice()]);
    expect(await adapter.getPrice('Organic Milk', 'store_walmart')).not.toBeNull();

    adapter.clearAllPrices();
    expect(await adapter.getPrice('Organic Milk', 'store_walmart')).toBeNull();
  });
});

describe('FlyerScanAdapter — isAvailable', () => {
  it('returns true (always available)', () => {
    const adapter = new FlyerScanAdapter();
    expect(adapter.isAvailable()).toBe(true);
  });
});

describe('FlyerScanAdapter — Adapter Identity', () => {
  it('has the correct id and name', () => {
    const adapter = new FlyerScanAdapter();
    expect(adapter.id).toBe('flyer-scan');
    expect(adapter.name).toBe('Flyer Scan');
    expect(adapter.tier).toBe('flyer');
  });
});
