# Store Logo System — Architecture Plan

## Current State (as of June 2026)

### StoreCard — ✅ Already has logos

`StoreCard.tsx` already contains:
- `STORE_LOGOS: Record<string, any>` — maps storeId to `require('../../assets/<store>_logo.png')`
- `STORE_COLORS: Record<string, string>` — maps storeId to brand hex color
- Falls back to initial letter badge when no logo is found
- All 8 logo PNGs exist in `/assets/`:
  - `nofrills_logo.png`, `foodbasics_logo.png`, `metro_logo.png`
  - `walmart_logo.png`, `freshco_logo.png`, `foodland_logo.png`
  - `loblaws_logo.png`

### TripPlanSheet — ❌ No logos (text-only)
### StoreTotalBar — ❌ No logos (text-only pills)

Both components receive `storeId` from their data types:
- `TripPlanStop.storeId` (string)
- `StoreTotal.storeId` (string)

---

## Recommended Approach: Shared Store Branding Utility

### Why not Option B (static URL mapping)?
The logos already exist as local PNGs. Using URLs would add network dependency, loading states, and cache management. Local `require()` is instant, offline-first, and already proven in StoreCard.

### Why not Option A (Turso table)?
Unnecessary complexity. 8 Canadian stores with static logos. No logos change frequently enough to justify a DB query.

### Chosen: **Extract existing inline maps into a shared utility**

The maps (`STORE_LOGOS`, `STORE_COLORS`) already exist in StoreCard. The only change is:
1. Move them to a shared file
2. Import them in TripPlanSheet and StoreTotalBar
3. Add small logo images to those components

---

## Implementation Plan

### Step 1: Create `src/pricing/store-branding.ts`

```ts
/**
 * Store Branding — Shared store logo and color mappings.
 * Used by StoreCard, TripPlanSheet, and StoreTotalBar.
 */

// Store logos (local PNGs in /assets/)
export const STORE_LOGOS: Record<string, any> = {
  'no-frills': require('../../assets/nofrills_logo.png'),
  'nofrills': require('../../assets/nofrills_logo.png'),
  'food-basics': require('../../assets/foodbasics_logo.png'),
  'foodbasics': require('../../assets/foodbasics_logo.png'),
  'metro': require('../../assets/metro_logo.png'),
  'walmart': require('../../assets/walmart_logo.png'),
  'freshco': require('../../assets/freshco_logo.png'),
  'foodland': require('../../assets/foodland_logo.png'),
  'loblaws': require('../../assets/loblaws_logo.png'),
  'real-canadian-superstore': require('../../assets/loblaws_logo.png'),
  'superstore': require('../../assets/loblaws_logo.png'),
};

// Store brand colors
export const STORE_COLORS: Record<string, string> = {
  'no-frills': '#FFD700',
  'nofrills': '#FFD700',
  'food-basics': '#FF4444',
  'foodbasics': '#FF4444',
  'metro': '#E53935',
  'walmart': '#0071CE',
  'freshco': '#FF6600',
  'foodland': '#228B22',
  'loblaws': '#E53935',
  'real-canadian-superstore': '#E53935',
  'superstore': '#E53935',
};

/** Get logo source for a storeId, or undefined if not found. */
export function getStoreLogo(storeId: string): any | undefined {
  return STORE_LOGOS[storeId.toLowerCase()];
}

/** Get brand color for a storeId, fallback to green. */
export function getStoreColor(storeId: string): string {
  return STORE_COLORS[storeId.toLowerCase()] ?? '#16A34A';
}

/** Get store initial letter (fallback when no logo). */
export function getStoreInitial(storeName: string): string {
  return storeName.charAt(0).toUpperCase();
}
```

### Step 2: Update `StoreCard.tsx`

- Remove inline `STORE_LOGOS`, `STORE_COLORS`, `getStoreColor()`, `getStoreInitial()`
- Import from `../pricing/store-branding`
- No visual changes needed — same render logic

### Step 3: Update `TripPlanSheet.tsx`

In the stop header (line 118-128), add a logo before the store name:

```tsx
import { getStoreLogo, getStoreColor, getStoreInitial } from '../pricing/store-branding';
import { Image } from 'react-native';

// In the stopHeader View (line 118):
<View style={styles.stopHeader}>
  <Text style={[styles.stopLabel, { color: theme.primary }]}>
    Stop {idx + 1}
  </Text>
  <TouchableOpacity
    onPress={() => navigateToStore(stop.storeName)}
    style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
  >
    {/* ADD: Store logo or initial */}
    {getStoreLogo(stop.storeId) ? (
      <Image
        source={getStoreLogo(stop.storeId)}
        style={{ width: 24, height: 24, borderRadius: 12, marginRight: 6 }}
        resizeMode="contain"
      />
    ) : (
      <View style={{
        width: 24, height: 24, borderRadius: 12,
        backgroundColor: getStoreColor(stop.storeId) + '20',
        justifyContent: 'center', alignItems: 'center', marginRight: 6,
      }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: getStoreColor(stop.storeId) }}>
          {getStoreInitial(stop.storeName)}
        </Text>
      </View>
    )}
    <Text style={[styles.stopStore, { color: theme.primary }]}>
      {stop.storeName}
    </Text>
    <Text style={{ fontSize: 14, marginLeft: 4, color: theme.primary }}>📍</Text>
  </TouchableOpacity>
</View>
```

### Step 4: Update `StoreTotalBar.tsx`

Add a small logo inside each store pill, before the store name text:

```tsx
import { getStoreLogo, getStoreColor, getStoreInitial } from '../pricing/store-branding';
import { Image, View } from 'react-native';

// In the pill TouchableOpacity (line 57), add logo before text:
<TouchableOpacity ...>
  {/* ADD: Small store logo */}
  {getStoreLogo(st.storeId) ? (
    <Image
      source={getStoreLogo(st.storeId)}
      style={{ width: 18, height: 18, borderRadius: 9 }}
      resizeMode="contain"
    />
  ) : (
    <View style={{
      width: 18, height: 18, borderRadius: 9,
      backgroundColor: getStoreColor(st.storeId) + '30',
      justifyContent: 'center', alignItems: 'center',
    }}>
      <Text style={{ fontSize: 9, fontWeight: '700', color: getStoreColor(st.storeId) }}>
        {getStoreInitial(st.storeName)}
      </Text>
    </View>
  )}
  <Text style={[styles.storeTotalPillText, ...]}>
    {st.storeName}
  </Text>
  <View style={[styles.storeTotalBadge, ...]}>
    ...
  </View>
</TouchableOpacity>
```

---

## Files Changed (summary)

| File | Action |
|------|--------|
| `src/pricing/store-branding.ts` | **NEW** — shared logo/color maps + helper functions |
| `src/components/StoreCard.tsx` | **EDIT** — remove inline maps, import from store-branding |
| `src/components/TripPlanSheet.tsx` | **EDIT** — add logo to stop headers |
| `src/components/StoreTotalBar.tsx` | **EDIT** — add logo to store pills |

No new assets needed — all 8 logos already exist in `/assets/`.

---

## Data Flow

```
storeId (from PriceAdapter / TripPlanStop / StoreTotal)
  → getStoreLogo(storeId) → require('.../assets/<store>_logo.png')
  → <Image source={logoSource} />
  → fallback: initial letter badge with brand color
```

---

## Key Decisions

1. **Local PNGs, not URLs** — Zero network dependency, instant rendering, already working in StoreCard.
2. **Shared utility, not per-component** — DRY. One place to add a new store's branding.
3. **Initial-letter fallback** — Any unknown store still gets a colored badge with its first letter.
4. **No database changes** — The `store_prices` table doesn't need modification.
5. **Dual storeId keys** — Both `'no-frills'` and `'nofrills'` map to the same logo, matching the existing FlippDeals vs scraper ID discrepancy.
