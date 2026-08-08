/**
 * Regression test for M3 — WatermelonDB schema downgrade detection.
 *
 * ─── What actually happens on a downgrade, per primary source ────────────────
 *
 * The audit describes the diverged schema versions (pantryrun 6, the retired
 * grocery-app 5) under one bundle id and one dbName. What it does not say — and
 * what makes this worse than "WatermelonDB will not migrate downward" — is that
 * every native driver treats a NEWER on-disk database as a FRESH INSTALL:
 *
 *   node_modules/@nozbe/watermelondb/native/shared/DatabaseBridge.cpp:88-100
 *     } else {
 *         consoleLog("Database has newer version (...) than what the app
 *                     supports (...). Will reset database.");
 *         response.setProperty(rt, "code", "schema_needed");
 *     }
 *
 *   native/android/.../WMDatabaseDriver.java:249-261   — same branch, NeedsSetup
 *   native/ios/.../WMDatabaseBridge.m:64-67            — same three-way result
 *
 * `schema_needed` sends the JS adapter down `_setUpWithSchema`
 * (adapters/sqlite/index.js:88-93, :133-142), which calls native
 * `unsafeResetDatabase`. Every list, every item and every queued offline edit
 * is dropped, silently, before React even mounts. The persisted version is
 * never handed to JS on that branch, so nothing downstream can notice.
 *
 * ─── How this test reproduces it ─────────────────────────────────────────────
 *
 * `FakeSQLiteAdapter` below transcribes BOTH layers: the native three-way
 * comparison (as a dispatcher, which is the only thing the JS adapter can talk
 * to) and the JS `_init` that reacts to it. So the destructive branch is
 * exercised for real rather than assumed, and the guard is exercised at the
 * same seam it occupies on device. The mock records every call to the
 * destructive path; the assertions that matter are the ones proving it was
 * NEVER called on a downgrade.
 *
 * File placement note: jest.config.js pins `roots: ['<rootDir>/__tests__']`, so
 * a test under src/storage/ would never run. This is a new, uniquely named file.
 */

import fs from 'fs';
import path from 'path';

// ─── Simulated on-disk state ─────────────────────────────────────────────────
// Stands in for SQLite's `PRAGMA user_version`.

let persistedUserVersion = 0;

/** Every schema.version that a destructive `setUpWithSchema` was run with. */
let destructiveSetups: number[] = [];
/** Every [fromVersion, toVersion] pair a non-destructive migration ran with. */
let migrationRuns: Array<[number, number]> = [];
/** Every adapter the code under test constructed, in order. */
let createdAdapters: any[] = [];
/** Every native call, as `<adapter index>:<method>`. */
let dispatchLog: string[] = [];
/** Makes the probe's `initialize` fail the way a rejected bridge call does. */
let probeInitializeFails = false;
/**
 * Release-build Android: `initialize` REJECTS on a newer-than-build database
 * instead of answering `schema_needed`. See the "release Android" describe and
 * the WMDatabaseDriver tripwire below for why.
 */
let nativeRejectsWhenNewer = false;
/** Makes the REAL adapter's `initialize` reject for a non-schema reason. */
let realInitializeError: Error | null = null;

jest.mock('@nozbe/watermelondb/adapters/sqlite', () => {
  // moduleNameMapper points BOTH '@nozbe/watermelondb' and its subpaths at
  // __mocks__/watermelondb.ts, so this factory replaces that whole module.
  // Re-export the real shim and override only the adapter (its default export).
  const shim = jest.requireActual('../__mocks__/watermelondb');

  /**
   * The native side: DatabaseBridge.cpp:79-142 for the version comparison, and
   * WMDatabaseBridge.java:46-67 + connectDriver for the connection lifecycle.
   * Everything is deferred, because the bridge is asynchronous and a guard that
   * only works synchronously would be a lie.
   *
   * The lifecycle matters as much as the comparison: `initialize` only connects
   * the driver when the versions already match. Otherwise the connection is
   * left Waiting and every other call is QUEUED there until a setUpWith* call
   * connects it. A refusal that never sets up therefore leaves those queued
   * calls hanging forever, which is what the JS-side buffering exists to avoid.
   */
  function connect(adapter: any): void {
    adapter.__connected = true;
    const queued = adapter.__pending;
    adapter.__pending = [];
    queued.forEach((run: () => void) => run());
  }

  function nativeCall(
    adapter: any,
    method: string,
    args: any[],
    callback: (r: any) => void,
  ): void {
    dispatchLog.push(`${createdAdapters.indexOf(adapter)}:${method}`);
    setImmediate(() => {
      if (method === 'initialize') {
        const expected = args[1];
        if (probeInitializeFails && expected >= 1000) {
          // WMDatabaseBridge.java:64-66 — the catch-all `promise.reject(e)`.
          callback({ error: new Error('native bridge failure') });
        } else if (realInitializeError && expected < 1000) {
          callback({ error: realInitializeError });
        } else if (persistedUserVersion === expected) {
          connect(adapter);
          callback({ value: { code: 'ok' } });
        } else if (persistedUserVersion === 0) {
          callback({ value: { code: 'schema_needed' } });
        } else if (persistedUserVersion < expected) {
          callback({
            value: { code: 'migrations_needed', databaseVersion: persistedUserVersion },
          });
        } else if (nativeRejectsWhenNewer) {
          // Release-build Android. isCompatible logs "Will reset database"
          // through `log`, which is null in any !BuildConfig.DEBUG build, so the
          // NullPointerException escapes the WMDatabaseDriver constructor into
          // initialize's catch-all `promise.reject(e)`.
          callback({ error: new Error('java.lang.NullPointerException') });
        } else {
          // Debug Android / iOS / JSI: "Database has newer version than what the
          // app supports. Will reset database." — no databaseVersion reported.
          callback({ value: { code: 'schema_needed' } });
        }
      } else if (method === 'setUpWithSchema') {
        // native unsafeResetDatabase — the whole file is dropped here.
        destructiveSetups.push(args[2]);
        persistedUserVersion = args[2];
        connect(adapter);
        callback({ value: undefined });
      } else if (method === 'setUpWithMigrations') {
        migrationRuns.push([args[2], args[3]]);
        persistedUserVersion = args[3];
        connect(adapter);
        callback({ value: undefined });
      } else if (!adapter.__connected) {
        // Connection.Waiting — queued, and only ever run if setup completes.
        adapter.__pending.push(() => callback({ value: 0 }));
      } else {
        callback({ value: 0 });
      }
    });
  }

  class FakeSQLiteAdapter {
    schema: any;
    migrations: any;
    dbName: string;
    _dispatcher: any;
    _initPromise: Promise<void>;
    __connected = false;
    __pending: Array<() => void> = [];

    constructor(options: any) {
      this.schema = options.schema;
      this.migrations = options.migrations;
      this.dbName = options.dbName;
      this._dispatcher = {
        call: (method: string, args: any[], cb: (r: any) => void) =>
          nativeCall(this, method, args, cb),
      };
      createdAdapters.push(this);
      // `_init` is invoked SYNCHRONOUSLY here, as toPromise does
      // (index.js:45-50, utils/fp/Result:8-19). That is what gives the guard a
      // chance to install itself before getDatabase() returns; only the
      // dispatcher round trips are asynchronous. Prototype overrides are
      // already in place — they were assigned at module load, not in a
      // constructor.
      this._initPromise = new Promise<void>((resolve, reject) => {
        this._init((result: any) => {
          if (result && result.error) {
            // devSetupCallback (adapters/common.js:46-51) — no NODE_ENV gate,
            // so onSetUpError fires in production too.
            options.onSetUpError && options.onSetUpError(result.error);
            reject(result.error);
          } else {
            resolve();
          }
        });
      });
    }

    get initializingPromise(): Promise<void> {
      return this._initPromise;
    }

    // adapters/sqlite/index.js:79-105.
    _init(callback: (r: any) => void): void {
      this._dispatcher.call(
        'initialize',
        [this.dbName, this.schema.version],
        (result: any) => {
          if (result.error) {
            callback(result);
            return;
          }
          const status = result.value;
          if (status.code === 'schema_needed') {
            this._setUpWithSchema(callback);
          } else if (status.code === 'migrations_needed') {
            this._setUpWithMigrations(status.databaseVersion, callback);
          } else {
            callback({ value: undefined });
          }
        },
      );
    }

    _setUpWithSchema(callback: (r: any) => void): void {
      this._dispatcher.call(
        'setUpWithSchema',
        [this.dbName, '<encoded schema>', this.schema.version],
        callback,
      );
    }

    _setUpWithMigrations(databaseVersion: number, callback: (r: any) => void): void {
      if (!this.migrations) {
        // ":131-134 — Migrations not available for this version range,
        //  resetting database instead". Also destructive.
        this._setUpWithSchema(callback);
        return;
      }
      this._dispatcher.call(
        'setUpWithMigrations',
        [this.dbName, '<steps>', databaseVersion, this.schema.version],
        callback,
      );
    }

    /** Stands in for every query method; they all route through _dispatcher. */
    count(_query: any, callback: (r: any) => void): void {
      this._dispatcher.call('count', [], callback);
    }
  }

  return { ...shim, __esModule: true, default: FakeSQLiteAdapter };
});

// Imported after jest.mock so the factory is in place.
// eslint-disable-next-line import/first
import {
  getDatabase,
  getDatabaseInitError,
  getSchemaDowngrade,
  unsafeResetForDowngrade,
  SchemaDowngradeError,
  __resetDatabaseForTests,
} from '../src/storage/database';
// eslint-disable-next-line import/first
import { schema } from '../src/storage/schema';

const BUILD_VERSION = schema.version;

/**
 * Let the adapter finish initialising. Setup runs over several bridge round
 * trips (initialize → probe adapter → its initialize → decision), each of which
 * is a macrotask, so drain a handful.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
}

/** Run a query through the adapter the way DatabaseAdapterCompat does. */
function query(adapter: any): Promise<unknown> {
  return new Promise((resolve, reject) => {
    adapter.count({}, (r: any) => (r.error ? reject(r.error) : resolve(r.value)));
  });
}

/**
 * Resolves with 'HUNG' if `p` has not settled shortly. A hang is the failure
 * mode under test, and reporting it as "resolved instead of rejected" beats
 * waiting out jest's five-second timeout.
 */
function orHang(p: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve('HUNG'), 250);
    }),
  ]).finally(() => clearTimeout(timer));
}

beforeEach(() => {
  destructiveSetups = [];
  migrationRuns = [];
  createdAdapters = [];
  dispatchLog = [];
  probeInitializeFails = false;
  nativeRejectsWhenNewer = false;
  realInitializeError = null;
  persistedUserVersion = 0;
  __resetDatabaseForTests();
});

describe('schema downgrade detection (M3)', () => {
  it('destroys nothing when the on-disk database was written by a newer build', async () => {
    // A device that ran schema 6 and then received a schema-5 build.
    persistedUserVersion = BUILD_VERSION + 1;

    getDatabase();
    await settle();

    // The assertion that encodes "safely": the user's lists and unsynced
    // offline edits are still on disk.
    expect(destructiveSetups).toEqual([]);
    expect(persistedUserVersion).toBe(BUILD_VERSION + 1);
  });

  it('fails the launch query loudly instead of hanging on it', async () => {
    persistedUserVersion = BUILD_VERSION + 1;

    // App.tsx:122-123 exactly: getDatabase(), then immediately a query, with no
    // await in between — adapter methods do not wait for initializingPromise,
    // so this call is already on its way to native while the guard is still
    // deciding. If it is left in the native Waiting queue nothing ever answers
    // it and the app hangs on the splash screen forever.
    getDatabase();
    const inFlight = query(createdAdapters[0]);

    await expect(orHang(inFlight)).rejects.toThrow(SchemaDowngradeError);
    expect(getDatabaseInitError()).toBeInstanceOf(SchemaDowngradeError);
  });

  it('fails calls made after the refusal too', async () => {
    persistedUserVersion = BUILD_VERSION + 1;

    // hydrate.ts, entitlements.ts, offline-queue-store.ts,
    // NotificationRepository.ts, siri.ts and dataWipe.ts all arrive later.
    getDatabase();
    await settle();

    await expect(orHang(query(createdAdapters[0]))).rejects.toThrow(SchemaDowngradeError);
  });

  it('reports both versions so the user can be told what happened', async () => {
    persistedUserVersion = BUILD_VERSION + 1;

    getDatabase();
    await settle();

    expect(getSchemaDowngrade()).toEqual({
      persistedVersion: BUILD_VERSION + 1,
      buildVersion: BUILD_VERSION,
    });
    const err = getDatabaseInitError() as SchemaDowngradeError;
    expect(err.persistedVersion).toBe(BUILD_VERSION + 1);
    expect(err.buildVersion).toBe(BUILD_VERSION);
    // The message has to survive on its own — App.tsx renders it verbatim.
    expect(err.message).toContain('newer version of the app');
    expect(err.message).toContain('has not synced yet');
  });

  it('discards the newer database only on an explicit, informed reset', async () => {
    persistedUserVersion = BUILD_VERSION + 1;
    getDatabase();
    await settle();
    expect(destructiveSetups).toEqual([]);

    // The consented "erase and start over" path.
    unsafeResetForDowngrade();
    await settle();

    expect(destructiveSetups).toEqual([BUILD_VERSION]);
    expect(persistedUserVersion).toBe(BUILD_VERSION);
    expect(getSchemaDowngrade()).toBeNull();
    // …and the fresh database works.
    await expect(query(createdAdapters[createdAdapters.length - 1])).resolves.toBe(0);
  });

  it('never mistakes a failed probe for a fresh install', async () => {
    // A rejected `initialize` carries no value; reading `status.databaseVersion`
    // off it yields 0, which is indistinguishable from "no database yet" — and
    // that is the one confusion that costs the user their data. Policy on an
    // unanswerable probe is to proceed (see the comment on that branch), but it
    // must be said out loud, not inferred as a fresh install.
    persistedUserVersion = BUILD_VERSION + 1;
    probeInitializeFails = true;
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

    getDatabase();
    await settle();

    expect(
      errors.mock.calls.some((c) => String(c[0]).includes('Schema-downgrade probe failed')),
    ).toBe(true);
    errors.mockRestore();
  });

  it('opens normally on a fresh install', async () => {
    persistedUserVersion = 0;

    getDatabase();
    await settle();

    expect(getSchemaDowngrade()).toBeNull();
    expect(getDatabaseInitError()).toBeNull();
    expect(destructiveSetups).toEqual([BUILD_VERSION]); // first-run schema setup
  });

  it('opens normally and migrates when the on-disk version is older', async () => {
    persistedUserVersion = BUILD_VERSION - 1;

    getDatabase();
    await settle();

    expect(getSchemaDowngrade()).toBeNull();
    expect(destructiveSetups).toEqual([]);
    expect(migrationRuns).toEqual([[BUILD_VERSION - 1, BUILD_VERSION]]);
  });

  it('opens normally when the on-disk version already matches', async () => {
    persistedUserVersion = BUILD_VERSION;

    getDatabase();
    await settle();

    expect(getSchemaDowngrade()).toBeNull();
    expect(destructiveSetups).toEqual([]);
    expect(migrationRuns).toEqual([]);
  });

  it('never writes from the probe: it only ever dispatches initialize', async () => {
    persistedUserVersion = BUILD_VERSION + 1;

    getDatabase();
    await settle();

    // createdAdapters[0] is the real one; the probe is created afterwards,
    // inside the guard, and asks native exactly one question. Exactly one probe,
    // too — the refusal travels back up through _init, which must not re-probe.
    expect(createdAdapters.length).toBe(2);
    expect(dispatchLog.filter((c) => c.startsWith('1:'))).toEqual(['1:initialize']);
    expect(createdAdapters[1].schema.version).toBeGreaterThan(BUILD_VERSION);
  });
});

/**
 * The shipping configuration. src/storage/database.ts passes `jsi: false`, and
 * makeDispatcher/index.native.js:127-135 maps that to the asynchronous
 * NativeModules.WMDatabaseBridge — the Java bridge, not DatabaseBridge.cpp. On a
 * RELEASE build that bridge never produces `schema_needed` for a newer-than-build
 * database: WMDatabaseDriver.isCompatible reaches its newer-than-build branch and
 * calls `log.info(...)` unguarded, while the constructor set `log = null` because
 * !BuildConfig.DEBUG. The NullPointerException leaves the driver constructor and
 * lands in initialize's `catch (Exception e) { promise.reject(e); }`.
 *
 * So on the ONLY configuration currently in Play closed testing, `_init` sees an
 * error and returns early — `_setUpWithSchema`, where the other half of the guard
 * lives, is never called. Everything below is about that path.
 */
describe('schema downgrade detection on release-build Android', () => {
  beforeEach(() => {
    nativeRejectsWhenNewer = true;
    persistedUserVersion = BUILD_VERSION + 1;
  });

  it('detects the downgrade even though native rejected initialize', async () => {
    getDatabase();
    await settle();

    expect(getSchemaDowngrade()).toEqual({
      persistedVersion: BUILD_VERSION + 1,
      buildVersion: BUILD_VERSION,
    });
    // The opaque NullPointerException is replaced by something the UI can act
    // on; App.tsx branches on this type to offer the erase flow.
    expect(getDatabaseInitError()).toBeInstanceOf(SchemaDowngradeError);
    expect((getDatabaseInitError() as SchemaDowngradeError).persistedVersion).toBe(
      BUILD_VERSION + 1,
    );
    expect(destructiveSetups).toEqual([]);
    expect(persistedUserVersion).toBe(BUILD_VERSION + 1);
  });

  it('fails the launch query with the same error rather than the raw NPE', async () => {
    getDatabase();
    const inFlight = query(createdAdapters[0]);

    await expect(orHang(inFlight)).rejects.toThrow(SchemaDowngradeError);
  });

  it('still allows the consented erase, which cannot go through initialize', async () => {
    getDatabase();
    await settle();
    expect(destructiveSetups).toEqual([]);

    // If the erase re-ran `initialize` it would hit the same NPE and the user
    // would be stuck on the error screen with no way out.
    unsafeResetForDowngrade();
    await settle();

    expect(destructiveSetups).toEqual([BUILD_VERSION]);
    expect(persistedUserVersion).toBe(BUILD_VERSION);
    expect(getSchemaDowngrade()).toBeNull();
    await expect(query(createdAdapters[createdAdapters.length - 1])).resolves.toBe(0);
  });

  it('leaves an unrelated native failure reported as itself', async () => {
    // `initialize` also rejects for reasons that have nothing to do with the
    // schema — disk full, file locked. With nothing newer on disk, that error
    // must survive rather than be relabelled as a downgrade the user can "fix"
    // by erasing data.
    persistedUserVersion = 0;
    realInitializeError = new Error('disk I/O error');

    getDatabase();
    await settle();

    expect(getSchemaDowngrade()).toBeNull();
    expect(getDatabaseInitError()).toBe(realInitializeError);
    expect(destructiveSetups).toEqual([]);
  });
});

describe('WatermelonDB internals this fix depends on', () => {
  // The guard rides on adapter internals that carry no semver guarantee, and on
  // a native branch that has no JS-visible signal at all. Pin both to the
  // installed source so a watermelondb bump fails CI instead of production.
  // Same idea as grocery-app's native-api-fidelity.test.ts (audit L9).
  const wmdb = path.join(__dirname, '..', 'node_modules', '@nozbe', 'watermelondb');
  const adapterSrc = fs.readFileSync(
    path.join(wmdb, 'adapters', 'sqlite', 'index.js'),
    'utf8',
  );

  it('queries are still dispatched without waiting for setup', () => {
    // The reason _init has to buffer them: nothing here consults _initPromise,
    // so App.tsx's first fetchCount() reaches the dispatcher immediately.
    expect(adapterSrc).toContain('_proto.count = function (query, callback)');
    expect(adapterSrc).toMatch(
      /_proto\.count = function \(query, callback\) \{[\s\S]{0,200}this\._dispatcher\.call\('count'/,
    );
    expect(adapterSrc).not.toMatch(/_proto\.count[\s\S]{0,200}_initPromise/);
  });

  it('_setUpWithSchema is still the only destructive path', () => {
    expect(adapterSrc).toContain('_proto._setUpWithSchema = function (callback)');
    // …reached from the schema_needed branch of _init…
    expect(adapterSrc).toContain("'schema_needed' === status.code");
    expect(adapterSrc).toContain('_this2._setUpWithSchema(callback)');
    // …and from the no-migration-steps fallthrough of _setUpWithMigrations,
    // which is why one override covers both routes.
    expect(adapterSrc).toContain(
      'Migrations not available for this version range, resetting database instead',
    );
    expect(adapterSrc).toMatch(
      /Migrations not available[\s\S]{0,200}this\._setUpWithSchema\(callback\)/,
    );
    // …and it is what calls native unsafeResetDatabase.
    expect(adapterSrc).toContain("this._dispatcher.call('setUpWithSchema'");
  });

  it('the probe can still learn the on-disk version from _init', () => {
    expect(adapterSrc).toContain('_proto._init = function (callback)');
    expect(adapterSrc).toContain(
      "this._dispatcher.call('initialize', [this.dbName, this.schema.version]",
    );
    // Only this branch reports the persisted version back to JS.
    expect(adapterSrc).toContain("'migrations_needed' === status.code");
    expect(adapterSrc).toContain('status.databaseVersion');
    // …and the constructor still exposes the promise the probe awaits.
    expect(adapterSrc).toContain('key: "initializingPromise"');
  });

  it('native drivers still reset the database when it is newer than the build', () => {
    const cpp = fs.readFileSync(
      path.join(wmdb, 'native', 'shared', 'DatabaseBridge.cpp'),
      'utf8',
    );
    expect(cpp).toContain('Will reset database');

    const java = fs.readFileSync(
      path.join(
        wmdb,
        'native',
        'android',
        'src',
        'main',
        'java',
        'com',
        'nozbe',
        'watermelondb',
        'WMDatabaseDriver.java',
      ),
      'utf8',
    );
    expect(java).toContain('Will reset database');
    // The newer-than-build branch returns NeedsSetup, i.e. a full wipe, and
    // carries no databaseVersion — which is why the probe has to exist.
    expect(java).toMatch(
      /Will reset database[\s\S]{0,120}new SchemaCompatibility\.NeedsSetup\(\)/,
    );
  });

  it('release-build Android still NPEs on that branch instead of reporting it', () => {
    // This is the premise the whole _init-error half of the guard rests on, and
    // it is invisible from JS, so pin it here.
    const java = fs.readFileSync(
      path.join(
        wmdb,
        'native',
        'android',
        'src',
        'main',
        'java',
        'com',
        'nozbe',
        'watermelondb',
        'WMDatabaseDriver.java',
      ),
      'utf8',
    );

    // The logger exists only in debug builds…
    expect(java).toMatch(/if \(BuildConfig\.DEBUG\)[\s\S]{0,120}this\.log = null;/);
    // …which is why the sibling call site null-checks…
    expect(java).toMatch(
      /if \(log != null\) \{\s*\n\s*log\.info\("Unsafe reset database"\)/,
    );
    // …and the newer-than-build branch does NOT: `else {` runs straight into
    // log.info. On a release build that is a NullPointerException out of the
    // driver constructor, so `initialize` REJECTS and the JS adapter never
    // reaches _setUpWithSchema. If a watermelondb bump adds the missing guard
    // here, this fails — at that point release Android would start answering
    // `schema_needed` like debug does, and the _init-error branch of the guard
    // becomes belt-and-braces rather than the only thing that fires.
    expect(java).toMatch(
      /\} else \{\s*\n\s*log\.info\("com\.nozbe\.watermelondb\.Database has newer version/,
    );
  });

  it('setUpWithSchema still bypasses the version check, so consented erase works', () => {
    // The erase path cannot re-run `initialize` (it is what throws above). It
    // dispatches setUpWithSchema instead, whose driver constructor takes an
    // explicit Schema and never calls isCompatible.
    const java = fs.readFileSync(
      path.join(
        wmdb,
        'native',
        'android',
        'src',
        'main',
        'java',
        'com',
        'nozbe',
        'watermelondb',
        'WMDatabaseDriver.java',
      ),
      'utf8',
    );
    expect(java).toMatch(
      /public WMDatabaseDriver\(Context context, String dbName, Schema schema, boolean unsafeNativeReuse\) \{[\s\S]{0,160}unsafeResetDatabase\(schema\);/,
    );
    expect(java).not.toMatch(
      /public WMDatabaseDriver\(Context context, String dbName, Schema schema[\s\S]{0,160}isCompatible/,
    );
    const bridge = fs.readFileSync(
      path.join(
        wmdb,
        'native',
        'android',
        'src',
        'main',
        'java',
        'com',
        'nozbe',
        'watermelondb',
        'WMDatabaseBridge.java',
      ),
      'utf8',
    );
    // …and it connects a tag that `initialize` never registered.
    expect(bridge).toMatch(
      /public void setUpWithSchema\([\s\S]{0,300}connectDriver\(tag, new WMDatabaseDriver\(reactContext, databaseName, new Schema\(/,
    );
    expect(bridge).toMatch(
      /private void connectDriver\([\s\S]{0,160}connections\.put\(connectionTag, new Connection\.Connected\(driver\)\);/,
    );
    // …and the getQueue it calls FIRST tolerates a tag that was never
    // registered, which is exactly the state the erase path is in: on a release
    // downgrade `initialize` threw before its connections.put ran, and
    // unsafeResetForDowngrade mints a new adapter with a new tag regardless. If
    // this ever dereferences instead of returning an empty list, the consented
    // erase throws on every platform and the user is stranded.
    expect(bridge).toMatch(
      /private List<Runnable> getQueue\(int connectionTag\) \{[\s\S]{0,400}\} else \{\s*\n\s*queue = new ArrayList<>\(\);/,
    );
  });

  it('the probe still needs its own adapter: native rejects a second initialize', () => {
    const bridge = fs.readFileSync(
      path.join(
        wmdb,
        'native',
        'android',
        'src',
        'main',
        'java',
        'com',
        'nozbe',
        'watermelondb',
        'WMDatabaseBridge.java',
      ),
      'utf8',
    );
    expect(bridge).toMatch(
      /connections\.containsKey\(tag\)[\s\S]{0,160}already set up/,
    );
  });

  it('migrations still stop at the schema version, so the probe offset is safe', () => {
    // schemaMigrations validates maxVersion === schema.version, so the probe
    // adapter is constructed WITHOUT migrations; assert that validation is
    // still what forces that choice.
    const src = fs.readFileSync(path.join(wmdb, 'adapters', 'common.js'), 'utf8');
    expect(src).toContain('Missing migration');
    // …and that a schema-only adapter (no migrations) is still valid.
    expect(src).toContain('if (migrations) {');
  });
});
