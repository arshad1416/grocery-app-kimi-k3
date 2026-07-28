/**
 * Turso schema migrations for StopHop product database.
 *
 * Run these against your Turso database via tursoClient.execute().
 * The 'products' table stores the canonical product record for each barcode.
 * The 'product_prices' table stores price observations over time.
 */

export const MIGRATIONS = [
  {
    version: 1,
    name: 'create_products_and_prices',
    sql: `
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
    `,
  },
  {
    version: 2,
    name: 'create_store_prices',
    sql: `
      CREATE TABLE IF NOT EXISTS store_prices (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id      TEXT NOT NULL,
        store_name    TEXT NOT NULL,
        name          TEXT NOT NULL,
        name_clean    TEXT NOT NULL,
        price         TEXT NOT NULL,
        price_real    REAL,
        unit_price    TEXT,
        unit_price_real REAL,
        unit          TEXT,
        image_url     TEXT,
        brand         TEXT,
        category      TEXT,
        is_on_sale    INTEGER DEFAULT 0,
        sale_price    REAL,
        was_price     REAL,
        postal_code   TEXT NOT NULL,
        scraped_at    TEXT NOT NULL DEFAULT (datetime('now')),
        source        TEXT NOT NULL DEFAULT 'scraper',
        UNIQUE(store_id, name_clean, postal_code)
      );

      CREATE INDEX IF NOT EXISTS idx_store_prices_store ON store_prices(store_id);
      CREATE INDEX IF NOT EXISTS idx_store_prices_name ON store_prices(name_clean);
      CREATE INDEX IF NOT EXISTS idx_store_prices_scraped ON store_prices(scraped_at);
      CREATE INDEX IF NOT EXISTS idx_store_prices_postal ON store_prices(postal_code);
      CREATE INDEX IF NOT EXISTS idx_store_prices_item ON store_prices(name_clean, store_id);
    `,
  },
  {
    version: 3,
    name: 'create_store_branding',
    sql: `
      CREATE TABLE IF NOT EXISTS store_branding (
        store_id   TEXT PRIMARY KEY,
        store_name TEXT NOT NULL,
        logo_url   TEXT,
        color      TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_store_branding_name ON store_branding(store_name);
    `,
  },
];

/**
 * Schema version tracking — create a one-row config table.
 */
export const SCHEMA_VERSION_SQL = `
  CREATE TABLE IF NOT EXISTS _schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export const GET_SCHEMA_VERSION_SQL = `
  SELECT MAX(version) as version FROM _schema_version
`;

export const SET_SCHEMA_VERSION_SQL = `
  INSERT OR REPLACE INTO _schema_version (version) VALUES (?)
`;
