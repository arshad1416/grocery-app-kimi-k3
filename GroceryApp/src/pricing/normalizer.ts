/**
 * Price Subsystem — Unit Price Normalizer & Sale Detector.
 *
 * Normalizes prices to standard display units (per 100g, per 100mL, per unit)
 * and detects sales by comparing against recent price history.
 */

import type { SaleInfo } from './types';

// ─── Unit Normalization ─────────────────────────────────────────────────────

/**
 * Normalize a price to a standard display unit.
 *
 * Rules:
 * - kg / g → price per 100g
 * - L / mL → price per 100mL
 * - each / ea → price per unit
 * - otherwise → price per unit
 */
export function normalizeUnitPrice(
  price: number,
  quantity: number,
  unit: string,
): { unitPrice: number; displayUnit: string } {
  const unitLower = unit.toLowerCase();

  if (unitLower === 'kg') {
    // price for `quantity` kg → per 100g
    const perKg = price / quantity;
    return { unitPrice: perKg / 10, displayUnit: '/100g' };
  }

  if (unitLower === 'g') {
    // price for `quantity` grams → per 100g
    const perGram = price / quantity;
    return { unitPrice: perGram * 100, displayUnit: '/100g' };
  }

  if (unitLower === 'l') {
    // price for `quantity` L → per 100mL
    const perLiter = price / quantity;
    return { unitPrice: perLiter / 10, displayUnit: '/100mL' };
  }

  if (unitLower === 'ml') {
    // price for `quantity` mL → per 100mL
    const perMl = price / quantity;
    return { unitPrice: perMl * 100, displayUnit: '/100mL' };
  }

  if (unitLower === 'each' || unitLower === 'ea') {
    // price per unit
    return { unitPrice: price / quantity, displayUnit: '/ea' };
  }

  // Fallback: price per unit
  return { unitPrice: price / quantity, displayUnit: '/' + unit };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format a unit price to display string, e.g. "$1.50/100g"
 */
export function formatUnitPrice(
  unitPrice: number,
  displayUnit: string,
): string {
  return `$${unitPrice.toFixed(2)}${displayUnit}`;
}

// ─── Sale Detection ─────────────────────────────────────────────────────────

/**
 * Detect whether a price is a sale (good or fake) by comparing against
 * recent price history.
 *
 * @param price - Current total/display price
 * @param unitPrice - Current normalized unit price
 * @param recentPrices - Array of recent normalized unit prices
 * @returns SaleInfo or null if no history available
 */
export function detectSale(
  price: number,
  unitPrice: number,
  recentPrices: number[],
): SaleInfo | null {
  if (recentPrices.length === 0) return null;

  // Calculate average of recent prices (excluding current)
  const avgRecent =
    recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length;

  const unitPriceVsRegular = unitPrice - avgRecent;

  if (unitPrice < avgRecent) {
    // Current price is lower → genuine sale
    const savingsPercent =
      avgRecent > 0
        ? Math.round(((avgRecent - unitPrice) / avgRecent) * 100)
        : 0;

    return {
      isOnSale: true,
      salePrice: price,
      regularPrice: price * (avgRecent / unitPrice), // estimated regular total price
      saleEndDate: null, // unknown
      unitPriceVsRegular, // negative = savings
      savingsPercent,
    };
  }

  if (unitPrice > avgRecent && unitPriceVsRegular > 0) {
    // Current price is higher → fake markdown
    const fakePercent = Math.round(
      ((unitPrice - avgRecent) / avgRecent) * 100,
    );

    return {
      isOnSale: true, // still "on sale" in the UI sense, but flagged
      salePrice: price,
      regularPrice: price * (avgRecent / unitPrice), // estimated regular total price, avoiding percent-precision loss
      saleEndDate: null,
      unitPriceVsRegular, // positive = fake markdown
      savingsPercent: -fakePercent, // negative savings = bad deal
    };
  }

  // Price is roughly at regular level
  return {
    isOnSale: false,
    salePrice: price,
    regularPrice: price,
    saleEndDate: null,
    unitPriceVsRegular: 0,
    savingsPercent: 0,
  };
}