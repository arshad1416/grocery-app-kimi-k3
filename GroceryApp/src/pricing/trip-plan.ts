/**
 * Trip Plan — Optimal multi-stop shopping plan.
 *
 * Exact enumeration for ≤7 stores (2^7 = 128 subsets), greedy fallback
 * for larger sets. Pure on-device, <5ms for typical lists.
 *
 * Plans are compared coverage-first: a candidate that assigns more items
 * always beats one that assigns fewer, and cost breaks ties. (Comparing on
 * cost alone let cheaper subsets win by silently dropping items, since
 * unassigned items cost 0.)
 *
 * `savings` is the one-stop baseline: the cost of the best single-store
 * trip minus the optimized total, floored at 0 — the same comparison
 * stop-optimizer.ts reports as `savingsVsOneStop`. The baseline store is
 * chosen coverage-first too, so a store carrying one cheap item cannot
 * masquerade as the one-stop alternative.
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

  type SubsetResult = {
    stops: TripPlanStop[];
    unassigned: TripPlanItem[];
    totalCost: number;
  };

  // Coverage-first comparison: more assigned items wins; cost breaks ties.
  // (Comparing on cost alone let cheaper subsets win by silently dropping
  // items, since unassigned items cost 0.)
  const isBetterPlan = (a: SubsetResult, b: SubsetResult): boolean =>
    a.unassigned.length < b.unassigned.length ||
    (a.unassigned.length === b.unassigned.length && a.totalCost < b.totalCost);

  // One-stop baseline: the best single-store trip (coverage first, then
  // cost) — the same baseline stop-optimizer.ts uses for savingsVsOneStop.
  let bestOneStopId = relevantStores[0];
  let bestOneStop = evaluateSubset(items, [bestOneStopId], perStorePrices, storeNameMap);
  for (const sid of relevantStores.slice(1)) {
    const result = evaluateSubset(items, [sid], perStorePrices, storeNameMap);
    if (isBetterPlan(result, bestOneStop)) {
      bestOneStop = result;
      bestOneStopId = sid;
    }
  }

  let bestResult: SubsetResult | null = null;

  if (relevantStores.length <= 7) {
    // ── Exact enumeration ────────────────────────────────────────────────
    const allSubsets = subsetsUpTo(relevantStores, effectiveMaxStops);

    for (const subset of allSubsets) {
      const result = evaluateSubset(items, subset, perStorePrices, storeNameMap);
      if (!bestResult || isBetterPlan(result, bestResult)) {
        bestResult = result;
      }
    }
  } else {
    // ── Greedy fallback ──────────────────────────────────────────────────
    // Start with the best single store, greedily add stores that improve
    // the plan (more coverage, or equal coverage at lower cost).
    const selected = new Set<string>([bestOneStopId]);
    bestResult = bestOneStop;

    while (selected.size < effectiveMaxStops) {
      let bestCandidate: string | null = null;
      let bestCandidateResult: SubsetResult = bestResult;

      for (const sid of relevantStores) {
        if (selected.has(sid)) continue;
        const trial = new Set([...selected, sid]);
        const result = evaluateSubset(items, Array.from(trial), perStorePrices, storeNameMap);
        if (isBetterPlan(result, bestCandidateResult)) {
          bestCandidateResult = result;
          bestCandidate = sid;
        }
      }

      if (bestCandidate === null) break;

      selected.add(bestCandidate);
      bestResult = bestCandidateResult;
    }
  }

  // Savings vs. the best single-store trip, floored at 0 below. When the
  // plan covers items no single store carries, the baseline omits them, so
  // the figure is conservative rather than inflated.
  const savings = bestOneStop.totalCost - bestResult!.totalCost;

  return {
    stops: bestResult!.stops,
    unassigned: bestResult!.unassigned,
    totalCost: bestResult!.totalCost,
    savings: Math.max(0, savings),
    numStops: bestResult!.stops.length,
  };
}
