# Barcode Scanner + Product Database Feature

## What Was Built

### New Files

| File | Purpose |
|------|---------|
| `src/types/product.ts` | ProductInfo, ScanResult, NewProductSubmission types |
| `src/services/productCache.ts` | In-memory session cache (max 200 items) |
| `src/services/tursoClient.ts` | HTTP client for Turso `/v2/pipeline` API (zero native deps) |
| `src/services/tursoMigrations.ts` | SQL migrations for `products` + `product_prices` tables |
| `src/services/productLookup.ts` | Lookup chain: cache → Turso → Open Food Facts → USDA |
| `src/services/aiCleanup.ts` | Heuristic + AI product name normalization (MiMo via OpenCode Go) |
| `src/components/BarcodeScannerScreen.tsx` | Full-screen barcode scanner (expo-camera, EAN-13/UPC) |

### Modified Files

| File | Change |
|------|--------|
| `src/types/index.ts` | ~~Added Turso url/token/enabled to AppSettings~~ **Removed in v1** — client-held Turso credentials are extractable from the built app (see GOAL_PROMPT_NOTES.md) |
| `App.tsx` | ~~Adds Turso init after device identity setup~~ **Removed in v1** — Turso is never initialized client-side |
| `src/screens/AddItemSheet.tsx` | Scan button, scanner overlay, lookup, new-product form |

---

## What You Need to Do to Activate

### 1. Install expo-camera (barcode scanning)

```bash
npx expo install expo-camera
```

This is the same library already used dynamically in `CameraScanner.tsx`. Installing it makes the real camera available.

### 2. Create a Turso database

```bash
# Install Turso CLI
curl -sSfL https://get.turso.tech/install.sh | bash

# Login
turso auth login

# Create a database for PantryRun products
turso db create pantryrun-products

# Get the database URL + token
turso db show pantryrun-products --url        # → https://pantryrun-products-<org>.turso.io
turso db tokens create pantryrun-products     # → <token>

# Initialize the schema
turso db shell pantryrun-products < src/services/init-schema.sql
```

### 3. Create `init-schema.sql`

Run this against your Turso DB to create the tables:

```sql
CREATE TABLE IF NOT EXISTS products (
  barcode        TEXT PRIMARY KEY,
  product_name   TEXT NOT NULL,
  brand          TEXT,
  category       TEXT,
  image_url      TEXT,
  quantity_label TEXT,
  source         TEXT NOT NULL DEFAULT 'user',
  raw_input      TEXT,
  ai_cleaned     INTEGER DEFAULT 0,
  first_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_prices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode      TEXT NOT NULL REFERENCES products(barcode),
  price        REAL NOT NULL,
  store_name   TEXT NOT NULL,
  store_id     TEXT NOT NULL,
  quantity     REAL,
  unit         TEXT,
  scanned_at   TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_prices_barcode ON product_prices(barcode);
CREATE INDEX IF NOT EXISTS idx_prices_scanned ON product_prices(scanned_at);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
```

### 4. Get a USDA API key (free)

Sign up at https://fdc.nal.usda.gov/api-key-signup.html — instant, no wait.

Then add to `.env`:
```
EXPO_PUBLIC_USDA_API_KEY=your_key_here
EXPO_PUBLIC_AI_CLEANUP_URL=https://opencode.ai/zen/go/v1/chat/completions
EXPO_PUBLIC_AI_CLEANUP_KEY=your_opencode_go_key
```

### 5. Set Turso credentials in-app

The SettingsScreen needs Turso URL + token fields (not built yet). For testing, you can hardcode them temporarily or add a TursoConfigSection in SettingsScreen.

---

## Architecture Diagram

```
User scans barcode (expo-camera → ML Kit)
        │
        ▼
BarcodeScannerScreen ── onScan(barcode) ──► AddItemSheet
                                               │
                                               ▼
                                        lookupProduct(barcode)
                                               │
                                    ┌──────────┼──────────┐
                                    ▼          ▼          ▼
                               In-memory    Turso DB   Open Food Facts
                                cache       (your      (free, no key)
                                (session    products)       │
                                 only)                      ▼
                                                         USDA
                                                         (free fallback)
                                               │
                                    ┌──────────┘
                                    ▼
                              Found? ──Yes──► Pre-fill form
                                │
                                No
                                │
                                ▼
                         Show "New Product"
                         form → user types name
                                │
                                ▼
                         submitNewProduct()
                                │
                                ▼
                          AI Cleanup → Turso INSERT
                          (heuristic + MiMo)
```

## Edge Cases Handled

1. **Camera not available** → falls back to manual barcode entry (type digits)
2. **No network** → cache hit works, otherwise shows error
3. **Turso not configured** → lookup still works (OFF + USDA), save disabled
4. **Product not in any DB** → new product form, user enters name
5. **All-caps names** → AI cleanup normalizes to title case
6. **Rapid scanning** → `scanned` flag prevents duplicate triggers
7. **Non-retail barcodes** → regex validates 8-14 digit codes only

## What's Not Built (For Your Next Session)

1. **Turso settings UI** in SettingsScreen (URL + token fields)
2. **Turso schema auto-migration** on app start (the `migrations` table check)
3. **AI cleanup server endpoint** (currently configured to hit OpenCode Go API directly — a Cloudflare Worker wrapper would be cleaner)
4. **Price history view** in ItemEditScreen (data is stored, UI not wired)
5. **expo-camera install** — you need to `npx expo install expo-camera`
6. **Turso database creation** — via CLI
