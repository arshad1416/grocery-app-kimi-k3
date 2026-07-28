/**
 * Flyer Price Extraction — Response Parser
 *
 * Parses and validates the raw JSON response from a VL model.
 * Strips markdown code fences, performs error recovery on malformed JSON,
 * and validates each price entry against the ScannedFlyerPrice schema.
 *
 * @module parse-response
 */

/**
 * Strip markdown code fences (```json ... ``` or ``` ... ```) from a string.
 * Also handles leading/trailing whitespace and control characters.
 *
 * @param {string} raw - Raw response from the model
 * @returns {string} Cleaned JSON string
 */
function stripMarkdownFences(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.trim();

  // Remove ```json ... ``` fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
  cleaned = cleaned.replace(/\n?```\s*$/, '');

  // Also handle single backtick fences (rare but possible)
  cleaned = cleaned.replace(/^`{1,2}\s*/, '');
  cleaned = cleaned.replace(/\s*`{1,2}$/, '');

  return cleaned.trim();
}

/**
 * Attempt to recover a valid JSON string from malformed input.
 * Tries: finding first `{` to last `}`, or returning empty string.
 *
 * @param {string} raw - Potentially malformed JSON string
 * @returns {string} Best-effort JSON string, or ''
 */
function recoverJson(raw) {
  // Try to find a valid JSON object
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return '';
}

/**
 * Validate a single price entry.
 *
 * @param {object} entry - Candidate price entry
 * @returns {object|null} Validated entry with defaults applied, or null if invalid
 */
function validatePriceEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  // itemName: required, non-empty string, max 100 chars, no control chars
  const rawName = entry.itemName || entry.originalName || '';
  if (typeof rawName !== 'string' || rawName.trim().length === 0) return null;
  const itemName = rawName
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .trim()
    .slice(0, 100);

  // price: required, positive number, plausibility cap ($0.01 - $9,999.99)
  const price = Number(entry.price);
  if (isNaN(price) || price <= 0 || price > 9999.99) return null;

  // unit: optional, default to 'each'
  const unit = (typeof entry.unit === 'string' && entry.unit.trim().length > 0)
    ? entry.unit.trim()
    : 'each';

  // quantity: optional, default to 1
  const quantity = (typeof entry.quantity === 'number' && entry.quantity > 0)
    ? entry.quantity
    : 1;

  // confidence: optional, default to 0.5
  let confidence = typeof entry.confidence === 'number' ? entry.confidence : 0.5;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  // saleInfo: optional, default to null
  let saleInfo = null;
  if (entry.saleInfo && typeof entry.saleInfo === 'object') {
    const isOnSale = !!entry.saleInfo.isOnSale;
    const salePrice = Number(entry.saleInfo.salePrice) || 0;
    const regularPrice = entry.saleInfo.regularPrice != null ? Number(entry.saleInfo.regularPrice) : null;
    const saleEndDate = entry.saleInfo.saleEndDate != null ? Number(entry.saleInfo.saleEndDate) : null;

    if (isOnSale && salePrice > 0) {
      saleInfo = {
        isOnSale: true,
        salePrice,
        regularPrice,
        saleEndDate,
      };
    }
  }

  return {
    itemName: itemName.trim(),
    price,
    unit,
    quantity,
    confidence,
    saleInfo,
  };
}

/**
 * Parse and validate the raw response from a VL model.
 * Returns an array of validated price entries (compatible with ScannedFlyerPrice[]).
 * On complete failure, returns an empty array.
 *
 * @param {string} rawResponse - Raw text response from the model
 * @returns {Array<{itemName: string, price: number, unit: string, quantity: number, confidence: number, saleInfo: object|null}>}
 */
function parseResponse(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'string') return [];

  // 1. Strip markdown fences
  let cleaned = stripMarkdownFences(rawResponse);
  if (!cleaned) return [];

  // 2. Try JSON parse
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // 3. Error recovery: try to find a valid JSON object
    const recovered = recoverJson(cleaned);
    if (recovered) {
      try {
        parsed = JSON.parse(recovered);
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }

  // 4. Validate structure
  if (!parsed || typeof parsed !== 'object') return [];

  // Support both { prices: [...] } and direct array
  const prices = Array.isArray(parsed) ? parsed : (parsed.prices || []);

  if (!Array.isArray(prices)) return [];

  // 5. Validate each entry
  const validated = prices.map(validatePriceEntry).filter(Boolean);

  return validated;
}

module.exports = { parseResponse, stripMarkdownFences, recoverJson, validatePriceEntry };
