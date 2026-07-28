/**
 * Price Subsystem — Instacart Adapter (Stub).
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                    SETUP INSTRUCTIONS                           ║
 * ║                                                                 ║
 * ║ To enable Instacart pricing:                                    ║
 * ║                                                                 ║
 * ║ 1. Register a business account at:                              ║
 * ║    https://developers.instacart.com/                            ║
 * ║                                                                 ║
 * ║ 2. Business registration typically takes ~30-40 days for        ║
 * ║    approval.                                                    ║
 * ║                                                                 ║
 * ║ 3. Once approved, you'll receive:                               ║
 * ║    - API Client ID                                              ║
 * ║    - API Client Secret                                          ║
 * ║                                                                 ║
 * ║ 4. Set the following in your environment or settings:           ║
 * ║    INSTACART_API_KEY=your_client_id                             ║
 * ║    INSTACART_API_SECRET=your_client_secret                      ║
 * ║                                                                 ║
 * ║ 5. This adapter checks for INSTACART_API_KEY in settings.       ║
 * ║    It will return null if the key is not configured.            ║
 * ║                                                                 ║
 * ║ API Docs: https://docs.instacart.com/                           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import type { PriceAdapter } from './adapter';
import type { PriceResult, PriceSourceTier } from './types';
import { getSettings } from '../config/settings';

// The key name stored in settings for the Instacart API key
const INSTACART_API_KEY_SETTING = 'instacartApiKey';

export class InstacartAdapter implements PriceAdapter {
  id = 'instacart';
  name = 'Instacart';
  tier: PriceSourceTier = 'official';

  isAvailable(): boolean {
    try {
      const settings = getSettings();
      const apiKey = (settings as any)[INSTACART_API_KEY_SETTING] as string | undefined;
      return !!apiKey;
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
        'Instacart API not configured — requires business registration (~30-40 day approval). ' +
        'Set INSTACART_API_KEY in settings to enable.',
      );
      return null;
    }

    // TODO: Implement actual Instacart API call
    // This requires:
    //   1. OAuth2 token exchange with client_id + client_secret
    //   2. Instacart's /v1/catalog/items endpoint
    //   3. Proper rate limiting & caching
    console.log('Instacart API call not yet implemented');
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

export const instacartAdapter = new InstacartAdapter();