/**
 * Product types for the barcode-based product lookup system.
 *
 * Two-tier model:
 *   KnownProduct — found in OFF/USDA/Turso (has name, brand, etc.)
 *   UnknownProduct — not found anywhere, user must enter details
 */

/** Data returned from any lookup source */
export interface ProductInfo {
  barcode: string;
  productName: string;
  brand?: string;
  category?: string;
  imageUrl?: string;
  quantityLabel?: string;   // "750 g", "1 L", "12 pcs"
  /** Which source returned this: 'open_food_facts' | 'usda' | 'turso' | 'cache' */
  source: ProductSource;
}

export type ProductSource = 'open_food_facts' | 'usda' | 'turso' | 'cache';

/** A price observation logged by a user */
export interface PriceObservation {
  barcode: string;
  price: number;
  storeName: string;
  storeId: string;
  quantity?: number;
  unit?: string;
  scannedAt: string;       // ISO 8601
  submittedBy: string;     // family member id
}

/** Raw form data submitted by user when a product isn't found */
export interface NewProductSubmission {
  barcode: string;
  rawName: string;
  brand?: string;
  category?: string;
  quantityLabel?: string;
  /** Optional price logged at the same time */
  price?: {
    amount: number;
    storeName: string;
    storeId: string;
  };
}

/** Cleaned version stored in Turso */
export interface CleanedProduct {
  barcode: string;
  productName: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  quantityLabel: string | null;
  source: Extract<ProductSource, 'turso'>;
  rawInput: string | null;
  aiCleaned: boolean;
  firstSeenAt: string;
  updatedAt: string;
}

/** Result of the complete scan -> lookup -> possibly-submit flow */
export type ScanResult =
  | { status: 'found'; product: ProductInfo }
  | { status: 'not_found'; barcode: string }
  | { status: 'lookup_error'; barcode: string; error: string };
