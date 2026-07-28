/**
 * Sync bootstrap / restart survival.
 *
 * Regression test for the launch-blocking gap found in review: nothing at
 * runtime ever called syncManager.hydrateFromDB(), so lists lived only in
 * in-memory Yjs docs and vanished on app restart.
 *
 * Simulates: create list + items → sync-manager observer persists to
 * (mocked) WatermelonDB → "app restart" (destroy Yjs docs) → hydrateFromDB →
 * lists index + list + items are visible again.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import sodium from 'libsodium-wrappers';
import { initCrypto, generateUUID } from '../src/crypto';
import { SyncManager } from '../src/sync/sync-manager';
import {
  getDoc,
  destroyDoc,
  extractItems,
  extractList,
  yjsAddItem,
  hydrateList,
} from '../src/sync/yjs-adapter';
import { persistList, persistItem } from '../src/storage/hydrate';
import type { GroceryItem, GroceryList } from '../src/types';

let key: Uint8Array;

beforeAll(async () => {
  await initCrypto();
  await sodium.ready;
  key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
});

describe('Restart survival via hydrateFromDB', () => {
  it('restores lists, items, and the lists index after Yjs docs are destroyed', async () => {
    const listId = await generateUUID();
    const now = Date.now();

    const list: GroceryList = {
      id: listId,
      familyId: 'fam-boot',
      name: 'Weekly Groceries',
      isActive: true,
      isDeleted: false,
      deletedAt: null,
      version: 1,
      syncStatus: 'created',
      createdAt: now,
      updatedAt: now,
    };

    const item: GroceryItem = {
      id: await generateUUID(),
      listId,
      familyId: 'fam-boot',
      name: 'Oat Milk',
      quantity: 2,
      unit: 'L',
      category: 'dairy',
      isChecked: false,
      addedBy: 'device-boot',
      sortOrder: 0,
      isDeleted: false,
      deletedAt: null,
      version: 1,
      syncStatus: 'created',
      createdAt: now,
      updatedAt: now,
    };

    // Session 1: list + item exist in Yjs and are persisted to WatermelonDB
    hydrateList(listId, list, []);
    yjsAddItem(listId, item);
    await persistList(list, key);
    await persistItem(item, key);

    // "App restart": in-memory Yjs docs are gone
    destroyDoc(listId);
    destroyDoc('__lists_index__');
    expect(extractList(listId)).toBeNull();

    // Session 2: bootstrap hydration (what App.tsx now calls at startup)
    const manager = new SyncManager();
    await manager.hydrateFromDB(key);

    // The list, its items, and the index used by useListStore are all back
    const restoredList = extractList(listId);
    expect(restoredList?.name).toBe('Weekly Groceries');

    const restoredItems = extractItems(listId);
    expect(restoredItems.map((i) => i.name)).toContain('Oat Milk');

    const indexDoc = getDoc('__lists_index__');
    expect(indexDoc.getMap('listIds').get(listId)).toBe(true);

    // And the manager can now persist local edits (encryption key retained)
    expect(manager.getEncryptionKey()).not.toBeNull();

    manager.disconnect();
    destroyDoc(listId);
    destroyDoc('__lists_index__');
  });
});
