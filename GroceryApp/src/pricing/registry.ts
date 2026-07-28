/**
 * Price Subsystem — Adapter Registry.
 *
 * Manages the chain of price adapters with fallback:
 *   official → crowd → scraping
 *
 * Each adapter can be individually enabled/disabled by the user via Settings.
 * The enabled state is stored in encrypted settings.
 */

import type { PriceAdapter } from './adapter';
import type { PriceResult } from './types';
import { getSettings, updateSettings } from '../config/settings';
import { adapterRequiresHash, normalizeForLookup, hashItemName } from './privacy';
import { instacartAdapter } from './instacart';
import { scrapingAdapter } from './scraping';
import { crowdsourcedAdapter } from './crowdsourced';
import { cloudFlyerAdapter } from './cloud-flyer';
import { flyerScanAdapter } from './flyer-scan';
import { flippDealsAdapter } from './flipp-deals-adapter';
import { storePricesAdapter } from './store-prices-adapter';

// ─── Types ─────────────────────────────────────────────────────────────────

export type AdapterEnableMap = Record<string, boolean>;

// ─── Registry ───────────────────────────────────────────────────────────────

class PriceRegistry {
  private adapters: PriceAdapter[] = [];

  constructor() {
    this.registerAdapter(instacartAdapter);
    this.registerAdapter(scrapingAdapter);
    this.registerAdapter(crowdsourcedAdapter);
    this.registerAdapter(cloudFlyerAdapter);
    this.registerAdapter(flyerScanAdapter);
    this.registerAdapter(flippDealsAdapter);
    this.registerAdapter(storePricesAdapter);
  }

  private seedPromise: Promise<void> | null = null;

  /**
   * Register a price adapter.
   * After registration, the registry is re-sorted by tier priority.
   */
  registerAdapter(adapter: PriceAdapter): void {
    const existing = this.adapters.findIndex((a) => a.id === adapter.id);
    if (existing >= 0) {
      this.adapters[existing] = adapter;
    } else {
      this.adapters.push(adapter);
    }
    this.sortByTier();
  }

  /**
   * Get price for a single item.
   * Tries adapters in order (official → crowd → scraping),
   * returns the first non-null result.
   */
  async getPrice(
    itemName: string,
    storeId: string,
  ): Promise<PriceResult | null> {
    if (!this.isPricingOptedIn()) return null;
    if (this.seedPromise) await this.seedPromise;
    const enabled = this.getEnabledMap();
    const normalizedName = normalizeForLookup(itemName);
    for (const adapter of this.adapters) {
      if (!enabled[adapter.id] || !adapter.isAvailable()) continue;
      const lookupName = adapterRequiresHash(adapter.id)
        ? hashItemName(itemName)
        : normalizedName;
      const result = await adapter.getPrice(lookupName, storeId);
      if (result !== null) return result;
    }
    return null;
  }

  /**
   * Get prices for multiple items.
   */
  async getAllPrices(
    items: string[],
    storeId: string,
  ): Promise<Map<string, PriceResult>> {
    if (!this.isPricingOptedIn()) return new Map();
    if (this.seedPromise) await this.seedPromise;
    const results = new Map<string, PriceResult>();
    const enabled = this.getEnabledMap();
    const normalizedNames = items.map(normalizeForLookup);

    for (const adapter of this.adapters) {
      if (!enabled[adapter.id] || !adapter.isAvailable()) continue;

      const useHash = adapterRequiresHash(adapter.id);
      const lookupNames = useHash
        ? items.map(hashItemName)
        : normalizedNames;

      const batch = await adapter.getPrices(lookupNames, storeId);
      // Map results back to original item names
      for (let i = 0; i < items.length; i++) {
        const lookupKey = lookupNames[i];
        const originalName = items[i];
        const priceResult = batch.get(lookupKey);
        if (priceResult && !results.has(originalName)) {
          results.set(originalName, priceResult);
        }
      }
    }
    return results;
  }

  /**
   * Get all registered adapters (useful for Settings UI).
   */
  getAvailableAdapters(): PriceAdapter[] {
    return [...this.adapters];
  }

  /**
   * Enable or disable a specific adapter by ID.
   * State is persisted to encrypted settings.
   */
  async setAdapterEnabled(
    id: string,
    enabled: boolean,
  ): Promise<void> {
    const settings = getSettings();
    const adapterStates = { ...(settings.adapterEnabled ?? {} as AdapterEnableMap) };
    adapterStates[id] = enabled;
    await updateSettings({ adapterEnabled: adapterStates });
  }

  /**
   * Check if an adapter is enabled in settings.
   * Defaults to true if not explicitly set.
   */
  isAdapterEnabled(id: string): boolean {
    const settings = getSettings();
    const states = settings.adapterEnabled;
    if (states && id in states) {
      return states[id];
    }
    return true; // enabled by default
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  /**
   * Master privacy gate (AC-14): no price lookup — local or network — runs
   * unless the user has explicitly opted into pricing. Fails closed when
   * settings aren't initialized yet.
   */
  private isPricingOptedIn(): boolean {
    try {
      return getSettings().pricingOptedIn === true;
    } catch {
      return false;
    }
  }

  private getEnabledMap(): AdapterEnableMap {
    let states: Record<string, boolean> | undefined;
    try {
      states = getSettings().adapterEnabled;
    } catch {
      // Settings not initialized yet — all adapters default to enabled
    }
    const map: AdapterEnableMap = {};
    for (const adapter of this.adapters) {
      const enabled = states ? states[adapter.id] : true;
      map[adapter.id] = enabled !== false;
    }
    return map;
  }

  private sortByTier(): void {
    const tierOrder: Record<string, number> = {
      official: 0,
      flyer: 1,
      crowd: 2,
      scraping: 3,
    };
    this.adapters.sort(
      (a, b) => (tierOrder[a.tier] ?? 99) - (tierOrder[b.tier] ?? 99),
    );
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const priceRegistry = new PriceRegistry();