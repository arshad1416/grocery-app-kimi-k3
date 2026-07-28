/**
 * Claim-an-item lock tests.
 *
 * Verifies:
 *  - yjsClaimItem sets claimedBy/claimedAt on the Y.Map
 *  - yjsUnclaimItem removes claimedBy/claimedAt
 *  - yjsClaimItem returns false if already claimed by another device (unexpired)
 *  - yjsClaimItem allows re-claim if claim has expired (CLAIM_EXPIRY_MS)
 *  - yjsClaimItem allows re-claim by the same device (no-op, returns true)
 *  - yjsUnclaimItem respects deviceId guard (can't unclaim someone else's)
 *  - Claim state syncs correctly via Yjs CRDT (two docs converge)
 */

import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';
import * as Y from 'yjs';
import sodium from 'libsodium-wrappers';
import { initCrypto, generateUUID } from '../src/crypto';
import {
  getDoc,
  yjsAddItem,
  extractItems,
  yjsClaimItem,
  yjsUnclaimItem,
  yjsSweepExpiredClaims,
  CLAIM_EXPIRY_MS,
  destroyDoc,
} from '../src/sync/yjs-adapter';
import type { GroceryItem } from '../src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createTestItem(
  listId: string,
  name: string,
): Promise<GroceryItem> {
  const id = await generateUUID();
  return {
    id,
    listId,
    familyId: 'test-family',
    name,
    quantity: 1,
    unit: 'pcs',
    category: 'other',
    isChecked: false,
    addedBy: 'test-device',
    sortOrder: 0,
    isDeleted: false,
    deletedAt: null,
    version: 1,
    syncStatus: 'created',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initCrypto();
  await sodium.ready;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Claim-an-item lock', () => {
  afterEach(() => {
    // Clean up docs between tests to avoid cross-contamination
    destroyDoc('test-claim-list');
  });

  it('should claim an item and set claimedBy + claimedAt', () => {
    const listId = 'test-claim-list';

    // Add an item
    const item = new Y.Map();
    item.set('id', 'item-1');
    item.set('name', 'Milk');
    item.set('listId', listId);
    const doc = getDoc(listId);
    doc.transact(() => {
      doc.getArray('items').push([item]);
    });

    // Claim it
    const result = yjsClaimItem(listId, 'item-1', 'device-arshad');
    expect(result).toBe(true);

    // Verify
    const items = extractItems(listId);
    expect(items.length).toBe(1);
    expect(items[0].claimedBy).toBe('device-arshad');
    expect(items[0].claimedAt).toBeDefined();
    expect(typeof items[0].claimedAt).toBe('number');
  });

  it('should unclaim an item and remove claimedBy + claimedAt', () => {
    const listId = 'test-claim-list';

    // Add and claim an item
    const item = new Y.Map();
    item.set('id', 'item-2');
    item.set('name', 'Eggs');
    item.set('listId', listId);
    const doc = getDoc(listId);
    doc.transact(() => {
      doc.getArray('items').push([item]);
    });

    yjsClaimItem(listId, 'item-2', 'device-arshad');

    // Unclaim it
    yjsUnclaimItem(listId, 'item-2', 'device-arshad');

    // Verify
    const items = extractItems(listId);
    expect(items.length).toBe(1);
    expect(items[0].claimedBy).toBeUndefined();
    expect(items[0].claimedAt).toBeUndefined();
  });

  it('should return false if item is already claimed by another device', () => {
    const listId = 'test-claim-list';

    const item = new Y.Map();
    item.set('id', 'item-3');
    item.set('name', 'Bread');
    item.set('listId', listId);
    const doc = getDoc(listId);
    doc.transact(() => {
      doc.getArray('items').push([item]);
    });

    // Device A claims it
    yjsClaimItem(listId, 'item-3', 'device-larissa');

    // Device B tries to claim it — should fail
    const result = yjsClaimItem(listId, 'item-3', 'device-arshad');
    expect(result).toBe(false);

    // Verify it's still claimed by device-larissa
    const items = extractItems(listId);
    expect(items[0].claimedBy).toBe('device-larissa');
  });

  it('should allow re-claim by the same device (idempotent)', () => {
    const listId = 'test-claim-list';

    const item = new Y.Map();
    item.set('id', 'item-4');
    item.set('name', 'Butter');
    item.set('listId', listId);
    const doc = getDoc(listId);
    doc.transact(() => {
      doc.getArray('items').push([item]);
    });

    // Claim twice by same device
    yjsClaimItem(listId, 'item-4', 'device-arshad');
    const result = yjsClaimItem(listId, 'item-4', 'device-arshad');
    expect(result).toBe(true);

    const items = extractItems(listId);
    expect(items[0].claimedBy).toBe('device-arshad');
  });

  it('should allow re-claim if the previous claim has expired', () => {
    const listId = 'test-claim-list';

    const item = new Y.Map();
    item.set('id', 'item-5');
    item.set('name', 'Cheese');
    item.set('listId', listId);
    const doc = getDoc(listId);
    doc.transact(() => {
      doc.getArray('items').push([item]);
    });

    // Device A claims it, but with a timestamp in the past (expired)
    const expiredTime = Date.now() - CLAIM_EXPIRY_MS - 1000;
    doc.transact(() => {
      const items = doc.getArray('items');
      const yItem = items.get(0) as Y.Map<any>;
      yItem.set('claimedBy', 'device-larissa');
      yItem.set('claimedAt', expiredTime);
    });

    // Device B claims it — should succeed since claim expired
    const result = yjsClaimItem(listId, 'item-5', 'device-arshad');
    expect(result).toBe(true);

    const items = extractItems(listId);
    expect(items[0].claimedBy).toBe('device-arshad');
  });

  it('should not allow unclaim by a different device when deviceId is provided', () => {
    const listId = 'test-claim-list';

    const item = new Y.Map();
    item.set('id', 'item-6');
    item.set('name', 'Juice');
    item.set('listId', listId);
    const doc = getDoc(listId);
    doc.transact(() => {
      doc.getArray('items').push([item]);
    });

    // Device A claims it
    yjsClaimItem(listId, 'item-6', 'device-larissa');

    // Device B tries to unclaim with deviceId guard — should no-op
    yjsUnclaimItem(listId, 'item-6', 'device-arshad');

    // Verify still claimed
    const items = extractItems(listId);
    expect(items[0].claimedBy).toBe('device-larissa');
  });

  it('should allow unclaim without deviceId guard (admin override)', () => {
    const listId = 'test-claim-list';

    const item = new Y.Map();
    item.set('id', 'item-7');
    item.set('name', 'Water');
    item.set('listId', listId);
    const doc = getDoc(listId);
    doc.transact(() => {
      doc.getArray('items').push([item]);
    });

    // Device A claims, then admin (no deviceId) unclaims
    yjsClaimItem(listId, 'item-7', 'device-larissa');
    yjsUnclaimItem(listId, 'item-7'); // no deviceId = admin override

    const items = extractItems(listId);
    expect(items[0].claimedBy).toBeUndefined();
  });

  it('should sync claim state between two Yjs docs via applyUpdate', () => {
    const listId = 'test-claim-sync';

    // Doc A: add item, claim it
    const docA = new Y.Doc();
    const itemMap = new Y.Map();
    itemMap.set('id', 'sync-item');
    itemMap.set('name', 'Sync Test');
    itemMap.set('listId', listId);
    docA.transact(() => {
      docA.getArray('items').push([itemMap]);
    });

    // Simulate local claim via direct Y.Map mutation (bypassing global cache)
    docA.transact(() => {
      const itemsArr = docA.getArray('items');
      const yItem = itemsArr.get(0) as Y.Map<any>;
      yItem.set('claimedBy', 'device-arshad');
      yItem.set('claimedAt', Date.now());
    });

    // Sync A → B via Yjs state update
    const docB = new Y.Doc();
    const update = Y.encodeStateAsUpdate(docA);
    Y.applyUpdate(docB, update);

    // Doc B should see the claim
    const itemsB: GroceryItem[] = [];
    docB.getArray('items').forEach((yItem: unknown) => {
      const item: Record<string, any> = {};
      (yItem as Y.Map<any>).forEach((val, key) => { item[key] = val; });
      itemsB.push(item as unknown as GroceryItem);
    });

    expect(itemsB.length).toBe(1);
    expect(itemsB[0].claimedBy).toBe('device-arshad');
    expect(itemsB[0].claimedAt).toBeDefined();

    docA.destroy();
    docB.destroy();
  });

  it('yjsSweepExpiredClaims releases only expired claims', () => {
    const listId = 'test-claim-list';
    const doc = getDoc(listId);

    const expired = new Y.Map();
    expired.set('id', 'item-expired');
    expired.set('name', 'Old Milk');
    expired.set('listId', listId);
    expired.set('claimedBy', 'device-larissa');
    expired.set('claimedAt', Date.now() - CLAIM_EXPIRY_MS - 1000);
    expired.set('version', 1);

    const fresh = new Y.Map();
    fresh.set('id', 'item-fresh');
    fresh.set('name', 'New Milk');
    fresh.set('listId', listId);
    fresh.set('claimedBy', 'device-arshad');
    fresh.set('claimedAt', Date.now());
    fresh.set('version', 1);

    const unclaimed = new Y.Map();
    unclaimed.set('id', 'item-unclaimed');
    unclaimed.set('name', 'Bread');
    unclaimed.set('listId', listId);
    unclaimed.set('version', 1);

    doc.transact(() => {
      doc.getArray('items').push([expired, fresh, unclaimed]);
    });

    const released = yjsSweepExpiredClaims(listId);
    expect(released).toBe(1);

    const items = extractItems(listId);
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get('item-expired')?.claimedBy).toBeUndefined();
    expect(byId.get('item-expired')?.claimedAt).toBeUndefined();
    expect(byId.get('item-fresh')?.claimedBy).toBe('device-arshad');

    // Second sweep is a no-op
    expect(yjsSweepExpiredClaims(listId)).toBe(0);
  });
});