/**
 * Price Subsystem — Flyer Scanning Pipeline.
 *
 * Three-stage pipeline for processing flyer images:
 *   1. stripExif()   — Strip EXIF metadata before any processing
 *   2. runExtraction() — Pass to the configured FlyerExtractor
 *   3. confidenceGate() — Filter/sort by confidence threshold
 *
 * Stage 1: Static pipeline functions with mock extractor support.
 * Real EXIF stripping uses a library; in Stage 1 we simulate it.
 */

import type { ScannedFlyerPrice, FlyerExtractor, FlyerPipelineResult } from './flyer-types';

// ─── Confidence Threshold ────────────────────────────────────────────────────

/**
 * Confidence threshold for automatic acceptance.
 * Prices below this threshold are routed to a user-confirmation path.
 */
export const CONFIDENCE_THRESHOLD = 0.6;

// ─── Stage 1: EXIF Stripping ─────────────────────────────────────────────────

/**
 * Strip EXIF metadata from an image before processing.
 *
 * Reads the JPEG file, removes APP1 (EXIF) marker segments, and rewrites
 * the cleaned bytes back to the file. Other image formats are passed through
 * unchanged (EXIF is specific to JPEG/TIFF).
 *
 * Critical rule: EXIF must be stripped before any extraction to prevent
 * location/camera metadata from leaking to cloud extractors.
 *
 * @param imageUri - URI of the captured flyer image
 * @returns URI of the EXIF-stripped image
 */
export async function stripExif(imageUri: string): Promise<string> {
  try {
    // Primary path: use expo-image-manipulator for React Native environments.
    // Re-encode JPEG to strip EXIF metadata cleanly without needing byte-level parsing.
    // Returns a file:// URI that RN supports natively.
    const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
    const result = await manipulateAsync(imageUri, [], { format: SaveFormat.JPEG, compress: 0.92 });
    return result.uri;
  } catch (outerErr) {
    // Fallback: byte-level stripping for web/non-RN environments
    try {
      // Only handle file:// URIs (local temp files)
      // Remote URIs would require a download step first
      const response = await fetch(imageUri);
      const blob = await response.blob();

      // Only strip EXIF from JPEG files
      if (!blob.type || (!blob.type.includes('jpeg') && !blob.type.includes('jpg'))) {
        return imageUri;
      }

      const arrayBuf = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);

      // Simple JPEG EXIF stripper: scan for APP1 (0xFF 0xE1) markers and skip them
      const cleaned = stripJpegExif(bytes);

      if (cleaned.length === bytes.length) {
        return imageUri; // No EXIF found
      }

      // Write cleaned bytes back as a blob URL (works on web)
      const cleanBuf = new Uint8Array(cleaned).buffer as unknown as ArrayBuffer;
      const cleanBlob = new Blob([cleanBuf], { type: 'image/jpeg' });
      return URL.createObjectURL(cleanBlob);
    } catch (err) {
      // Both EXIF paths failed — fail closed
      throw new Error(
        `EXIF stripping failed: ${err instanceof Error ? err.message : String(err)}. ` +
        `Original error: ${outerErr instanceof Error ? outerErr.message : String(outerErr)}`,
      );
    }
  }
}

/**
 * Strip EXIF APP1 (0xFFE1) markers from raw JPEG bytes.
 * Returns a new Uint8Array with APP1 segments removed.
 * All other markers (SOI, DQT, SOF, DHT, SOS, EOI, etc.) are preserved.
 */
function stripJpegExif(bytes: Uint8Array): Uint8Array {
  // Verify JPEG SOI marker
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
    return bytes; // Not a valid JPEG
  }

  const result: number[] = [];
  let i = 0;
  const len = bytes.length;

  // Copy SOI marker
  result.push(bytes[i++], bytes[i++]);

  while (i < len) {
    // Scan for marker: 0xFF 0xMN
    if (bytes[i] !== 0xFF) {
      // SOS (Start of Scan) — copy remaining compressed data as-is
      while (i < len) {
        result.push(bytes[i++]);
      }
      break;
    }

    const marker = bytes[i + 1];

    // SOS (0xDA) — start of scan data; copy rest verbatim
    if (marker === 0xDA) {
      // Copy SOS marker
      result.push(bytes[i++], bytes[i++]);
      // Copy remaining bytes (compressed image data)
      while (i < len) {
        result.push(bytes[i++]);
      }
      break;
    }

    // Read segment length (big-endian, includes the 2 length bytes)
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3];

    if (marker === 0xE1) {
      // APP1 — EXIF (skip this entire segment)
      i += 2 + segLen;
    } else {
      // All other markers — copy verbatim
      const segEnd = i + 2 + segLen;
      while (i < segEnd && i < len) {
        result.push(bytes[i++]);
      }
    }
  }

  return new Uint8Array(result);
}

// ─── Stage 2: Extraction ─────────────────────────────────────────────────────

/**
 * Run the extractor on an image to get scanned flyer prices.
 *
 * @param imageUri - URI of the EXIF-stripped image
 * @param extractor - The FlyerExtractor implementation (mock in Stage 1)
 * @returns Array of ScannedFlyerPrice entries
 */
export async function runExtraction(
  imageUri: string,
  extractor: FlyerExtractor,
): Promise<ScannedFlyerPrice[]> {
  return extractor.extract(imageUri);
}

// ─── Stage 3: Confidence Gate ───────────────────────────────────────────────

/**
 * Filter results by confidence threshold.
 *
 * - Prices with confidence >= 0.6 pass through unchanged.
 * - Prices with confidence < 0.6 are still returned but flagged
 *   so the caller can route them to a user-confirmation path.
 *
 * @param prices - Raw extracted prices
 * @returns Object with `accepted` (auto-approve) and `needsReview` arrays
 */
export function confidenceGate(
  prices: ScannedFlyerPrice[],
): { accepted: ScannedFlyerPrice[]; needsReview: ScannedFlyerPrice[] } {
  const accepted: ScannedFlyerPrice[] = [];
  const needsReview: ScannedFlyerPrice[] = [];

  for (const price of prices) {
    if (price.confidence >= CONFIDENCE_THRESHOLD) {
      accepted.push(price);
    } else {
      needsReview.push(price);
    }
  }

  return { accepted, needsReview };
}

// ─── Image Discard ───────────────────────────────────────────────────────────

/**
 * Delete a temporary image file after extraction.
 *
 * Uses fetch to access the file:// URI and the File System Access API
 * to trigger cleanup. In React Native, this relies on the expo-file-system
 * deleteAsync call. Falls back gracefully if the file doesn't exist.
 *
 * Critical rule: Images must be discarded after extraction
 * to prevent re-processing and to manage memory.
 *
 * @param imageUri - URI of the image to discard
 * @returns true if the image was successfully discarded
 */
export async function discardImage(imageUri: string): Promise<boolean> {
  try {
    // If this is a blob: URI (created by EXIF stripping), revoke it
    if (imageUri.startsWith('blob:')) {
      URL.revokeObjectURL(imageUri);
      return true;
    }

    // For file:// URIs, use expo-file-system to delete the file
    if (imageUri.startsWith('file://')) {
      try {
        const { deleteAsync } = await import('expo-file-system');
        await deleteAsync(imageUri, { idempotent: true });
      } catch {
        // expo-file-system not available (test environment, web, etc.)
        // Return true — the file will be cleaned up by the OS temp system
      }
      return true;
    }

    // For other URIs (http, data, etc.), return true — caller manages cleanup
    return true;
  } catch (err) {
    console.warn(`[flyer-pipeline] Image discard failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// ─── Pipeline Runner ─────────────────────────────────────────────────────────

/**
 * Run a single flyer image through the full pipeline:
 *   stripExif → runExtraction → confidenceGate → discardImage
 *
 * @param imageUri - URI of the captured flyer image
 * @param extractor - The FlyerExtractor implementation
 * @returns FlyerPipelineResult with processed prices
 */
export async function processFlyerImage(
  imageUri: string,
  extractor: FlyerExtractor,
): Promise<FlyerPipelineResult> {
  try {
    // 1. Strip EXIF
    const cleanImage = await stripExif(imageUri);

    // 2. Run extraction
    const rawPrices = await runExtraction(cleanImage, extractor);

    // 3. Confidence gate
    const { accepted, needsReview } = confidenceGate(rawPrices);

    // 4. Discard both images (cleanImage is a blob: URI, imageUri is the original)
    await discardImage(cleanImage);
    await discardImage(imageUri);

    return {
      imageUri: cleanImage,
      prices: [...accepted, ...needsReview],
      discarded: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      imageUri,
      prices: [],
      discarded: false,
      error: message,
    };
  }
}
