/**
 * Acceptance Test AC-9: Sales Detection
 *
 * Tests:
 * - detectSale with obvious savings (unit price lower than recent avg)
 * - detectSale with fake markdown (unit price higher than recent avg)
 * - detectSale with no history → returns null
 * - SaleInfo calculations: savingsPercent, unitPriceVsRegular
 *
 * Run: npx jest __tests__/ac9-sales.test.ts
 */

import { describe, it, expect } from '@jest/globals';
import { detectSale } from '../src/pricing/normalizer';

// ─── Sale Detection Tests ───────────────────────────────────────────────────

describe('AC-9: Sales — detectSale', () => {
  it('returns null when no recent price history', () => {
    const result = detectSale(4.99, 2.5, []);
    expect(result).toBeNull();
  });

  it('detects genuine sale when current price is lower', () => {
    // Recent prices: $2.00/100g, $2.10/100g, $1.90/100g → avg ~$2.00/100g
    // Current: $1.50/100g → 25% savings
    const result = detectSale(2.99, 1.5, [2.0, 2.1, 1.9]);

    expect(result).not.toBeNull();
    expect(result!.isOnSale).toBe(true);
    expect(result!.unitPriceVsRegular).toBeLessThan(0);
    expect(result!.savingsPercent).toBeCloseTo(25, 0);
  });

  it('detects fake markdown when unit price is higher', () => {
    // Recent prices: $2.00/100g — current: $3.00/100g → unitPriceVsRegular > 0
    const result = detectSale(5.99, 3.0, [2.0]);

    expect(result).not.toBeNull();
    expect(result!.isOnSale).toBe(true);
    expect(result!.unitPriceVsRegular).toBeGreaterThan(0);
    expect(result!.savingsPercent).toBeLessThan(0);
  });

  it('returns non-sale when price matches regular', () => {
    // Recent prices average = $2.00/100g, current = $2.00/100g
    const result = detectSale(4.0, 2.0, [2.0, 2.0]);

    expect(result).not.toBeNull();
    expect(result!.isOnSale).toBe(false);
    expect(result!.unitPriceVsRegular).toBeCloseTo(0, 1);
    expect(result!.savingsPercent).toBe(0);
  });

  it('detects large savings correctly', () => {
    // Regular ~$5.00/100g, current $3.00/100g → 40% off
    const result = detectSale(3.0, 3.0, [5.0, 5.0, 5.0]);

    expect(result).not.toBeNull();
    expect(result!.isOnSale).toBe(true);
    expect(result!.savingsPercent).toBeCloseTo(40, 0);
    expect(result!.unitPriceVsRegular).toBeCloseTo(-2.0, 1);
  });

  it('calculates unitPriceVsRegular correctly for fake sales', () => {
    // Regular $2.00/100g, current $3.00/100g → unitPriceVsRegular = +1.0
    const result = detectSale(6.0, 3.0, [2.0]);

    expect(result).not.toBeNull();
    expect(result!.unitPriceVsRegular).toBeCloseTo(1.0, 1);
    expect(result!.savingsPercent).toBeLessThan(0);
  });

  it('does not flag as fake sale when unitPrice equals regular', () => {
    // unit price equals the average → not on sale
    const result = detectSale(5.0, 2.5, [2.5, 2.5]);

    expect(result).not.toBeNull();
    expect(result!.isOnSale).toBe(false);
    expect(result!.unitPriceVsRegular).toBeCloseTo(0, 1);
  });

  it('handles single price in history', () => {
    // Only one historical price point
    const result = detectSale(3.0, 1.5, [2.0]);

    expect(result).not.toBeNull();
    expect(result!.isOnSale).toBe(true);
    expect(result!.savingsPercent).toBeCloseTo(25, 0);
  });

  it('handles zero price gracefully', () => {
    const result = detectSale(0, 0, [2.0]);
    expect(result).not.toBeNull();
    expect(result!.isOnSale).toBe(true);
    // Savings percent will be 100% since avgRecent > 0 and unitPrice = 0
    expect(result!.savingsPercent).toBeCloseTo(100, 0);
  });
});