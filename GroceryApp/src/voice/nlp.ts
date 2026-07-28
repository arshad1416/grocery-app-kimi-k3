/**
 * Lightweight regex-based NLP parser for voice grocery text.
 *
 * Handles natural language patterns like:
 *   "2% milk x2"           → {name:"2% Milk", quantity:2, unit:"each"}
 *   "half a kilo of chicken breast" → {name:"Chicken Breast", quantity:0.5, unit:"kg"}
 *   "a dozen eggs"         → {name:"Eggs", quantity:12, unit:"each"}
 *   "bananas"              → {name:"Bananas", quantity:1, unit:"bunch"}
 *   "1kg of rice"          → {name:"Rice", quantity:1, unit:"kg"}
 *   "2 litres of milk"     → {name:"Milk", quantity:2, unit:"L"}
 *   "add milk"             → {name:"Milk", quantity:1, unit:"each"}
 *   "organic valley 2% milk x2 please" → {name:"Organic Valley 2% Milk", quantity:2, unit:"each"}
 *
 * Exports a single function: `parseVoiceText(text: string): ParsedItem`
 */

import type { ParsedItem } from './types';

// ─── Unit Aliases ─────────────────────────────────────────────────────────────

interface UnitAlias {
  unit: string;
  multiplier?: number;
}

const UNIT_ALIASES: Record<string, UnitAlias> = {
  // Volume
  litre: { unit: 'L' },
  litres: { unit: 'L' },
  liter: { unit: 'L' },
  liters: { unit: 'L' },
  l: { unit: 'L' },
  ml: { unit: 'ml' },
  millilitre: { unit: 'ml' },
  millilitres: { unit: 'ml' },
  milliliter: { unit: 'ml' },
  milliliters: { unit: 'ml' },

  // Mass / Weight
  kilo: { unit: 'kg' },
  kilos: { unit: 'kg' },
  kilogram: { unit: 'kg' },
  kilograms: { unit: 'kg' },
  kg: { unit: 'kg' },
  gram: { unit: 'g' },
  grams: { unit: 'g' },
  g: { unit: 'g' },
  pound: { unit: 'lb' },
  pounds: { unit: 'lb' },
  lb: { unit: 'lb' },
  lbs: { unit: 'lb' },
  ounce: { unit: 'oz' },
  ounces: { unit: 'oz' },
  oz: { unit: 'oz' },

  // Count-based
  dozen: { unit: 'each', multiplier: 12 },
  dozens: { unit: 'each', multiplier: 12 },
  pack: { unit: 'pack' },
  packs: { unit: 'pack' },
  bag: { unit: 'bag' },
  bags: { unit: 'bag' },
  bottle: { unit: 'bottle' },
  bottles: { unit: 'bottle' },
  can: { unit: 'can' },
  cans: { unit: 'can' },
  jar: { unit: 'jar' },
  jars: { unit: 'jar' },
  box: { unit: 'box' },
  boxes: { unit: 'box' },
  bunch: { unit: 'bunch' },
  bunches: { unit: 'bunch' },
  piece: { unit: 'pcs' },
  pieces: { unit: 'pcs' },
  pcs: { unit: 'pcs' },
  each: { unit: 'each' },
  loaf: { unit: 'loaf' },
  loaves: { unit: 'loaf' },
  head: { unit: 'head' },
  heads: { unit: 'head' },
  clove: { unit: 'clove' },
  cloves: { unit: 'clove' },
};

// ─── Fraction / Word Quantity Aliases ─────────────────────────────────────────

const WORD_QUANTITIES: Record<string, number> = {
  half: 0.5,
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  dozen: 12,
  dozens: 12,
};

// ─── Filler Words ─────────────────────────────────────────────────────────────

const FILLER_WORDS = new Set([
  'add',
  'please',
  'pls',
  'thanks',
  'thank',
  'need',
  'want',
  'get',
  'buy',
  'have',
  'some',
  'the',
  'and',
  'i',
  'me',
  'my',
  'we',
  'us',
  'can',
  'could',
  'would',
  'should',
  'like',
]);

// ─── Multi-word Filler Prefixes ──────────────────────────────────────────────

const MULTI_WORD_FILLER_PREFIXES = [
  'i would like to get',
  'i need to get',
  'can i get',
  'can i have',
  'could i get',
  'i would like',
  'i need',
  'i want',
  'would like',
  'we need',
  'we want',
].sort((a, b) => b.length - a.length); // longest first

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Title-case a string (first letter uppercase, rest lowercase).
 * Preserves hyphenated words by capitalizing each segment.
 * Preserves possessives (e.g., "Jerry's" → "Jerry'S").
 */
function titleCase(text: string): string {
  return text
    .split(' ')
    .map((word) => {
      if (word.length === 0) return word;
      // Keep words like "2%" or "1/2" as-is
      if (/^[\d%./]+$/.test(word)) return word;

      // Handle hyphenated words: "free-range" → "Free-Range"
      if (word.includes('-')) {
        return word
          .split('-')
          .map((part) => {
            if (part.length === 0) return part;
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
          })
          .join('-');
      }

      // Handle possessives: "jerry's" → "Jerry'S" but "jerrys" → "Jerrys"
      // For now, just capitalize first letter, keep rest
      // This is consistent with how titleCase works with apostrophes
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Strip filler words from the beginning and end of a phrase.
 * Filters common voice command prefixes and politeness words.
 */
function stripFillers(text: string): string {
  let cleaned = text.toLowerCase().trim();

  // Remove multi-word filler prefixes first (longest match wins)
  for (const filler of MULTI_WORD_FILLER_PREFIXES) {
    if (cleaned.startsWith(filler + ' ')) {
      cleaned = cleaned.slice(filler.length).trim();
      break;
    }
  }

  // Remove trailing/leading filler words
  const words = cleaned.split(/\s+/);
  const filtered = words.filter((w) => !FILLER_WORDS.has(w));

  return filtered.join(' ').trim();
}

// ─── Main Parser ──────────────────────────────────────────────────────────────

/**
 * Parse a voice text string into a structured ParsedItem.
 *
 * Handles patterns:
 *   - "xN" suffix for quantity (e.g. "milk x2")
 *   - "N [unit] of [name]" (e.g. "1kg of rice", "2 litres of milk")
 *   - "half a [unit] of [name]" (e.g. "half a kilo of chicken")
 *   - Word quantities (e.g. "a dozen eggs")
 *   - "a/an [unit] of [name]" (e.g. "a bag of apples", "a bunch of bananas")
 *   - Bare item names (fallback: qty=1, unit="each")
 *
 * @param text - Raw voice transcription text
 * @returns ParsedItem with name, quantity, unit, and confidence score
 */
export function parseVoiceText(text: string): ParsedItem {
  // Normalize whitespace
  let raw = text.trim();

  if (!raw) {
    return { name: '', quantity: 1, unit: 'each', confidence: 0 };
  }

  // Step 1: Strip filler words
  const cleaned = stripFillers(raw);

  // If stripping left nothing, use original raw
  const working = cleaned || raw;

  // Step 2: Attempt multi-pattern parsing
  return tryParse(working);
}

function tryParse(text: string): ParsedItem {
  // Pattern 1: "name xN" — suffix multiplier (e.g. "2% milk x2", "bananas x3")
  const xPattern = text.match(/^(.+?)\s+x(\d+(?:\.\d+)?)\s*$/i);
  if (xPattern) {
    const name = xPattern[1].trim();
    const quantity = parseFloat(xPattern[2]);
    if (name && quantity > 0) {
      return {
        name: titleCase(name),
        quantity,
        unit: 'each',
        confidence: 0.9,
      };
    }
  }

  // Pattern 2: "half a[n] [unit] of [name]" (e.g. "half a kilo of chicken breast")
  // Check BEFORE wordQtyPattern to avoid "kilo" being captured as name
  const halfPattern = text.match(
    /^(half)\s+a(?:n)?\s+([a-zA-Z]+)\s+of\s+(.+)$/i,
  );
  if (halfPattern) {
    const qtyWord = halfPattern[1].toLowerCase();
    const unitWord = halfPattern[2].toLowerCase();
    const name = titleCase(halfPattern[3].trim());
    const alias = UNIT_ALIASES[unitWord];
    const quantity = WORD_QUANTITIES[qtyWord] ?? 0.5;
    return {
      name,
      quantity: alias?.multiplier != null ? quantity * alias.multiplier : quantity,
      unit: alias?.unit ?? unitWord,
      confidence: 0.85,
    };
  }

  // Pattern 3: "a[n] [unit] of [name]" (e.g. "a bag of apples", "a bunch of bananas")
  // This must match BEFORE wordQtyPattern to properly capture unit words
  const articleUnitPattern = text.match(
    /^(a(?:n)?)\s+([a-zA-Z]+)\s+of\s+(.+)$/i,
  );
  if (articleUnitPattern) {
    const unitWord = articleUnitPattern[2].toLowerCase();
    const alias = UNIT_ALIASES[unitWord];
    if (alias) {
      const name = titleCase(articleUnitPattern[3].trim());
      return {
        name,
        quantity: alias.multiplier ?? 1,
        unit: alias.unit,
        confidence: 0.85,
      };
    }
  }

  // Pattern 4: Word quantity + " [unit] of [name]" (e.g. "a dozen eggs")
  // Also handles "six bottles of water", "three bags of frozen veggies"
  const wordQtyPattern = text.match(
    /^(a\s+)?(half|a(?:n)?|one|two|three|four|five|six|seven|eight|nine|ten|dozen|dozens)\s+([a-zA-Z]+)\s+of\s+(.+)$/i,
  );
  if (wordQtyPattern) {
    const qtyWord = (wordQtyPattern[2] ?? '').toLowerCase().replace(/^an?$/, 'a');
    const unitWord = wordQtyPattern[3].toLowerCase();
    const name = titleCase(wordQtyPattern[4].trim());
    const alias = UNIT_ALIASES[unitWord];
    const baseQty = WORD_QUANTITIES[qtyWord] ?? 1;
    // If the unit word is a known unit alias, use it; otherwise treat as bare number
    if (alias) {
      const quantity = alias.multiplier != null ? baseQty * alias.multiplier : baseQty;
      return {
        name,
        quantity,
        unit: alias.unit,
        confidence: 0.85,
      };
    }
    // If unitWord is NOT a known alias, treat whole pattern as "N name" (bare quantity)
    return {
      name: titleCase(unitWord + ' ' + wordQtyPattern[4]).trim(),
      quantity: baseQty,
      unit: 'each',
      confidence: 0.8,
    };
  }

  // Pattern 5: Word quantity + remaining text (direct, no "of")
  // e.g. "a dozen eggs", "two apples"
  const wordQtyDirectPattern = text.match(
    /^(a\s+)?(half|a(?:n)?|one|two|three|four|five|six|seven|eight|nine|ten|dozen|dozens)\s+(.+)$/i,
  );
  if (wordQtyDirectPattern) {
    const qtyWord = (wordQtyDirectPattern[2] ?? '').toLowerCase().replace(/^an?$/, 'a');
    const rest = wordQtyDirectPattern[3].trim();
    const qty = WORD_QUANTITIES[qtyWord] ?? 1;
    return {
      name: titleCase(rest),
      quantity: qty,
      unit: 'each',
      confidence: 0.8,
    };
  }

  // Pattern 6: "N[unit] of [name]" (e.g. "1kg of rice", "2L of milk")
  const compactUnitPattern = text.match(
    /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s+of\s+(.+)$/i,
  );
  if (compactUnitPattern) {
    const quantity = parseFloat(compactUnitPattern[1]);
    const unitWord = compactUnitPattern[2].toLowerCase();
    const name = titleCase(compactUnitPattern[3].trim());
    const alias = UNIT_ALIASES[unitWord];
    return {
      name,
      quantity: alias?.multiplier != null ? quantity * alias.multiplier : quantity,
      unit: alias?.unit ?? unitWord,
      confidence: 0.9,
    };
  }

  // Pattern 7: "N [unit] of [name]" with space (e.g. "2 litres of milk", "5 pounds of apples")
  const spacedUnitPattern = text.match(
    /^(\d+(?:\.\d+)?)\s+([a-zA-Z]+)\s+of\s+(.+)$/i,
  );
  if (spacedUnitPattern) {
    const quantity = parseFloat(spacedUnitPattern[1]);
    const unitWord = spacedUnitPattern[2].toLowerCase();
    const name = titleCase(spacedUnitPattern[3].trim());
    const alias = UNIT_ALIASES[unitWord];
    return {
      name,
      quantity: alias?.multiplier != null ? quantity * alias.multiplier : quantity,
      unit: alias?.unit ?? unitWord,
      confidence: 0.9,
    };
  }

  // Pattern 8: "N[unit] [name]" (no "of", e.g. "2 kg rice", "1L milk")
  const compactNoOfPattern = text.match(
    /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s+(.+)$/i,
  );
  if (compactNoOfPattern) {
    const quantity = parseFloat(compactNoOfPattern[1]);
    const unitWord = compactNoOfPattern[2].toLowerCase();
    const name = titleCase(compactNoOfPattern[3].trim());
    const alias = UNIT_ALIASES[unitWord];
    return {
      name,
      quantity: alias?.multiplier != null ? quantity * alias.multiplier : quantity,
      unit: alias?.unit ?? unitWord,
      confidence: 0.85,
    };
  }

  // Fallback: treat entire text as item name, qty=1, unit="each"
  return {
    name: titleCase(text),
    quantity: 1,
    unit: 'each',
    confidence: 0.5,
  };
}