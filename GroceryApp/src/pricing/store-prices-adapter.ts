/**
 * StorePricesAdapter — PriceAdapter that queries store_prices from Turso.
 *
 * Provides regular shelf prices scraped from grocery store websites
 * (currently Loblaws Group: No Frills, Loblaws, Superstore).
 *
 * Registered in the price registry after FlippDealsAdapter so that
 * flyer deals (promotional/sale prices) take priority over shelf prices.
 *
 * Confidence mapping (based on scraped_at age):
 *   < 24 hours → real_time
 *   1-3 days   → recent
 *   3-7 days   → estimated
 *   > 7 days   → stale (skipped)
 *
 * Uses the same keyword matching as FlippDealsAdapter for consistency.
 */

import type { PriceAdapter } from './adapter';
import type { PriceResult, ConfidenceLevel, SaleInfo } from './types';
import { isTursoReady, getTurso } from '../services/tursoClient';

// ─── Types ──────────────────────────────────────────────────────────────────

interface StorePriceRow {
  id: number;
  store_id: string;
  store_name: string;
  name: string;
  name_clean: string;
  price: string;
  price_real: number | null;
  unit_price: string | null;
  unit_price_real: number | null;
  unit: string | null;
  image_url: string | null;
  brand: string | null;
  category: string | null;
  is_on_sale: number;
  sale_price: number | null;
  was_price: number | null;
  postal_code: string;
  scraped_at: string;
  source: string;
}

// ─── Keyword matching (mirrors FlippDealsAdapter) ───────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'without', 'fresh', 'frozen', 'organic', 'natural', 'premium',
  'value', 'selected', 'choice', 'best', 'plus', 'all', 'each', 'per',
  'pack', 'bag', 'box', 'bottle', 'can', 'jar', 'tub', 'tray', 'bunch',
  'kg', 'g', 'ml', 'l', 'oz', 'lb', 'litre', 'liter', 'gram', 'grams',
  'piece', 'pieces', 'count', 'size', 'large', 'medium', 'small',
  'grade', 'type', 'style', 'brand', 'save', 'caisse', 'chaque',
]);

// ─── Store ID normalization ──────────────────────────────────────────────
// FlippDealsAdapter normalizes store names to kebab-case (e.g. "no-frills"),
// but the scraper writes raw IDs (e.g. "nofrills"). This map converts
// Flipp-style IDs to scraper-style IDs for Turso queries.
const STORE_ID_MAP: Record<string, string> = {
  'no-frills': 'nofrills',
  'real-canadian-superstore': 'superstore',
  'loblaws': 'loblaws',
};

function normalizeStoreId(storeId: string): string {
  return STORE_ID_MAP[storeId] ?? storeId;
}

function extractKeywords(name: string): string[] {
  if (!name || typeof name !== 'string') return [];
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/** Score how well query tokens match product name tokens (0..1). */
function matchScore(queryTokens: string[], productTokens: string[]): number {
  if (queryTokens.length === 0 || productTokens.length === 0) return 0;
  let hits = 0;
  for (const qt of queryTokens) {
    for (const pt of productTokens) {
      if (qt === pt || pt.includes(qt) || qt.includes(pt)) {
        hits++;
        break;
      }
    }
  }
  // Require at least 2 token matches for multi-word queries
  if (hits < 2 && queryTokens.length > 1) return 0;
  return hits / queryTokens.length;
}

// ─── Confidence from scraped_at age ─────────────────────────────────────────

function scrapedConfidence(scrapedAt: string): ConfidenceLevel {
  if (!scrapedAt) return 'stale';
  const scraped = new Date(scrapedAt).getTime();
  if (isNaN(scraped)) return 'stale';
  const ageDays = (Date.now() - scraped) / (24 * 60 * 60 * 1000);
  if (ageDays < 1) return 'real_time';
  if (ageDays < 3) return 'recent';
  if (ageDays < 7) return 'estimated';
  return 'stale'; // > 7 days — don't use
}

// ─── Find best match ────────────────────────────────────────────────────────

function findBestMatch(
  itemName: string,
  rows: StorePriceRow[],
  threshold = 0.35,
): { row: StorePriceRow; score: number } | null {
  const queryTokens = extractKeywords(itemName);
  if (queryTokens.length === 0) return null;

  let best: { row: StorePriceRow; score: number } | null = null;

  for (const row of rows) {
    const productTokens = extractKeywords(row.name_clean || row.name);
    const score = matchScore(queryTokens, productTokens);
    if (
      score >= threshold &&
      (!best ||
        score > best.score ||
        (score === best.score &&
          (row.price_real ?? Infinity) < (best.row.price_real ?? Infinity)))
    ) {
      best = { row, score };
    }
  }

  return best;
}

// ─── Row to PriceResult ─────────────────────────────────────────────────────

function rowToPriceResult(row: StorePriceRow): PriceResult | null {
  const price = row.price_real ?? parseFloat(row.price);
  if (price === null || isNaN(price) || price <= 0) return null;

  const confidence = scrapedConfidence(row.scraped_at);
  if (confidence === 'stale') return null; // Too old

  const isOnSale = row.is_on_sale === 1;
  let saleInfo: SaleInfo | null = null;
  if (isOnSale && row.was_price && row.was_price > price) {
    const savingsPercent = Math.round(
      ((row.was_price - price) / row.was_price) * 100,
    );
    saleInfo = {
      isOnSale: true,
      salePrice: price,
      regularPrice: row.was_price,
      saleEndDate: null,
      unitPriceVsRegular: price - row.was_price, // negative = savings
      savingsPercent,
    };
  }

  return {
    price,
    unitPrice: row.unit_price_real ?? price,
    unit: row.unit ?? 'each',
    saleInfo,
    source: {
      adapterId: 'store-prices',
      tier: 'scraping',
      storeId: row.store_id,
      storeName: row.store_name,
    },
    timestamp: new Date(row.scraped_at).getTime(),
    confidence,
    imageUrl: row.image_url ?? undefined,
  };
}

// ─── Adapter ────────────────────────────────────────────────────────────────

export class StorePricesAdapter implements PriceAdapter {
  id = 'store-prices';
  name = 'Store Shelf Prices';
  tier = 'scraping' as const;

  /** Check if Turso is initialized and the store_prices table has data. */
  isAvailable(): boolean {
    return isTursoReady();
  }

  /**
   * Get the price for a single item at a given store.
   * Queries store_prices WHERE store_id matches, then fuzzy-matches
   * the item name using keyword intersection (same as FlippDealsAdapter).
   */
  async getPrice(
    itemName: string,
    storeId: string,
  ): Promise<PriceResult | null> {
    if (!this.isAvailable()) return null;

    try {
      const turso = getTurso();
      // Fetch recent prices for this store (last 7 days only)
      const result = await turso.execute(
        `SELECT * FROM store_prices
         WHERE store_id = ?
           AND scraped_at > datetime('now', '-7 days')
         ORDER BY scraped_at DESC
         LIMIT 200`,
        [normalizeStoreId(storeId)],
      );

      if (!result.rows || result.rows.length === 0) return null;

      const rows = result.rows.map((r: any[]) => this.mapRow(result.columns, r));
      const match = findBestMatch(itemName, rows);
      if (!match) return null;

      return rowToPriceResult(match.row);
    } catch (err) {
      console.warn('[store-prices-adapter] getPrice error:', err);
      return null;
    }
  }

  /**
   * Get prices for multiple items at a given store.
   * Single DB query, then matches each item name locally.
   */
  async getPrices(
    items: string[],
    storeId: string,
  ): Promise<Map<string, PriceResult>> {
    const results = new Map<string, PriceResult>();
    if (!this.isAvailable()) return results;

    try {
      const turso = getTurso();
      const dbResult = await turso.execute(
        `SELECT * FROM store_prices
         WHERE store_id = ?
           AND scraped_at > datetime('now', '-7 days')
         ORDER BY scraped_at DESC
         LIMIT 500`,
        [normalizeStoreId(storeId)],
      );

      if (!dbResult.rows || dbResult.rows.length === 0) return results;

      const rows = dbResult.rows.map((r: any[]) =>
        this.mapRow(dbResult.columns, r),
      );

      for (const itemName of items) {
        const match = findBestMatch(itemName, rows);
        if (!match) continue;

        const priceResult = rowToPriceResult(match.row);
        if (priceResult) {
          results.set(itemName, priceResult);
        }
      }
    } catch (err) {
      console.warn('[store-prices-adapter] getPrices error:', err);
    }

    return results;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Map a Turso row (array of column values) to a typed StorePriceRow object.
   * Uses the column names from the result to build the object.
   */
  private mapRow(columns: string[], values: any[]): StorePriceRow {
    const obj: any = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = values[i] ?? null;
    }
    return obj as StorePriceRow;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const storePricesAdapter = new StorePricesAdapter();
