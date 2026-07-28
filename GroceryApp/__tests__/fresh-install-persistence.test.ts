/**
 * Fresh-install persistence — the end-to-end path no test previously covered.
 *
 * The suite had unit tests for every piece of the persistence stack, but none
 * that started from a genuinely fresh install and asserted that a user's data
 * is still there after a restart. Three independent faults hid behind that
 * gap, each masking the next:
 *
 *   A. No code path created a master key on first launch, so bootstrapSync()
 *      returned 'no-key' and syncManager.encryptionKey stayed null — which
 *      made persistListToDB() a no-op.
 *   B. persistItem/persistList wrote outside a WatermelonDB Writer, which
 *      throws.
 *   C. Those writers assigned to `syncStatus`, a read-only accessor on the
 *      base Model, which throws under strict mode.
 *
 * All three failed silently into a .catch(console.warn), so the app looked
 * fine and lost everything on close.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import * as WatermelonDB from '@nozbe/watermelondb';
import { initCrypto, getMasterKey, getMasterKeyType, generateUUID } from '../src/crypto';
import { initDeviceIdentity } from '../src/identity/device';
import { clearFamilyMembership } from '../src/identity/family';
import { initSettings } from '../src/config/settings';
import { bootstrapSync } from '../src/sync/bootstrap';
import { syncManager, SyncManager } from '../src/sync/sync-manager';
import { persistItem, persistList, loadItemsFromDB } from '../src/storage/hydrate';
import {
  destroyDoc,
  extractItems,
  yjsAddItem,
  hydrateList,
} from '../src/sync/yjs-adapter';
import type { GroceryItem, GroceryList } from '../src/types';

const LIST_ID = 'fresh-install-list';

/**
 * Simulate a device with nothing on it yet, in the same order App.tsx boots:
 * crypto → database → device identity → settings → bootstrapSync.
 */
async function freshInstall(): Promise<void> {
  (SecureStore as any)._clearStore();
  (WatermelonDB as any)._resetDB();
  destroyDoc(LIST_ID);
  destroyDoc('__lists_index__');
  syncManager.disconnect();
  await initCrypto();
  await clearFamilyMembership();
  await initDeviceIdentity();
  await initSettings();
}

function makeList(now: number): GroceryList {
  return {
    id: LIST_ID,
    familyId: 'fam-fresh',
    name: 'Weekly Groceries',
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    version: 1,
    syncStatus: 'created',
    createdAt: now,
    updatedAt: now,
  };
}

function makeItem(id: string, now: number): GroceryItem {
  return {
    id,
    listId: LIST_ID,
    familyId: 'fam-fresh',
    name: 'Oat Milk',
    quantity: 2,
    unit: 'L',
    category: 'dairy',
    isChecked: false,
    addedBy: 'device-fresh',
    sortOrder: 0,
    isDeleted: false,
    deletedAt: null,
    version: 1,
    syncStatus: 'created',
    createdAt: now,
    updatedAt: now,
  };
}

describe('Fresh install persistence', () => {
  beforeEach(async () => {
    await freshInstall();
  });

  it('provisions a master key on first launch', async () => {
    expect(await getMasterKey()).toBeNull();

    await bootstrapSync();

    // Without a key, every write downstream is silently skipped.
    expect(await getMasterKey()).not.toBeNull();
  });

  it('leaves the sync manager able to persist after first launch', async () => {
    await bootstrapSync();

    expect(syncManager.getEncryptionKey()).not.toBeNull();
  });

  it('marks the first-run key as device-provisioned, not a family key', async () => {
    // The join flow asks "does this device already hold the family's key?".
    // A key this device minted for itself must not answer yes, or an invitee
    // silently skips the "enter the family recovery phrase" step and then
    // cannot decrypt anything the family sends.
    await bootstrapSync();

    expect(await getMasterKeyType()).toBe('device');
  });

  it('keeps an edit to an existing item after a restart', async () => {
    // Editing takes the update() branch rather than create(), which is a
    // separate write path with its own Writer and field-assignment rules.
    await bootstrapSync();

    const now = Date.now();
    const itemId = await generateUUID();
    const key = (await getMasterKey())!;

    await persistList(makeList(now), key);
    await persistItem(makeItem(itemId, now), key);

    // User checks the item off and renames it.
    const edited = makeItem(itemId, now);
    edited.name = 'Oat Milk (2L)';
    edited.isChecked = true;
    edited.version = 2;
    edited.syncStatus = 'updated';
    await persistItem(edited, key);

    const reloaded = await loadItemsFromDB(key);
    const stored = reloaded.find((i) => i.id === itemId);
    expect(stored?.name).toBe('Oat Milk (2L)');
    expect(stored?.isChecked).toBe(true);
    expect(stored?.syncStatus).toBe('updated');
  });

  it('keeps an item added on a fresh install after a restart', async () => {
    // ── Session 1: first launch, user adds a list and an item ──
    await bootstrapSync();

    const now = Date.now();
    const itemId = await generateUUID();

    hydrateList(LIST_ID, makeList(now), []);
    syncManager.registerList(LIST_ID);
    yjsAddItem(LIST_ID, makeItem(itemId, now));

    // The Yjs observer persists asynchronously; let it settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // ── "App restart": in-memory Yjs state is gone, storage is not ──
    destroyDoc(LIST_ID);
    destroyDoc('__lists_index__');
    expect(extractItems(LIST_ID)).toHaveLength(0);

    // ── Session 2: bootstrap hydrates from disk ──
    const restored = new SyncManager();
    const key = await getMasterKey();
    await restored.hydrateFromDB(key!);

    expect(extractItems(LIST_ID).map((i) => i.name)).toContain('Oat Milk');

    restored.disconnect();
  });
});
