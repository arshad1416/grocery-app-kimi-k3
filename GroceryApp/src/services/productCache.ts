/**
 * ProductCache — in-memory session cache for scanned products.
 *
 * The real persistence layer is Turso. This cache exists only to
 * avoid duplicate API calls within the same app session.
 *
 * Cache is automatically evicted on app restart (which is fine —
 * Turso re-queries are fast via the HTTP API).
 */

import type { ProductInfo } from '../types/product';

// ─── In-Memory Store ─────────────────────────────────────────────────────────

const _cache = new Map<string, ProductInfo>();
const MAX_ENTRIES = 200;

// ─── Public API ──────────────────────────────────────────────────────────────

export function getCachedProduct(barcode: string): ProductInfo | null {
  const value = _cache.get(barcode);
  if (value !== undefined) {
    // Re-insert to move this key to the end of the Map (true LRU behavior)
    _cache.delete(barcode);
    _cache.set(barcode, value);
  }
  return value ?? null;
}

export function setCachedProduct(product: ProductInfo): void {
  // Eviction: if over limit, delete least-recently-used (oldest key in Map)
  if (_cache.size >= MAX_ENTRIES) {
    const oldestKey = _cache.keys().next().value;
    if (oldestKey !== undefined) _cache.delete(oldestKey);
  }
  _cache.set(product.barcode, product);
}

/** Prime the cache with known products (e.g., quick-add items). */
export function primeCache(products: ProductInfo[]): void {
  for (const p of products) {
    if (!_cache.has(p.barcode)) {
      setCachedProduct(p);
    }
  }
}

export function clearCache(): void {
  _cache.clear();
}

export function cacheSize(): number {
  return _cache.size;
}
