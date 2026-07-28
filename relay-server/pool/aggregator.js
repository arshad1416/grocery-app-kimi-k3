/**
 * Pool Server — Aggregator Functions.
 *
 * Pure math functions for price aggregation:
 *  - computeMedian(prices) — robust median calculation
 *  - rejectOutliers(prices) — discard values > 3σ from mean
 *  - aggregatePriceReports(prices) — returns { median, count, stdev }
 */

/**
 * Compute the median of a sorted or unsorted array of numbers.
 * Returns null for empty arrays.
 */
function computeMedian(prices) {
  if (!prices || prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Reject outliers using the 3-sigma (3 standard deviations) rule.
 * Discards any price more than 3σ from the mean.
 * Returns the filtered array. If fewer than 3 values, returns all values.
 */
function rejectOutliers(prices) {
  if (!prices || prices.length < 3) return [...(prices || [])];

  const n = prices.length;
  const mean = prices.reduce((s, p) => s + p, 0) / n;
  const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const threshold = 3 * stdev;

  return prices.filter((p) => Math.abs(p - mean) <= threshold);
}

/**
 * Aggregate price reports: reject outliers, compute median, count, and stdev.
 * Returns { median, count, stdev }.
 * If input is empty, returns { median: null, count: 0, stdev: null }.
 */
function aggregatePriceReports(prices) {
  if (!prices || prices.length === 0) {
    return { median: null, count: 0, stdev: null };
  }

  const cleaned = rejectOutliers(prices);
  const median = computeMedian(cleaned);
  const n = cleaned.length;

  let stdev = null;
  if (n >= 2) {
    const mean = cleaned.reduce((s, p) => s + p, 0) / n;
    const variance = cleaned.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
    stdev = Math.sqrt(variance);
  }

  return { median, count: n, stdev };
}

module.exports = { computeMedian, rejectOutliers, aggregatePriceReports };
