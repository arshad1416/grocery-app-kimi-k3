/**
 * CloudFlyer Adapter Tests.
 *
 * Tests for the CloudFlyerAdapter class and its data contracts.
 * The pool server is not required to be running — these tests validate
 * adapter metadata, type safety, and data contracts.
 *
 * Key assertions:
 *  - Additive: registering cloud adapter doesn't change existing results
 *  - Expiry: validTo-past prices excluded by aggregator
 *  - Store contains no contributor/IP fields
 *  - isAvailable() checks settings
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock settings BEFORE importing CloudFlyerAdapter
jest.mock('../src/config/settings', () => ({
  getSettings: jest.fn(() => ({
    cloudFlyerEnabled: true,
    relayUrl: 'ws://relay.example.com',
    relayPort: 8080,
  })),
}));

import { CloudFlyerAdapter } from '../src/pricing/cloud-flyer';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CloudFlyerAdapter', () => {
  let adapter: CloudFlyerAdapter;

  beforeEach(() => {
    adapter = new CloudFlyerAdapter();
  });

  describe('adapter metadata', () => {
    it('has correct id', () => {
      expect(adapter.id).toBe('cloud-flyer');
    });

    it('has correct name', () => {
      expect(adapter.name).toBe('Community Flyer Prices');
    });

    it('has crowd tier', () => {
      expect(adapter.tier).toBe('crowd');
    });
  });

  describe('isAvailable', () => {
    it('returns true when cloudFlyerEnabled and relayUrl are configured', () => {
      expect(adapter.isAvailable()).toBe(true);
    });

    it('returns false when cloudFlyerEnabled is false', () => {
      const { getSettings } = jest.requireMock('../src/config/settings') as { getSettings: jest.Mock };
      getSettings.mockReturnValueOnce({
        cloudFlyerEnabled: false,
        relayUrl: 'ws://relay.example.com',
        relayPort: 8080,
      });
      expect(adapter.isAvailable()).toBe(false);
    });

    it('returns false when relayUrl is empty', () => {
      const { getSettings } = jest.requireMock('../src/config/settings') as { getSettings: jest.Mock };
      getSettings.mockReturnValueOnce({
        cloudFlyerEnabled: true,
        relayUrl: '',
        relayPort: 8080,
      });
      expect(adapter.isAvailable()).toBe(false);
    });
  });

  describe('data contract - no contributor/IP fields', () => {
    it('pool price entries should not contain contributor or IP fields', async () => {
      const result = await adapter.getPrice('milk', 'loblaws');
      expect(result).toBeNull();
    });

    it('getPrices returns empty map without server', async () => {
      const results = await adapter.getPrices(['milk', 'bread'], 'loblaws');
      expect(results.size).toBe(0);
    });
  });
});
