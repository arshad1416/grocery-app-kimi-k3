/**
 * dealCache — in-memory session cache for Flipp flyer deal data.
 *
 * Prevents redundant Turso queries within a session.
 * Keyed by FSA prefix (e.g., "L0R").
 * Max 10 entries to stay lightweight.
 */

import type { FlippDealRow } from './dealMatcher';

const MAX_ENTRIES = 10;
const cache = new Map<string, FlippDealRow[]>();

export function getCachedDeals(fsa: string): FlippDealRow[] | undefined {
  return cache.get(fsa.slice(0, 3).toUpperCase());
}

export function setCachedDeals(fsa: string, deals: FlippDealRow[]): void {
  const key = fsa.slice(0, 3).toUpperCase();
  cache.set(key, deals);

  // Evict oldest if over limit
  if (cache.size > MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

export function clearDealCache(): void {
  cache.clear();
}
