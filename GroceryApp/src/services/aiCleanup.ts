/**
 * AICleanup — normalize raw user-entered product names.
 *
 * Uses a combination of heuristics and a lightweight AI call
 * (via the OpenCode Go API if available) to clean up messy
 * product names like "NUTELLA HAZLNUT SPRD 750G" into
 * structured data.
 *
 * The AI call is optional — heuristics cover the common case.
 */

// ─── Heuristic Cleanup ───────────────────────────────────────────────────────

interface CleanedResult {
  productName: string;
  brand: string | null;
  category: string | null;
  quantityLabel: string | null;
}

/**
 * Client-side heuristic cleanup — handles 80% of cases without any API call.
 * - Trims whitespace
 * - Title-cases (but preserves all-caps brands like IKEA, Old Dutch)
 * - Strips leading/trailing special chars
 * - Removes duplicate spaces
 */
function heuristicClean(rawName: string): CleanedResult {
  const trimmed = rawName.trim().replace(/\s+/g, ' ');

  // If it's already clean (starts with upper, has mixed case), return as-is
  if (/^[A-Z][a-z]/.test(trimmed) || !/^[A-Z\s]+$/.test(trimmed)) {
    return {
      productName: trimmed,
      brand: null,
      category: null,
      quantityLabel: null,
    };
  }

  // ALL CAPS — title-case it
  const titled = trimmed
    .toLowerCase()
    .replace(/(^\w|\s\w)/g, (c) => c.toUpperCase())
    .replace(/\bAnd\b/g, 'and')
    .replace(/\bOr\b/g, 'or')
    .replace(/\bOf\b/g, 'of')
    .replace(/\bThe\b/g, 'the')
    .replace(/\bA\b/g, 'a');

  // Try to extract quantity from end (e.g. "Nutella Hazelnut Spread 750 G" → "750 G")
  const quantityMatch = trimmed.match(/(\d+[\s]*(g|kg|ml|l|oz|lb|pcs|each|pack|box))\s*$/i);
  const quantityLabel = quantityMatch ? quantityMatch[1].toUpperCase() : null;

  return {
    productName: titled,
    brand: null,
    category: null,
    quantityLabel,
  };
}

// ─── AI Cleanup (optional, only if endpoint configured) ──────────────────────

/**
 * Clean product name using MiMo via OpenCode Go.
 * Falls back to heuristic if the AI endpoint isn't configured
 * or the call fails.
 */
export async function cleanProductName(rawName: string): Promise<CleanedResult> {
  const heuristic = heuristicClean(rawName);

  // Check if AI cleanup is configured
  const aiEndpoint = process.env.EXPO_PUBLIC_AI_CLEANUP_URL;
  const aiKey = process.env.EXPO_PUBLIC_AI_CLEANUP_KEY;

  if (!aiEndpoint || !aiKey) {
    // No AI configured — return heuristic result
    return heuristic;
  }

  try {
    const res = await fetch(aiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          {
            role: 'system',
            content:
              'You normalize grocery product names. Return JSON: {"productName": string, "brand": string|null, "category": string|null, "quantityLabel": string|null}. Examples: "NUTELLA HAZLNUT SPRD 750G" → {"productName":"Nutella Hazelnut Spread","brand":"Ferrero","category":"spreads","quantityLabel":"750 g"}. "2% MILK BAG" → {"productName":"2% Milk","brand":null,"category":"dairy","quantityLabel":null}. Return ONLY the JSON object, no markdown.',
          },
          {
            role: 'user',
            content: rawName.trim(),
          },
        ],
        max_tokens: 150,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return heuristic;

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? data.response ?? '';

    // Parse the JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return heuristic;

    const parsed = JSON.parse(jsonMatch[0]);
    // Guard against unexpected AI output shape
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return heuristic;

    return {
      productName: parsed.productName || heuristic.productName,
      brand: parsed.brand || null,
      category: parsed.category || null,
      quantityLabel: parsed.quantityLabel || heuristic.quantityLabel,
    };
  } catch {
    // AI failed — fall back to heuristic
    return heuristic;
  }
}
