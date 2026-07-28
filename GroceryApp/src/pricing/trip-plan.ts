/**
 * Trip Plan — Optimal multi-stop shopping plan.
 *
 * Exact enumeration for ≤7 stores (2^7 = 128 subsets), greedy fallback
 * for larger sets. Pure on-device, <5ms for typical lists.
 */

import type { PriceResult } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TripPlanItem {
  itemId: string;
  itemName: string;
  quantity: number;
  price: number;
  unit: string;
}

export interface TripPlanStop {
  storeId: string;
  storeName: string;
  items: TripPlanItem[];
  subtotal: number;
}

export interface TripPlan {
  stops: TripPlanStop[];
  unassigned: TripPlanItem[];
  totalCost: number;
  savings: number;
  numStops: number;
}

// ─── Algorithm ──────────────────────────────────────────────────────────────

/**
 * Generate all subsets of `arr` up to size `maxSize`.
 * Returns subsets as arrays (including the empty set, which callers skip).
 */
function subsetsUpTo<T>(arr: T[], maxSize: number): T[][] {
  const result: T[][] = [];
  const n = arr.length;
  const limit = Math.min(maxSize, n);

  // Enumerate via bitmask (n ≤ 64 is fine for stores)
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset: T[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) subset.push(arr[i]);
    }
    if (subset.length <= limit) {
      result.push(subset);
    }
  }
  return result;
}

/**
 * Assign each item to the cheapest store in the given subset.
 * Returns { stops, unassigned, totalCost } for that subset.
 */
function evaluateSubset(
  items: { id: string; name: string; quantity: number; unit: string }[],
  storeIds: string[],
  perStorePrices: Record<string, Record<string, PriceResult>>,
  storeNameMap: Record<string, string>,
): { stops: TripPlanStop[]; unassigned: TripPlanItem[]; totalCost: number } {
  // Build per-store item assignments
  const storeItemMap: Record<string, TripPlanItem[]> = {};
  for (const sid of storeIds) {
    storeItemMap[sid] = [];
  }
  const unassigned: TripPlanItem[] = [];
  let totalCost = 0;

  for (const item of items) {
    let bestStoreId: string | null = null;
    let bestPrice = Infinity;

    for (const sid of storeIds) {
      const pr = perStorePrices[sid]?.[item.id];
      if (pr && pr.price < bestPrice) {
        bestPrice = pr.price;
        bestStoreId = sid;
      }
    }

    if (bestStoreId !== null && bestPrice < Infinity) {
      const tripItem: TripPlanItem = {
        itemId: item.id,
        itemName: item.name,
        quantity: item.quantity,
        price: bestPrice,
        unit: perStorePrices[bestStoreId]![item.id]!.unit,
      };
      storeItemMap[bestStoreId]!.push(tripItem);
      totalCost += bestPrice * item.quantity;
    } else {
      unassigned.push({
        itemId: item.id,
        itemName: item.name,
        quantity: item.quantity,
        price: 0,
        unit: item.unit || '',
      });
    }
  }

  const stops: TripPlanStop[] = storeIds
    .map((sid) => {
      const storeItems = storeItemMap[sid]!;
      const subtotal = storeItems.reduce(
        (sum, it) => sum + it.price * it.quantity,
        0,
      );
      return {
        storeId: sid,
        storeName: storeNameMap[sid] ?? sid,
        items: storeItems,
        subtotal,
      };
    })
    .filter((stop) => stop.items.length > 0); // Exclude empty stops

  return { stops, unassigned, totalCost };
}

/**
 * Compute the optimal trip plan.
 *
 * - If ≤7 available stores: exact enumeration of all subsets up to maxStops
 * - Otherwise: greedy fallback (same strategy as stop-optimizer)
 *
 * @param items  List items with id, name, quantity, unit
 * @param perStorePrices  storeId → itemId → PriceResult
 * @param maxStops  Maximum number of stops (default 5)
 * @param availableStores  Store IDs to consider
 * @param storeNameMap  storeId → display name
 */
export function computeTripPlan(
  items: { id: string; name: string; quantity: number; unit: string }[],
  perStorePrices: Record<string, Record<string, PriceResult>>,
  maxStops: number = 5,
  availableStores?: string[],
  storeNameMap: Record<string, string> = {},
): TripPlan {
  const storeIds =
    availableStores ?? Object.keys(perStorePrices);

  if (storeIds.length === 0 || items.length === 0) {
    return { stops: [], unassigned: items.map((it) => ({
      itemId: it.id,
      itemName: it.name,
      quantity: it.quantity,
      price: 0,
      unit: it.unit || '',
    })), totalCost: 0, savings: 0, numStops: 0 };
  }

  // Filter to stores that have at least one price for at least one item
  const relevantStores = storeIds.filter((sid) =>
    items.some((item) => perStorePrices[sid]?.[item.id]),
  );

  if (relevantStores.length === 0) {
    return {
      stops: [],
      unassigned: items.map((it) => ({
        itemId: it.id,
        itemName: it.name,
        quantity: it.quantity,
        price: 0,
        unit: it.unit || '',
      })),
      totalCost: 0,
      savings: 0,
      numStops: 0,
    };
  }

  const effectiveMaxStops = Math.min(maxStops, relevantStores.length);

  let bestResult: {
    stops: TripPlanStop[];
    unassigned: TripPlanItem[];
    totalCost: number;
  } | null = null;

  if (relevantStores.length <= 7) {
    // ── Exact enumeration ────────────────────────────────────────────────
    const allSubsets = subsetsUpTo(relevantStores, effectiveMaxStops);

    for (const subset of allSubsets) {
      const result = evaluateSubset(items, subset, perStorePrices, storeNameMap);
      if (!bestResult || result.totalCost < bestResult.totalCost) {
        bestResult = result;
      }
    }
  } else {
    // ── Greedy fallback ──────────────────────────────────────────────────
    // Start with the single best store, greedily add stores that reduce cost
    let bestSingleStoreId = relevantStores[0];
    let bestSingleCost = Infinity;

    for (const sid of relevantStores) {
      const result = evaluateSubset(items, [sid], perStorePrices, storeNameMap);
      if (result.totalCost < bestSingleCost) {
        bestSingleCost = result.totalCost;
        bestSingleStoreId = sid;
      }
    }

    const selected = new Set<string>([bestSingleStoreId]);
    bestResult = evaluateSubset(items, Array.from(selected), perStorePrices, storeNameMap);

    while (selected.size < effectiveMaxStops) {
      let bestCandidate: string | null = null;
      let bestCandidateCost = bestResult.totalCost;

      for (const sid of relevantStores) {
        if (selected.has(sid)) continue;
        const trial = new Set([...selected, sid]);
        const result = evaluateSubset(items, Array.from(trial), perStorePrices, storeNameMap);
        if (result.totalCost < bestCandidateCost) {
          bestCandidateCost = result.totalCost;
          bestCandidate = sid;
        }
      }

      if (bestCandidate === null) break;
      if (bestCandidateCost >= bestResult.totalCost) break;

      selected.add(bestCandidate);
      bestResult = evaluateSubset(items, Array.from(selected), perStorePrices, storeNameMap);
    }
  }

  // Compute savings: worst single-store cost minus optimized cost
  let worstSingleCost = 0;
  for (const item of items) {
    let maxPrice = 0;
    for (const sid of relevantStores) {
      const pr = perStorePrices[sid]?.[item.id];
      if (pr && pr.price > maxPrice) {
        maxPrice = pr.price;
      }
    }
    worstSingleCost += maxPrice * item.quantity;
  }

  const savings = worstSingleCost - bestResult!.totalCost;

  return {
    stops: bestResult!.stops,
    unassigned: bestResult!.unassigned,
    totalCost: bestResult!.totalCost,
    savings: Math.max(0, savings),
    numStops: bestResult!.stops.length,
  };
}
