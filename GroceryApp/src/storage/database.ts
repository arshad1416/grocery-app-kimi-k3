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
 * ─── Safety: Schema Downgrade ───────────────────────────────────────────────
 *
 * A build whose schema version is OLDER than the database already on disk
 * silently erases it. The guard for that lives inside the adapter itself —
 * see GuardedSQLiteAdapter below — so it covers getDatabase() and therefore
 * every caller, with nothing to remember to call first.
 *
 * It has to cover two different native reactions to the same situation: debug
 * Android, iOS and JSI report `schema_needed` and go on to wipe the file, while
 * release Android throws a NullPointerException out of `initialize` instead and
 * never gets that far. Both are handled in _init below.
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
let _downgrade: { persistedVersion: number; buildVersion: number } | null = null;
/** Set only by unsafeResetForDowngrade() — see there. */
let _consentedWipe = false;

const DB_NAME = 'groceryapp';

/**
 * Thrown when the SQLite file on this device was written by a build with a
 * NEWER schema than this one. Carries both versions so the UI can say which.
 */
export class SchemaDowngradeError extends Error {
  readonly persistedVersion: number;
  readonly buildVersion: number;

  constructor(persistedVersion: number, buildVersion: number) {
    super(
      `The PantryRun data on this device was written by a newer version of the app ` +
        `(database format v${persistedVersion}); this version only understands v${buildVersion}. ` +
        `Opening it would erase every list and every offline edit that has not synced yet. ` +
        `Reinstall the newer version to get your data back, or erase the local data to start over.`,
    );
    this.name = 'SchemaDowngradeError';
    this.persistedVersion = persistedVersion;
    this.buildVersion = buildVersion;
  }
}

/**
 * Reads the on-disk schema version WITHOUT letting WatermelonDB act on it.
 *
 * Why this is not just a PRAGMA read: every native driver collapses "database
 * is newer than the build" into the same result as "no database at all", and
 * never tells JS the on-disk version —
 *
 *   native/shared/DatabaseBridge.cpp:88-100
 *   native/android/.../WMDatabaseDriver.java:249-261  (→ NeedsSetup)
 *   native/ios/.../WMDatabaseBridge.m:64-67
 *
 * so the JS adapter goes down `_setUpWithSchema` → native `unsafeResetDatabase`
 * and the whole file is gone before anything downstream can object. The only
 * branch that reports the persisted version back to JS is `migrations_needed`,
 * which fires when the on-disk version is LOWER than the version we ask for.
 *
 * So: open a throwaway adapter claiming an absurdly high schema version, which
 * forces that branch for any real database. `initialize` only reads
 * `user_version`; every mutation lives in the `setUpWith*` calls the adapter
 * makes afterwards — so the probe overrides `_init` itself and dispatches
 * nothing but `initialize`. There is no reachable path from the override to
 * either setup call, which is what makes the probe incapable of writing even
 * if it goes wrong.
 *
 * It needs its own adapter instance because the native bridge keys connections
 * by tag and rejects a second `initialize` on one that already has a driver
 * (WMDatabaseBridge.java:47-49) — the real adapter cannot ask twice.
 *
 * Returns the persisted version, 0 for a fresh install, or null when the probe
 * could not run (see the guard below).
 */
const PROBE_VERSION_OFFSET = 1000; // far beyond any plausible schema version

async function readPersistedSchemaVersion(): Promise<number | null> {
  if (typeof (SQLiteAdapter.prototype as any)._init !== 'function') {
    // A watermelondb upgrade renamed the internal this rides on. Degrade to the
    // old behaviour rather than bricking launch; __tests__/schema-downgrade
    // pins the name so this should fail CI long before it ships.
    console.warn('[database] Schema-downgrade probe unavailable (adapter internals changed)');
    return null;
  }

  let persisted = 0;
  const Probe: any = class extends (SQLiteAdapter as any) {};
  // Assigned on the prototype, not in a constructor or class field, so it is
  // already in place when the base constructor kicks off initialisation.
  Probe.prototype._init = function (this: any, callback: (r: any) => void): void {
    this._dispatcher.call(
      'initialize',
      [this.dbName, this.schema.version],
      (result: any) => {
        if (result && result.error) {
          // A failed probe must NOT look like "fresh install, nothing to lose".
          // Propagate so the caller takes its documented fallback and says so.
          callback(result);
          return;
        }
        const status = result.value;
        // Anything other than `migrations_needed` means there is no database to
        // be older than us — at this inflated version that can only be a file
        // with user_version 0.
        persisted =
          status && status.code === 'migrations_needed' ? status.databaseVersion : 0;
        callback({ value: undefined });
      },
    );
  };

  // ponytail: the probe's native connection is never closed — the bridge has no
  // close for a connection still in its "waiting for setup" state. That is one
  // leaked handle, on a file the probe never writes records to, and only on the
  // launches where a wipe was about to happen (a fresh install, or a downgrade).
  // If watermelondb ever exposes a teardown, close it here.
  const probe = new Probe({
    // No `migrations`: validateAdapter (adapters/common.js:23-31) requires
    // migrations.maxVersion === schema.version, which the offset breaks.
    schema: { ...schema, version: schema.version + PROBE_VERSION_OFFSET },
    jsi: false,
    dbName: DB_NAME,
  });
  await probe.initializingPromise;
  return persisted;
}

/**
 * The real adapter, with the one destructive path guarded.
 *
 * `_setUpWithSchema` is the ONLY method that wipes the file — it is where
 * `_init`'s `schema_needed` branch lands (adapters/sqlite/index.js:88-93) and
 * also where `_setUpWithMigrations` falls through when no migration steps cover
 * the on-disk version (:131-134). Guarding it therefore guards every route to
 * `unsafeResetDatabase`, and because the guard is in the adapter rather than in
 * a function callers must remember to await, it protects getDatabase() and so
 * every caller in the app.
 *
 * Native has already told us `schema_needed` by the time we get here, which
 * means EITHER a fresh install OR a database newer than this build — the two
 * are indistinguishable from JS (see readPersistedSchemaVersion). Only the
 * first is safe to wipe, so we probe for the real on-disk version and refuse
 * if it is ahead of us. That costs one extra native `initialize` on first
 * launch, and nothing on any launch after that.
 */
const baseSetUpWithSchema = (SQLiteAdapter.prototype as any)._setUpWithSchema;
const baseInit = (SQLiteAdapter.prototype as any)._init;

const GuardedSQLiteAdapter: any = class extends (SQLiteAdapter as any) {};

/**
 * Holds queries in JS until setup has finished, one way or the other.
 *
 * Adapter methods do NOT wait for `initializingPromise` — `count`, `query` and
 * friends call `_dispatcher.call` straight away. Since getDatabase() returns
 * before the asynchronous setup completes, App.tsx's first `fetchCount()` is
 * already on its way to native while we are still deciding. Native has parked
 * the connection in a "waiting for setup" state (WMDatabaseBridge.java:56) and
 * queues it there; if we then refuse to set up, that queue is never flushed and
 * the call hangs forever — the app would sit on the splash screen with no
 * explanation, which is not meaningfully better than the silent wipe.
 *
 * So everything except the setup calls themselves is buffered here and either
 * replayed or failed once we know. After that the real dispatcher is restored
 * and this costs nothing.
 */
const SETUP_METHODS = ['initialize', 'setUpWithSchema', 'setUpWithMigrations'];

GuardedSQLiteAdapter.prototype._init = function (
  this: any,
  callback: (r: any) => void,
): void {
  const real = this._dispatcher;
  const held: Array<[string, any[], (r: any) => void]> = [];
  let settled = false;

  this._dispatcher = {
    call: (method: string, args: any[], cb: (r: any) => void) => {
      if (settled || SETUP_METHODS.includes(method)) {
        real.call(method, args, cb);
        return;
      }
      held.push([method, args, cb]);
    },
  };

  const finish = (result: any): void => {
    settled = true;
    const error = result && result.error;
    if (error) {
      // hydrate.ts, entitlements.ts, offline-queue-store.ts,
      // NotificationRepository.ts, siri.ts and dataWipe.ts all reach native
      // through this one dispatcher, so this is what makes the failure loud
      // for all of them rather than only for whoever asked first.
      this._dispatcher = {
        call: (_m: string, _a: any[], cb: (r: any) => void) => cb({ error }),
      };
      held.forEach(([, , cb]) => cb({ error }));
    } else {
      this._dispatcher = real;
      held.forEach(([method, args, cb]) => real.call(method, args, cb));
    }
    callback(result);
  };

  // The consented erase must NOT go through `initialize`: on a release Android
  // build that call is precisely what fails on a downgrade (see below), so
  // asking again would fail identically and the user could never get out of the
  // error screen. `setUpWithSchema` builds its driver from an explicit Schema
  // and never compares versions (WMDatabaseBridge.java:69-71 →
  // WMDatabaseDriver.java:46-49), and connectDriver registers a tag `initialize`
  // never registered (:196-204) — so it is reachable when `initialize` is not.
  // Skipping `initialize` leaves that tag with no Connection at all, which is
  // fine on both platforms: getQueue returns an empty list for an unknown tag
  // (WMDatabaseBridge.java:155-166) and iOS enumerates a nil _queue[tag]
  // (objc/WMDatabaseBridge.m:259-269). Both are pinned in the tripwires.
  if (_consentedWipe) {
    this._setUpWithSchema(finish);
    return;
  }

  baseInit.call(this, (result: any) => {
    // Already decided: on the `schema_needed` platforms the refusal comes back
    // up through here from _setUpWithSchema, which has done the probe. Do not
    // pay for a second one.
    if (!result || !result.error || result.error instanceof SchemaDowngradeError) {
      finish(result);
      return;
    }

    // A rejected `initialize` is the OTHER face of a downgrade, and it is the
    // one the shipping build wears. getDatabase() passes `jsi: false`, which
    // makeDispatcher/index.native.js:127-135 resolves to the asynchronous Java
    // bridge. There, WMDatabaseDriver.isCompatible logs its "Will reset
    // database" line through `log` — which the constructor sets to null
    // whenever !BuildConfig.DEBUG (:63-67), and which, unlike the sibling call
    // at :222, is NOT null-checked (:258). The NullPointerException escapes the
    // driver constructor into initialize's catch-all `promise.reject(e)`
    // (WMDatabaseBridge.java:63-65), so `_init` sees an error and returns
    // before `_setUpWithSchema` — where the other half of this guard lives — is
    // ever called. Without this branch the guard would be dead code on the only
    // configuration in Play closed testing.
    //
    // Probing is safe here for the same reason it is safe everywhere else: it
    // asks for schema.version + 1000, so a real newer-than-us database takes
    // the NeedsMigration branch (:255-257) and never reaches that log line.
    readPersistedSchemaVersion().then(
      (persisted) => {
        if (persisted === null || persisted <= schema.version) {
          // Nothing newer on disk: this is a genuine native failure (disk full,
          // file locked). Report it as itself — telling the user their data is
          // "from a newer version" when it is not would push them toward an
          // erase that solves nothing and costs them everything.
          finish(result);
          return;
        }
        _downgrade = { persistedVersion: persisted, buildVersion: schema.version };
        console.error(
          `[database] Native initialize failed and on-disk schema v${persisted} is newer ` +
            `than this build's v${schema.version}; treating as a schema downgrade`,
        );
        finish({ error: new SchemaDowngradeError(persisted, schema.version) });
      },
      () => finish(result),
    );
  });
};

GuardedSQLiteAdapter.prototype._setUpWithSchema = function (
  this: any,
  callback: (r: any) => void,
): void {
  if (_consentedWipe) {
    baseSetUpWithSchema.call(this, callback);
    return;
  }

  readPersistedSchemaVersion().then(
    (persisted) => {
      if (persisted === null || persisted <= schema.version) {
        baseSetUpWithSchema.call(this, callback);
        return;
      }

      _downgrade = { persistedVersion: persisted, buildVersion: schema.version };
      console.error(
        `[database] Refusing to set up: on-disk schema v${persisted} is newer than this build's v${schema.version}`,
      );

      // Refusing here rejects initializingPromise, fires onSetUpError (→
      // getDatabaseInitError()) and — via the _init wrapper above — fails every
      // buffered and subsequent adapter call with the same error.
      callback({ error: new SchemaDowngradeError(persisted, schema.version) });
    },
    (e) => {
      // The probe could not answer (native rejected `initialize` — disk full,
      // file locked, driver constructor threw). Deliberate policy: proceed with
      // setup, i.e. the pre-fix behaviour, because refusing here would make a
      // fresh install unopenable after any transient native error, and would
      // tell the user their data is "from a newer version" without knowing it.
      // Loud, because on a real downgrade this is the branch that loses data.
      console.error(
        '[database] Schema-downgrade probe failed; proceeding with setup, which ' +
          'WILL erase an existing database if this device is on a newer schema:',
        e,
      );
      baseSetUpWithSchema.call(this, callback);
    },
  );
};

/**
 * The detected downgrade, or null. Non-null only once the adapter has refused
 * to set up. Read this to render the explanation and the erase option.
 */
export function getSchemaDowngrade(): { persistedVersion: number; buildVersion: number } | null {
  return _downgrade;
}

/**
 * Discards a newer-than-this-build database and starts over. DESTRUCTIVE:
 * WatermelonDB's native driver wipes the file as soon as the adapter opens it,
 * and there is no undo — the unsynced offline edits go with it. Only call this
 * from a confirmation flow that has told the user exactly that.
 *
 * Stays armed for the rest of the process: once the wipe has run, the file is
 * at this build's version and the guard has nothing left to catch.
 */
export function unsafeResetForDowngrade(): Database {
  _consentedWipe = true;
  _downgrade = null;
  _initError = null;
  _database = null; // the previous instance's adapter is poisoned
  return getDatabase();
}

/**
 * Returns the WatermelonDB singleton, creating it on first call.
 * Throws if the native SQLite adapter fails to initialise. On a schema
 * downgrade this still returns a Database — every operation on it rejects with
 * SchemaDowngradeError instead, see GuardedSQLiteAdapter. That keeps the
 * consented erase path in Settings reachable rather than bricking launch.
 */
export function getDatabase(): Database {
  if (_database) return _database;

  console.log('[database] Creating SQLiteAdapter (jsi=false)…');

  // Create adapter with migrations enabled. Guarded unless watermelondb has
  // renamed the destructive method out from under us, in which case there is
  // nothing to wrap and we use the adapter as-is.
  const Adapter =
    typeof baseSetUpWithSchema === 'function' && typeof baseInit === 'function'
      ? GuardedSQLiteAdapter
      : SQLiteAdapter;
  const adapter = new Adapter({
    schema,
    migrations,
    // Use JSI for performance (disabled on New Architecture / Hermes)
    jsi: false,
    dbName: DB_NAME,
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

  // `initializingPromise` rejects on a setup error and nothing else awaits it;
  // an unhandled rejection here is noise at best and a crash at worst. The error
  // is already recorded by onSetUpError above.
  Promise.resolve((adapter as any).initializingPromise).catch(() => {});

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

/** Test-only: drop the singleton and any recorded downgrade. */
export function __resetDatabaseForTests(): void {
  _database = null;
  _initError = null;
  _downgrade = null;
  _consentedWipe = false;
}

export { GroceryListModel, GroceryItemModel, FamilyMemberModel, NotificationModel, EntitlementModel };
export type { TableName } from './schema';
