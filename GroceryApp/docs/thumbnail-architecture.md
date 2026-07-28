# Item Thumbnails Architecture Plan

**Status:** Ready for implementation
**Priority:** Emoji mapping first (immediate visual impact), Flipp images second

---

## Current State

- `GroceryItem.imageUrl` field **already exists** (types/index.ts:45)
- `ItemRow.tsx` **already renders** `item.imageUrl` with an `<Image>` component (lines 148–154, 32×32px)
- `DealMatch.imageUrl` **already exists** from dealMatcher (line 32)
- `PriceResult` does **NOT** have `imageUrl` — this is the gap
- `FlippDealsAdapter.getPrice()` **discards** `match.deal.image_url` when building PriceResult

**Key insight:** The rendering plumbing is already in place. The only gaps are:
1. No emoji fallback when `imageUrl` is absent
2. `PriceResult` doesn't carry `imageUrl` from Flipp deals
3. `FlippDealsAdapter` drops the image URL

---

## Architecture

### Thumbnail Source Priority

```
1. item.imageUrl         → Flipp deal image (set on GroceryItem via product lookup)
2. price.imageUrl        → Flipp deal image (from current price result)
3. emojiForItem(name)    → Emoji based on fuzzy item name match
4. (nothing)             → Graceful degradation, no thumbnail
```

### Data Flow

```
Flipp Turso DB (image_url column)
       ↓
dealMatcher.ts → FlippDealRow.image_url → DealMatch.imageUrl  ✓ (already works)
       ↓
flipp-deals-adapter.ts → PriceResult.imageUrl                  ✗ (NEEDS: add field)
       ↓
price-store.ts → prices[itemId] → PriceResult                  (no change needed)
       ↓
GroceryListScreen.tsx → getItemPrice(itemId) → PriceResult     (no change needed)
       ↓
ItemRow.tsx → render thumbnail                                  (NEEDS: emoji fallback)
```

---

## Files to Modify/Create

### 1. NEW: `src/pricing/emoji-map.ts` — Emoji mapping (PRIORITY)

```typescript
/**
 * Maps grocery item names to emoji for visual thumbnails.
 * Uses prefix matching so "Granny Smith Apples" → 🍎.
 */

const EMOJI_MAP: [string[], string][] = [
  // Produce
  [['apple'], '🍎'],
  [['banana'], '🍌'],
  [['orange', 'mandarin', 'clementine'], '🍊'],
  [['grape'], '🍇'],
  [['strawberr'], '🍓'],
  [['blueberr'], '🫐'],
  [['watermelon'], '🍉'],
  [['lemon'], '🍋'],
  [['lime'], '🍈'],
  [['pear'], '🍐'],
  [['peach'], '🍑'],
  [['cherr'], '🍒'],
  [['mango'], '🥭'],
  [['pineapple'], '🍍'],
  [['coconut'], '🥥'],
  [['kiwi'], '🥝'],
  [['tomato'], '🍅'],
  [['avocado'], '🥑'],
  [['potato'], '🥔'],
  [['carrot'], '🥕'],
  [['corn'], '🌽'],
  [['pepper', 'hot pepper', 'chili'], '🌶️'],
  [['cucumber'], '🥒'],
  [['broccoli'], '🥦'],
  [['garlic'], '🧄'],
  [['onion'], '🧅'],
  [['mushroom'], '🍄'],
  [['peanut'], '🥜'],
  [['chestnut'], '🌰'],
  [['lettuce', 'salad', 'arugula', 'spinach', 'kale', 'greens'], '🥬'],
  [['herb', 'basil', 'parsley', 'cilantro', 'dill', 'rosemary', 'thyme'], '🌿'],

  // Dairy & Eggs
  [['milk'], '🥛'],
  [['cheese'], '🧀'],
  [['butter'], '🧈'],
  [['egg'], '🥚'],
  [['yogurt', 'yoghurt'], '🥄'],
  [['ice cream'], '🍦'],

  // Meat & Protein
  [['chicken', 'poultry', 'wing'], '🍗'],
  [['steak', 'beef', 'ground beef'], '🥩'],
  [['bacon', 'ham', 'prosciutto'], '🥓'],
  [['sausage', 'hot dog', 'wiener'], '🌭'],
  [['burger', 'hamburger'], '🍔'],

  // Seafood
  [['fish', 'salmon', 'trout', 'tilapia', 'cod', 'mahi'], '🐟'],
  [['shrimp', 'prawn', 'crab', 'lobster', 'shellfish'], '🦐'],

  // Bakery & Grains
  [['bread', 'loaf', 'baguette', 'toast'], '🍞'],
  [['bagel'], '🥯'],
  [['pretzel'], '🥨'],
  [['croissant'], '🥐'],
  [['rice'], '🍚'],
  [['noodle', 'pasta', 'spaghetti', 'penne', 'fusilli'], '🍝'],

  // Prepared / Snacks
  [['pizza'], '🍕'],
  [['taco'], '🌮'],
  [['burrito', 'wrap'], '🌯'],
  [['sandwich', 'sub'], '🥪'],
  [['soup', 'broth'], '🍲'],
  [['salad'], '🥗'],
  [['popcorn'], '🍿'],
  [['cookie'], '🍪'],
  [['cake'], '🎂'],
  [['donut', 'doughnut'], '🍩'],
  [['pie'], '🥧'],
  [['chocolate', 'candy', 'sweet'], '🍫'],
  [['honey'], '🍯'],

  // Beverages
  [['water', 'sparkling'], '💧'],
  [['juice', 'orange juice', 'apple juice'], '🧃'],
  [['coffee', 'espresso', 'latte'], '☕'],
  [['tea'], '🍵'],
  [['wine'], '🍷'],
  [['beer'], '🍺'],
  [['soda', 'pop', 'cola', 'coke', 'pepsi'], '🥤'],
  [['smoothie'], '🥤'],

  // Pantry & Condiments
  [['oil', 'olive oil', 'cooking oil'], '🫒'],
  [['salt'], '🧂'],
  [['sauce', 'ketchup', 'mustard', 'mayo', 'dressing'], '🫙'],
  [['canned', 'can of', 'beans'], '🥫'],

  // Household / Non-food
  [['soap', 'detergent', 'cleaner', 'dish'], '🧴'],
  [['tissue', 'paper towel', 'napkin'], '🧻'],
  [['trash bag', 'garbage bag'], '🗑️'],
  [['baby', 'diaper', 'wipe'], '👶'],
  [['pet', 'dog food', 'cat food', 'kibble'], '🐾'],
  [['toothpaste', 'toothbrush', 'dental'], '🪥'],
  [['vitamin', 'supplement', 'medicine', 'pill'], '💊'],
];

/**
 * Returns the best emoji for a grocery item name, or empty string if no match.
 * Uses lowercase substring matching — "Bananas" matches "banana".
 */
export function emojiForItem(itemName: string): string {
  if (!itemName) return '';
  const lower = itemName.toLowerCase();

  for (const [keywords, emoji] of EMOJI_MAP) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return emoji;
      }
    }
  }

  return '';
}
```

### 2. MODIFY: `src/pricing/types.ts` — Add `imageUrl` to PriceResult

```diff
 export interface PriceResult {
   price: number;
   unitPrice: number;
   unit: string;
   displayUnit?: string;
   saleInfo: SaleInfo | null;
   source: PriceSource;
   timestamp: number;
   confidence: ConfidenceLevel;
+  /** Product image URL from the price source (e.g. Flipp deal image) */
+  imageUrl?: string;
 }
```

### 3. MODIFY: `src/pricing/flipp-deals-adapter.ts` — Pass image_url through

In `getPrice()` method (around line 170):
```diff
  return {
    price,
    unitPrice: price,
    unit: 'each',
    saleInfo: null,
    source: { ... },
    timestamp: new Date(match.deal.valid_to).getTime(),
    confidence: dealConfidence(match.deal.valid_to),
+   imageUrl: match.deal.image_url ?? undefined,
  };
```

In `getPrices()` method (around line 205):
```diff
  results.set(itemName, {
    price,
    unitPrice: price,
    unit: 'each',
    saleInfo: null,
    source: { ... },
    timestamp: new Date(match.deal.valid_to).getTime(),
    confidence: dealConfidence(match.deal.valid_to),
+   imageUrl: match.deal.image_url ?? undefined,
  });
```

### 4. MODIFY: `src/components/ItemRow.tsx` — Add emoji fallback thumbnail

Replace the existing image block (lines 147–154):

```tsx
import { emojiForItem } from '../pricing/emoji-map';

// Inside the component, before the return:
const thumbnailEmoji = emojiForItem(item.name);

// In the JSX, replace the existing image block:
{/* Thumbnail: Flipp image > emoji fallback */}
{item.imageUrl || price?.imageUrl ? (
  <Image
    source={{ uri: item.imageUrl || price?.imageUrl }}
    style={styles.itemImage}
    resizeMode="contain"
  />
) : thumbnailEmoji ? (
  <View style={styles.emojiThumbnail}>
    <Text style={styles.emojiText}>{thumbnailEmoji}</Text>
  </View>
) : null}
```

Add styles:
```typescript
emojiThumbnail: {
  width: 32,
  height: 32,
  borderRadius: 6,
  marginRight: 8,
  justifyContent: 'center',
  alignItems: 'center',
  backgroundColor: '#f5f5f5',  // light gray, overridden by theme at runtime
},
emojiText: {
  fontSize: 20,
},
```

---

## No-Change Files

These files require **no modifications**:
- `src/services/dealMatcher.ts` — Already has `imageUrl` on `DealMatch` ✓
- `src/pricing/price-store.ts` — Passes `PriceResult` through transparently ✓
- `src/screens/GroceryListScreen.tsx` — `getItemPrice()` returns PriceResult as-is ✓
- `src/types/index.ts` — `GroceryItem.imageUrl` already exists ✓

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────┐
│  Turso flipp_deals.image_url                            │
│       ↓                                                 │
│  dealMatcher → DealMatch.imageUrl  (already works)      │
│       ↓                                                 │
│  flipp-deals-adapter → PriceResult.imageUrl  (NEW)      │
│       ↓                                                 │
│  price-store → prices[itemId].imageUrl  (transparent)   │
│       ↓                                                 │
│  GroceryListScreen → getItemPrice(id)  (transparent)    │
│       ↓                                                 │
│  ItemRow:                                               │
│    1. Check item.imageUrl (from GroceryItem)            │
│    2. Check price.imageUrl (from PriceResult)           │
│    3. Fallback: emojiForItem(item.name)  (NEW)          │
│    4. Fallback: no thumbnail                            │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Order

1. **`src/pricing/emoji-map.ts`** — Create (standalone, zero deps, testable)
2. **`src/pricing/types.ts`** — Add `imageUrl?: string` to PriceResult
3. **`src/pricing/flipp-deals-adapter.ts`** — Pass `image_url` through in both methods
4. **`src/components/ItemRow.tsx`** — Import emoji-map, add emoji fallback rendering

**Total: 1 new file, 3 modified files. Zero new dependencies.**

---

## Performance Considerations

- `emojiForItem()` is O(n) where n = number of emoji mappings (~80 entries). Runs once per render per item. Fast enough — no memoization needed.
- `ItemRow` is already wrapped in `React.memo` ✓
- Remote Flipp images use the existing `<Image>` component (32×32px, small)
- No `FastImage` dependency needed at this size — standard RN Image is fine
- Emoji rendering is instant (no network, no asset loading)

---

## Testing Strategy

- Unit test `emojiForItem()` with common items: "Bananas" → 🍌, "Ground Beef" → 🥩, "xyz123" → ""
- Visual test: emoji thumbnails appear in list, no layout breakage
- Integration test: when Flipp deal has image_url, remote image shows instead of emoji
- Edge case: item with both item.imageUrl AND price.imageUrl — item.imageUrl wins (priority)
