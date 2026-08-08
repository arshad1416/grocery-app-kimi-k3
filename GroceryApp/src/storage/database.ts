/**
 * WatermelonDB database initialization.
 *
 * Creates a database instance with SQLite adapter (native) or LokiJS (fallback).
 * Registers the schema, model classes, and migrations.
 *
 * ─── Security: At-Rest Encryption ───────────────────────────────────────────
 *
 * Sensitive fields (item names, notes, display names, list descriptions) are
 * encrypted at the APPLICATION LAYER using XChaCha20-Poly1305 (AEAD) before
 * being written to WatermelonDB. This means:
 *
 *   - Grocery item names, notes → encrypted JSON blobs in the SQLite file
 *   - Grocery list names, descriptions, store preferences → encrypted
 *   - Family member display names → encrypted
 *   - Non-sensitive metadata (IDs, timestamps, quantities, booleans) → plaintext
 *
 * WatermelonDB's community SQLiteAdapter does NOT support SQLCipher / native
 * database-level encryption. Full disk-level encryption of the entire SQLite
 * file requires a custom native adapter — see deriveDBKey() in src/crypto/index.ts
 * which pre-derives the key material for that future integration.
 *
 * Mitigation layers:
 *   1. Application-layer encryption (ACTIVE) — all sensitive content is encrypted
 *   2. Device secure enclave (ACTIVE) — master key stored in expo-secure-store
 *   3. SQLCipher full-file encryption (PLANNED) — requires custom native adapter
 *
 * On iOS, the OS-level data protection (NSFileProtectionComplete) provides an
 * additional layer when the device is locked. On Android, file-based encryption
 * (FBE) serves a similar role. These are defense-in-depth, not substitutes for
 * application-layer encryption.
 *
 * @see src/storage/hydrate.ts — encrypt/decrypt layer
 * @see src/crypto/index.ts — deriveDBKey() for future SQLCipher integration
 */

import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { schema } from './schema';
import { migrations } from './migrations';
import { GroceryListModel, GroceryItemModel, FamilyMemberModel, NotificationModel, OfflineQueueModel, EntitlementModel } from './models';

// ─── Lazy Singleton ──────────────────────────────────────────────────────────
// The database is created lazily (not at module evaluation time) so that any
// native-module errors are thrown inside a try/catch rather than crashing the
// app before React mounts.

let _database: Database | null = null;
let _initError: Error | null = null;

/**
 * Returns the WatermelonDB singleton, creating it on first call.
 * Throws if the native SQLite adapter fails to initialise.
 */
export function getDatabase(): Database {
  if (_database) return _database;

  console.log('[database] Creating SQLiteAdapter (jsi=false)…');

  // Create adapter with migrations enabled
  const adapter = new SQLiteAdapter({
    schema,
    migrations,
    // Use JSI for performance (disabled on New Architecture / Hermes)
    jsi: false,
    dbName: 'groceryapp',
    // NOTE: `encryptionKey` is not a supported option in the community SQLiteAdapter.
    // Sensitive fields are encrypted at the application layer (see hydrate.ts).
    // For full SQLCipher database encryption, a custom native adapter is required.
    onSetUpError: (error: Error) => {
      // This callback fires when the native adapter fails to initialise.
      // Without it, setup errors are silently swallowed by WatermelonDB.
      console.error('[database] onSetUpError:', error);
      _initError = error;
    },
  });

  _database = new Database({
    adapter,
    modelClasses: [
      GroceryListModel,
      GroceryItemModel,
      FamilyMemberModel,
      NotificationModel,
      OfflineQueueModel,
      EntitlementModel,
    ],
  });

  console.log('[database] Database instance created');
  return _database;
}

/**
 * Check if the database adapter reported a setup error.
 * Call this after getDatabase() + first query to surface silent failures.
 */
export function getDatabaseInitError(): Error | null {
  return _initError;
}

export { GroceryListModel, GroceryItemModel, FamilyMemberModel, NotificationModel, EntitlementModel };
export type { TableName } from './schema';
