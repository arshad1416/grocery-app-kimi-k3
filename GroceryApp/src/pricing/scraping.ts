/**
 * Price Subsystem — Scraping Adapter (Self-Host Only).
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ ⚠️  LEGAL: Web scraping may violate Terms of Service.          ║
 * ║                                                                ║
 * ║ This adapter is intended for SELF-HOSTED deployments only.     ║
 * ║ Do NOT enable in the managed tier.                             ║
 * ║                                                                ║
 * ║ Before enabling scraping:                                      ║
 * ║   1. Review target websites' robots.txt and ToS                ║
 * ║   2. Consult legal counsel if needed                           ║
 * ║   3. Limit request rate to avoid overloading servers           ║
 * ║   4. Respect caching headers (Cache-Control, ETag)             ║
 * ║                                                                ║
 * ║ This is a PLACEHOLDER — no actual scraping is implemented.     ║
 * ║ It returns null for all price lookups with a warning log.      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import type { PriceAdapter } from './adapter';
import type { PriceResult, PriceSourceTier } from './types';
import { getSettings } from '../config/settings';

// Settings key for scraping enabled flag
const SCRAPING_ENABLED_KEY = 'scrapingEnabled';

export class ScrapingAdapter implements PriceAdapter {
  id = 'scraping';
  name = 'Scraping';
  tier: PriceSourceTier = 'scraping';

  isAvailable(): boolean {
    try {
      const settings = getSettings();
      const enabled = (settings as any)[SCRAPING_ENABLED_KEY] as boolean | undefined;
      return enabled === true;
    } catch {
      return false;
    }
  }

  async getPrice(
    _itemName: string,
    _storeId: string,
  ): Promise<PriceResult | null> {
    if (!this.isAvailable()) {
      console.log(
        'Scraping tier is not enabled. Enable in Settings with caution — ' +
        'web scraping may violate website Terms of Service.',
      );
      return null;
    }

    console.log(
      'Scraping adapter placeholder — no actual scraping implemented. ' +
      'Full implementation requires careful per-site adapter design and legal review.',
    );
    return null;
  }

  async getPrices(
    items: string[],
    storeId: string,
  ): Promise<Map<string, PriceResult>> {
    const results = new Map<string, PriceResult>();
    for (const item of items) {
      const price = await this.getPrice(item, storeId);
      if (price) {
        results.set(item, price);
      }
    }
    return results;
  }
}

export const scrapingAdapter = new ScrapingAdapter();