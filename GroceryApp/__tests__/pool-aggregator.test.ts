/**
 * Pool Aggregator Tests.
 *
 * Tests for the pure math functions: computeMedian, rejectOutliers, aggregatePriceReports.
 * These are duplicates/adaptations of the relay-server aggregator.js functions for TS test env.
 */

import { describe, it, expect } from '@jest/globals';

// ─── Pure Math Functions (duplicated from relay-server/pool/aggregator.js) ──

function computeMedian(prices: number[]): number | null {
  if (!prices || prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function rejectOutliers(prices: number[]): number[] {
  if (!prices || prices.length < 3) return [...(prices || [])];

  const n = prices.length;
  const mean = prices.reduce((s, p) => s + p, 0) / n;
  const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const threshold = 3 * stdev;

  return prices.filter((p) => Math.abs(p - mean) <= threshold);
}

interface AggResult {
  median: number | null;
  count: number;
  stdev: number | null;
}

function aggregatePriceReports(prices: number[]): AggResult {
  if (!prices || prices.length === 0) {
    return { median: null, count: 0, stdev: null };
  }

  const cleaned = rejectOutliers(prices);
  const median = computeMedian(cleaned);
  const n = cleaned.length;

  let stdev: number | null = null;
  if (n >= 2) {
    const mean = cleaned.reduce((s, p) => s + p, 0) / n;
    const variance = cleaned.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
    stdev = Math.sqrt(variance);
  }

  return { median, count: n, stdev };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('computeMedian', () => {
  it('returns median of [1,2,3,4,100] = 3', () => {
    expect(computeMedian([1, 2, 3, 4, 100])).toBe(3);
  });

  it('returns null for empty array', () => {
    expect(computeMedian([])).toBeNull();
  });

  it('returns the single value for single-element array', () => {
    expect(computeMedian([5])).toBe(5);
  });

  it('returns average of two middle values for even-length array', () => {
    expect(computeMedian([3, 7])).toBe(5);
  });

  it('works with unsorted input', () => {
    expect(computeMedian([10, 1, 5])).toBe(5);
  });
});

describe('rejectOutliers', () => {
  it('rejects extreme outliers beyond 3σ from mean', () => {
    // [1,1,1,1,1,1,1,1,1,10000]:
    // mean ≈ 1000.9, stdev ≈ 2999, 3σ ≈ 8997
    // |10000 - 1000.9| = 8999 > 8997 → rejected
    const result = rejectOutliers([1, 1, 1, 1, 1, 1, 1, 1, 1, 10000]);
    expect(result).not.toContain(10000);
    expect(result.length).toBe(9);
    expect(result.every((v) => v === 1)).toBe(true);
  });

  it('keeps values within 3σ of mean', () => {
    // [1,2,3,4,100]: stdev ≈ 39, 3σ ≈ 117, |100-22|=78 ≤ 117 → kept
    const result = rejectOutliers([1, 2, 3, 4, 100]);
    expect(result).toEqual([1, 2, 3, 4, 100]);
  });

  it('returns all values for fewer than 3 items', () => {
    expect(rejectOutliers([5])).toEqual([5]);
    expect(rejectOutliers([3, 7])).toEqual([3, 7]);
  });

  it('returns empty array for empty input', () => {
    expect(rejectOutliers([])).toEqual([]);
  });
});

describe('aggregatePriceReports', () => {
  it('returns correct stats for [1,2,3,4,100] — no outlier rejection with small dataset', () => {
    const result = aggregatePriceReports([1, 2, 3, 4, 100]);
    // 100 is not rejected because 3σ threshold includes it with small n
    expect(result.median).toBe(3.0);
    expect(result.count).toBe(5);
    expect(result.stdev).not.toBeNull();
  });

  it('returns null median and stdev for empty array', () => {
    const result = aggregatePriceReports([]);
    expect(result.median).toBeNull();
    expect(result.count).toBe(0);
    expect(result.stdev).toBeNull();
  });

  it('returns median but null stdev for single value', () => {
    const result = aggregatePriceReports([5]);
    expect(result.median).toBe(5);
    expect(result.count).toBe(1);
    expect(result.stdev).toBeNull();
  });

  it('rejects extreme outliers with large data spread', () => {
    const result = aggregatePriceReports([1, 1, 1, 1, 1, 1, 1, 1, 1, 10000]);
    expect(result.median).toBe(1);
    expect(result.count).toBe(9);
    expect(result.stdev).not.toBeNull();
  });
});
