/**
 * Stop Optimizer — multi-stop route proposals.
 *
 * Pure algorithm: given items and per-store prices, computes optimal
 * multi-stop shopping routes using a greedy expansion strategy.
 */

import type { PriceResult } from './types';

export interface StopProposal {
  numStops: number;
  stores: { storeId: string; storeName: string }[];
  totalCost: number;
  savingsVsOneStop: number;
}

/**
 * Compute multi-stop shopping proposals.
 *
 * Algorithm:
 * - Early return [] if < 2 stores have prices
 * - For each item, compute which stores have prices for it
 * - 1-stop proposal: cheapest overall store (same math as storeTotals)
 * - Greedy additions: for each remaining candidate, compute combined total
 *   using min price across selected stores + candidate, pick the best
 * - Return all proposals (one per step)
 */
export function computeStopProposals(
  items: { id: string; quantity: number }[],
  perStorePrices: Record<string, Record<string, PriceResult>>,
  storeNameMap: Record<string, string>,
): StopProposal[] {
  const storeIds = Object.keys(perStorePrices);
  if (storeIds.length < 2) return [];

  // For each item, determine which stores have prices for it
  const itemStoreMap: Record<string, string[]> = {};
  for (const item of items) {
    const stores: string[] = [];
    for (const storeId of storeIds) {
      if (perStorePrices[storeId]?.[item.id]) {
        stores.push(storeId);
      }
    }
    if (stores.length > 0) {
      itemStoreMap[item.id] = stores;
    }
  }

  // Helper: compute total cost across a set of stores (picking cheapest per item)
  function computeTotal(selectedStoreIds: string[]): number {
    let total = 0;
    for (const item of items) {
      const stores = itemStoreMap[item.id];
      if (!stores) continue;
      let bestPrice = Infinity;
      for (const storeId of selectedStoreIds) {
        if (stores.includes(storeId)) {
          const pr = perStorePrices[storeId]?.[item.id];
          if (pr && pr.price < bestPrice) {
            bestPrice = pr.price;
          }
        }
      }
      if (bestPrice < Infinity) {
        total += bestPrice * item.quantity;
      }
    }
    return total;
  }

  // Available stores (those that have at least some prices)
  const availableStoreIds = storeIds.filter((sid) =>
    items.some((item) => perStorePrices[sid]?.[item.id]),
  );

  if (availableStoreIds.length < 2) return [];

  // 1-stop proposal: find the single cheapest store
  let bestOneStopId = availableStoreIds[0];
  let bestOneStopCost = computeTotal([bestOneStopId]);
  for (const sid of availableStoreIds) {
    const cost = computeTotal([sid]);
    if (cost < bestOneStopCost) {
      bestOneStopCost = cost;
      bestOneStopId = sid;
    }
  }

  const proposals: StopProposal[] = [];
  const selected = new Set<string>([bestOneStopId]);
  proposals.push({
    numStops: 1,
    stores: [
      {
        storeId: bestOneStopId,
        storeName: storeNameMap[bestOneStopId] ?? bestOneStopId,
      },
    ],
    totalCost: bestOneStopCost,
    savingsVsOneStop: 0,
  });

  // Greedy additions: add the store that most reduces total cost
  while (selected.size < availableStoreIds.length) {
    let bestNextId: string | null = null;
    let bestCombinedCost = computeTotal(Array.from(selected));

    for (const sid of availableStoreIds) {
      if (selected.has(sid)) continue;
      const combined = new Set([...selected, sid]);
      const cost = computeTotal(Array.from(combined));
      if (cost < bestCombinedCost) {
        bestCombinedCost = cost;
        bestNextId = sid;
      }
    }

    if (bestNextId === null) break;
    if (bestCombinedCost >= proposals[proposals.length - 1].totalCost) break;

    selected.add(bestNextId);
    proposals.push({
      numStops: selected.size,
      stores: Array.from(selected).map((sid) => ({
        storeId: sid,
        storeName: storeNameMap[sid] ?? sid,
      })),
      totalCost: bestCombinedCost,
      savingsVsOneStop: bestOneStopCost - bestCombinedCost,
    });
  }

  return proposals;
}
