/**
 * Persistence errors surface to the user — regression tests.
 *
 * sync-manager.ts used to swallow a failed WatermelonDB write into a bare
 * console.warn at TWO sites: the Yjs update observer (local edits) and the
 * remote-update path (family members' edits). That is the exact failure class
 * that silently loses data — the suite stayed green while the app saved
 * nothing. Both sites now route through reportPersistError(), which keeps the
 * rejection handled and the console diagnostic, but also sets
 * useSyncStore's error state so SyncIndicator shows a red dot with a message
 * the user can see. The copy says "save", not "sync": the failure is local
 * persistence, and "Sync error" would mislead.
 *
 * Run: npx jest __tests__/persist-error-surfacing.test.ts
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as Y from 'yjs';

// Force every persistence write to fail, so both catch sites fire.
jest.mock('../src/storage/hydrate', () => ({
  persistList: jest.fn(() => Promise.reject(new Error('disk full'))),
  persistItem: jest.fn(() => Promise.reject(new Error('disk full'))),
  loadItemsFromDB: jest.fn(() => Promise.resolve([])),
  loadListsFromDB: jest.fn(() => Promise.resolve([])),
}));

import { SyncManager } from '../src/sync/sync-manager';
import { useSyncStore } from '../src/state/useSyncStore';
import { hydrateList, yjsAddItem, destroyDoc } from '../src/sync/yjs-adapter';
import type { GroceryItem, GroceryList } from '../src/types';

const APP_ROOT = path.resolve(__dirname, '..');

function makeList(id: string, now: number): GroceryList {
  return {
    id,
    familyId: 'fam-persist-err',
    name: 'Errors Surface',
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    version: 1,
    syncStatus: 'created',
    createdAt: now,
    updatedAt: now,
  };
}

function makeItem(id: string, listId: string, now: number): GroceryItem {
  return {
    id,
    listId,
    familyId: 'fam-persist-err',
    name: 'Oat Milk',
    quantity: 1,
    unit: 'L',
    category: 'dairy',
    isChecked: false,
    addedBy: 'member-1',
    sortOrder: 0,
    isDeleted: false,
    deletedAt: null,
    version: 1,
    syncStatus: 'created',
    createdAt: now,
    updatedAt: now,
  };
}

/** Let the .catch → dynamic-import → setState chain settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('failed persistence reaches useSyncStore (user-visible via SyncIndicator)', () => {
  beforeEach(() => {
    useSyncStore.setState({ syncState: 'not_configured', error: null });
  });

  it('site one: a local Yjs edit whose DB write fails sets the error state', async () => {
    const listId = 'persist-err-local';
    destroyDoc(listId);
    const mgr = new SyncManager();

    // hydrateFromDB sets the encryption key (mocked loaders return nothing).
    await mgr.hydrateFromDB(new Uint8Array(32).fill(7));
    const now = Date.now();
    hydrateList(listId, makeList(listId, now), []);
    mgr.registerList(listId);

    // A local edit fires the update observer → persistListToDB rejects.
    yjsAddItem(listId, makeItem('item-1', listId, now));
    await flush();

    const state = useSyncStore.getState();
    expect(state.syncState).toBe('error');
    expect(state.error).toBe("Couldn't save recent changes to this device");
  });

  it('site two: a remote update whose DB write fails sets the error state', async () => {
    const listId = 'persist-err-remote';
    destroyDoc(listId);
    const mgr = new SyncManager();

    await mgr.hydrateFromDB(new Uint8Array(32).fill(9));
    const now = Date.now();
    hydrateList(listId, makeList(listId, now), []);

    // Build a remote update from a second doc and feed it through the
    // remote-update path (the wsClient.onRemoteUpdate handler's target).
    const remoteDoc = new Y.Doc();
    remoteDoc.getMap('meta').set('name', 'Renamed remotely');
    const update = Y.encodeStateAsUpdate(remoteDoc);
    (mgr as any).applyRemoteUpdate(listId, update);
    await flush();

    const state = useSyncStore.getState();
    expect(state.syncState).toBe('error');
    expect(state.error).toBe("Couldn't save recent changes to this device");
  });

  it('the rejection stays handled — reporting does not throw or reject', async () => {
    const listId = 'persist-err-handled';
    destroyDoc(listId);
    const mgr = new SyncManager();
    await mgr.hydrateFromDB(new Uint8Array(32).fill(3));
    hydrateList(listId, makeList(listId, Date.now()), []);
    mgr.registerList(listId);

    // Would fail the test as an unhandled rejection if the .catch were gone.
    expect(() => yjsAddItem(listId, makeItem('item-2', listId, Date.now()))).not.toThrow();
    await flush();
  });
});

// ─── Static: no catch site terminates in a bare console.warn ────────────────

describe('sync-manager persistence catch sites', () => {
  it('both persistListToDB(...).catch sites route through reportPersistError', () => {
    const source = fs.readFileSync(
      path.join(APP_ROOT, 'src', 'sync', 'sync-manager.ts'),
      'utf8',
    );

    const catchSites = source.match(/persistListToDB\(listId\)\.catch\(\(err\) => \{\s*\n\s*this\.reportPersistError\(/g);
    expect(catchSites).toHaveLength(2);

    // No persistListToDB catch handler falls straight into console.warn.
    expect(source).not.toMatch(/persistListToDB\(listId\)\.catch\(\(err\) => \{\s*\n\s*console\.warn/);

    // The reporter is the piece that makes the failure user-visible.
    expect(source).toContain("useSyncStore.setState({");
    expect(source).toContain("syncState: 'error'");
  });
});

