/**
 * Trip Plan Cache — in-memory LRU with 5-minute TTL.
 *
 * Caches computed TripPlan results keyed by a deterministic hash of
 * { maxStops, itemIds, storeIds }.
 */

import type { TripPlan } from './trip-plan';

// ─── Cache Shape ────────────────────────────────────────────────────────────

interface CacheEntry {
  key: string;
  plan: TripPlan;
  timestamp: number;
}

const MAX_ENTRIES = 5;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

let cache: CacheEntry[] = [];

// ─── Key Generation ─────────────────────────────────────────────────────────

export interface TripPlanCacheKey {
  maxStops: number;
  itemIds: string[];
  storeIds: string[];
  /** Quantity per item ID — ensures cache is invalidated when quantities change. */
  quantities: Record<string, number>;
}

/**
 * Build a deterministic cache key. Item and store IDs are sorted to ensure
 * identical inputs always produce the same key regardless of order.
 */
export function buildCacheKey(
  maxStops: number,
  itemIds: string[],
  storeIds: string[],
  quantities: Record<string, number>,
): TripPlanCacheKey {
  return {
    maxStops,
    itemIds: [...itemIds].sort(),
    storeIds: [...storeIds].sort(),
    quantities,
  };
}

function keyToString(key: TripPlanCacheKey): string {
  return JSON.stringify(key);
}

// ─── Cache Operations ───────────────────────────────────────────────────────

/**
 * Retrieve a cached plan if it exists and hasn't expired.
 */
export function getCachedPlan(key: TripPlanCacheKey): TripPlan | null {
  const str = keyToString(key);
  const idx = cache.findIndex((e) => e.key === str);
  if (idx === -1) return null;

  const entry = cache[idx]!;
  if (Date.now() - entry.timestamp > TTL_MS) {
    // Expired — remove
    cache.splice(idx, 1);
    return null;
  }

  // Move to front (most recently used)
  if (idx > 0) {
    cache.splice(idx, 1);
    cache.unshift(entry);
  }

  return entry.plan;
}

/**
 * Store a plan in the cache. Evicts the least recently used entry if full.
 */
export function setCachedPlan(key: TripPlanCacheKey, plan: TripPlan): void {
  const str = keyToString(key);

  // Remove existing entry for this key (if any)
  cache = cache.filter((e) => e.key !== str);

  // Prepend new entry
  cache.unshift({ key: str, plan, timestamp: Date.now() });

  // Evict oldest entries beyond capacity
  while (cache.length > MAX_ENTRIES) {
    cache.pop();
  }
}

/**
 * Invalidate the entire cache (e.g., when prices change).
 */
export function invalidateCache(): void {
  cache = [];
}
