/**
 * Acceptance Test AC-10: Adapter Registration, Availability & Fallback
 *
 * Tests:
 * - Register adapter → isAvailable → getPrice
 * - Registry fallback: first adapter returns null → tries next
 * - Adapter enable/disable via registry
 *
 * Run: npx jest __tests__/ac10-adapters.test.ts
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { PriceAdapter } from '../src/pricing/adapter';
import { priceRegistry } from '../src/pricing/registry';
import type { PriceResult } from '../src/pricing/types';

// Mock the settings module to avoid require() issues in test
const mockSettings: any = {
  hostingTier: 'self_hosted',
  relayUrl: 'ws://localhost',
  relayPort: 8080,
  pairingCode: '',
  managedSubscriptionKey: '',
  localAiEndpoint: 'http://localhost:1234',
  priceServiceEnabled: false,
  voiceInputEnabled: false,
  barcodeScanningEnabled: false,
  // Registry enforces this master gate (AC-14); adapter-chain tests assume opt-in
  pricingOptedIn: true,
  adapterEnabled: {},
};
jest.mock('../src/config/settings', () => ({
  getSettings: () => mockSettings,
  updateSettings: (partial: any) => {
    Object.assign(mockSettings, partial);
    return Promise.resolve(mockSettings);
  },
}));

// ─── Mock Adapters ──────────────────────────────────────────────────────────

class MockOfficialAdapter implements PriceAdapter {
  id = 'mock_official';
  name = 'Mock Official';
  tier: 'official' = 'official';
  private available = true;
  private priceToReturn: PriceResult | null = {
    price: 4.99,
    unitPrice: 0.5,
    unit: 'kg',
    saleInfo: null,
    source: {
      adapterId: 'mock_official',
      tier: 'official',
      storeId: 'store_test',
      storeName: 'Mock Store',
    },
    timestamp: Date.now(),
    confidence: 'real_time',
  };

  setAvailable(v: boolean) { this.available = v; }
  setPrice(p: PriceResult | null) { this.priceToReturn = p; }

  isAvailable() { return this.available; }
  async getPrice(_itemName: string, _storeId: string) { return this.priceToReturn; }
  async getPrices(items: string[], storeId: string) {
    const map = new Map<string, PriceResult>();
    for (const item of items) {
      const p = await this.getPrice(item, storeId);
      if (p) map.set(item, p);
    }
    return map;
  }
}

class MockCrowdAdapter implements PriceAdapter {
  id = 'mock_crowd';
  name = 'Mock Crowd';
  tier: 'crowd' = 'crowd';
  private available = true;

  setAvailable(v: boolean) { this.available = v; }

  isAvailable() { return this.available; }
  async getPrice(_itemName: string, _storeId: string): Promise<PriceResult | null> {
    return {
      price: 3.49,
      unitPrice: 0.35,
      unit: 'kg',
      saleInfo: null,
      source: {
        adapterId: 'mock_crowd',
        tier: 'crowd',
        storeId: 'store_test',
        storeName: 'Crowd Store',
      },
      timestamp: Date.now(),
      confidence: 'recent',
    };
  }
  async getPrices(items: string[], storeId: string) {
    const map = new Map<string, PriceResult>();
    for (const item of items) {
      const p = await this.getPrice(item, storeId);
      if (p) map.set(item, p);
    }
    return map;
  }
}

class MockScrapingAdapter implements PriceAdapter {
  id = 'mock_scraping';
  name = 'Mock Scraping';
  tier: 'scraping' = 'scraping';
  private available = false;

  setAvailable(v: boolean) { this.available = v; }

  isAvailable() { return this.available; }
  async getPrice(_itemName: string, _storeId: string): Promise<PriceResult | null> {
    return this.available ? {
      price: 2.99,
      unitPrice: 0.3,
      unit: 'kg',
      saleInfo: null,
      source: {
        adapterId: 'mock_scraping',
        tier: 'scraping',
        storeId: 'store_test',
        storeName: 'Scrape Store',
      },
      timestamp: Date.now(),
      confidence: 'stale',
    } : null;
  }
  async getPrices(items: string[], storeId: string) {
    const map = new Map<string, PriceResult>();
    for (const item of items) {
      const p = await this.getPrice(item, storeId);
      if (p) map.set(item, p);
    }
    return map;
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AC-10a: Adapter Registration & Availability', () => {
  let official: MockOfficialAdapter;
  let crowd: MockCrowdAdapter;
  let scraping: MockScrapingAdapter;

  beforeEach(() => {
    official = new MockOfficialAdapter();
    crowd = new MockCrowdAdapter();
    scraping = new MockScrapingAdapter();
    // Clear any previously registered adapters
    // (registry is a singleton — for tests we work with it carefully)
  });

  it('registers adapter and it appears in getAvailableAdapters', () => {
    priceRegistry.registerAdapter(official);
    const adapters = priceRegistry.getAvailableAdapters();
    expect(adapters.some((a) => a.id === 'mock_official')).toBe(true);
  });

  it('isAvailable returns true by default', () => {
    expect(official.isAvailable()).toBe(true);
    expect(crowd.isAvailable()).toBe(true);
  });

  it('getPrice returns correct result from available adapter', async () => {
    priceRegistry.registerAdapter(official);
    const result = await priceRegistry.getPrice('Milk', 'store_test');
    expect(result).not.toBeNull();
    expect(result!.price).toBeCloseTo(4.99, 2);
    expect(result!.source.adapterId).toBe('mock_official');
  });
});

describe('AC-10b: Registry Fallback', () => {
  let official: MockOfficialAdapter;
  let crowd: MockCrowdAdapter;

  beforeEach(() => {
    official = new MockOfficialAdapter();
    crowd = new MockCrowdAdapter();
  });

  it('falls back to crowd when official returns null', async () => {
    official.setPrice(null);
    priceRegistry.registerAdapter(official);
    priceRegistry.registerAdapter(crowd);

    const result = await priceRegistry.getPrice('Milk', 'store_test');
    expect(result).not.toBeNull();
    expect(result!.source.adapterId).toBe('mock_crowd');
    expect(result!.price).toBeCloseTo(3.49, 2);
  });

  it('returns null when all adapters return null or unavailable', async () => {
    official.setPrice(null);
    crowd.setAvailable(false);
    priceRegistry.registerAdapter(official);
    priceRegistry.registerAdapter(crowd);

    const result = await priceRegistry.getPrice('Milk', 'store_test');
    expect(result).toBeNull();
  });

  it('tries official first (tier order)', async () => {
    priceRegistry.registerAdapter(crowd);
    priceRegistry.registerAdapter(official);

    const result = await priceRegistry.getPrice('Milk', 'store_test');
    expect(result).not.toBeNull();
    expect(result!.source.adapterId).toBe('mock_official');
  });
});

describe('AC-10c: Adapter Enable/Disable', () => {
  let official: MockOfficialAdapter;
  let crowd: MockCrowdAdapter;

  beforeEach(() => {
    official = new MockOfficialAdapter();
    crowd = new MockCrowdAdapter();
  });

  it('skips disabled adapter', async () => {
    official.setPrice(null);
    priceRegistry.registerAdapter(official);
    priceRegistry.registerAdapter(crowd);

    // Disable crowd adapter
    await priceRegistry.setAdapterEnabled('mock_crowd', false);

    const result = await priceRegistry.getPrice('Milk', 'store_test');
    // official returns null, crowd is disabled → no result
    expect(result).toBeNull();
  });

  it('re-enables a previously disabled adapter', async () => {
    official.setPrice(null);
    priceRegistry.registerAdapter(official);
    priceRegistry.registerAdapter(crowd);

    await priceRegistry.setAdapterEnabled('mock_crowd', false);
    let result = await priceRegistry.getPrice('Milk', 'store_test');
    expect(result).toBeNull();

    // Re-enable
    await priceRegistry.setAdapterEnabled('mock_crowd', true);
    result = await priceRegistry.getPrice('Milk', 'store_test');
    expect(result).not.toBeNull();
    expect(result!.source.adapterId).toBe('mock_crowd');
  });

  it('AC-14 master gate: getPrice returns null and queries no adapter when pricing is not opted in', async () => {
    priceRegistry.registerAdapter(official);
    const spy = jest.spyOn(official, 'getPrice');

    mockSettings.pricingOptedIn = false;
    try {
      const result = await priceRegistry.getPrice('Milk', 'store_test');
      expect(result).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      mockSettings.pricingOptedIn = true;
      spy.mockRestore();
    }
  });

  it('AC-14 master gate: getAllPrices returns empty map and queries no adapter when pricing is not opted in', async () => {
    priceRegistry.registerAdapter(official);
    const spy = jest.spyOn(official, 'getPrices');

    mockSettings.pricingOptedIn = false;
    try {
      const results = await priceRegistry.getAllPrices(['Milk', 'Eggs'], 'store_test');
      expect(results.size).toBe(0);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      mockSettings.pricingOptedIn = true;
      spy.mockRestore();
    }
  });
});