/**
 * E2E — Two Devices, One Offline
 *
 * The highest-value E2E test for the grocery app.
 * Simulates two family members on the same list:
 *  - Device A goes offline
 *  - Device A adds items while disconnected
 *  - Device B adds items while online (Device A offline)
 *  - Device A reconnects
 *  - Both docs converge — no data loss, no duplicates
 *
 * Uses standalone Y.Doc instances (not the global getDoc() cache)
 * to simulate truly separate devices. Sync is through Yjs state
 * updates applied directly (simulating relay relay).
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import * as Y from 'yjs';
import sodium from 'libsodium-wrappers';
import { initCrypto } from '../src/crypto';
import { generateUUID } from '../src/crypto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface TestItem {
  id: string;
  listId: string;
  name: string;
  quantity: number;
  unit: string;
  category: string;
  isChecked: boolean;
  isDeleted: boolean;
}

async function makeItem(listId: string, name: string, overrides: Partial<TestItem> = {}): Promise<TestItem> {
  const id = await generateUUID();
  return {
    id,
    listId,
    name,
    quantity: 1,
    unit: 'pcs',
    category: 'other',
    isChecked: false,
    isDeleted: false,
    ...overrides,
  };
}

/**
 * Add an item to a standalone Y.Doc (bypassing global getDoc cache).
 * Returns the created Y.Map for reference.
 */
function yjsAddItemToDoc(doc: Y.Doc, item: TestItem): Y.Map<any> {
  const yItem = new Y.Map();
  Object.entries(item).forEach(([key, value]) => {
    yItem.set(key, value as any);
  });
  doc.transact(() => {
    const items = doc.getArray('items');
    items.push([yItem]);
  });
  return yItem;
}

/**
 * Extract items from a standalone Y.Doc as plain objects.
 */
function extractItemsFromDoc(doc: Y.Doc): TestItem[] {
  const itemsArr = doc.getArray('items');
  const result: TestItem[] = [];
  for (let i = 0; i < itemsArr.length; i++) {
    const yItem = itemsArr.get(i) as Y.Map<any>;
    const item: Record<string, any> = {};
    yItem.forEach((val, key) => { item[key] = val; });
    result.push(item as unknown as TestItem);
  }
  return result;
}

/**
 * Simulate sending a sync update from one doc to another.
 * Returns the update bytes for inspection.
 */
function syncFromAToB(sourceDoc: Y.Doc, targetDoc: Y.Doc): Uint8Array {
  const update = Y.encodeStateAsUpdate(sourceDoc);
  Y.applyUpdate(targetDoc, update);
  return update;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initCrypto();
  await sodium.ready;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('E2E: Two Devices, One Offline', () => {
  it('should converge after Device A goes offline, adds items, and reconnects', async () => {
    const listId = 'e2e-offline-list';

    // ── Phase 1: Both devices start online, connected ──
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    // Start with an empty list on both devices
    docA.getArray('items');
    docB.getArray('items');

    // Initial sync: both start from same state
    syncFromAToB(docA, docB);

    // ── Phase 2: Device A goes offline ──
    // Stop applying updates from B to A (simulate disconnect)
    // A's doc continues to accept local changes

    // Device A adds items while offline
    const offlineItem1 = await makeItem(listId, 'Milk (offline)');
    const offlineItem2 = await makeItem(listId, 'Eggs (offline)');
    yjsAddItemToDoc(docA, offlineItem1);
    yjsAddItemToDoc(docA, offlineItem2);

    // Verify A sees its own offline items
    let itemsA = extractItemsFromDoc(docA);
    expect(itemsA.length).toBe(2);
    expect(itemsA.some(i => i.name === 'Milk (offline)')).toBe(true);
    expect(itemsA.some(i => i.name === 'Eggs (offline)')).toBe(true);

    // ── Phase 3: Device B adds items while A is offline ──
    const onlineItem1 = await makeItem(listId, 'Bread (online)');
    const onlineItem2 = await makeItem(listId, 'Butter (online)');
    yjsAddItemToDoc(docB, onlineItem1);
    yjsAddItemToDoc(docB, onlineItem2);

    // Verify B sees its own items
    let itemsB = extractItemsFromDoc(docB);
    expect(itemsB.length).toBe(2);
    expect(itemsB.some(i => i.name === 'Bread (online)')).toBe(true);
    expect(itemsB.some(i => i.name === 'Butter (online)')).toBe(true);

    // B does NOT see A's offline items yet
    expect(itemsB.some(i => i.name === 'Milk (offline)')).toBe(false);

    // ── Phase 4: Device A reconnects ──
    // Bidirectional sync: A sends its offline updates, B sends its online updates
    syncFromAToB(docA, docB);   // A's offline items → B
    syncFromAToB(docB, docA);   // B's online items → A

    // ── Phase 5: Verify convergence ──
    itemsA = extractItemsFromDoc(docA);
    itemsB = extractItemsFromDoc(docB);

    // Both devices should have all 4 items
    expect(itemsA.length).toBe(4);
    expect(itemsB.length).toBe(4);

    // A should have B's online items
    expect(itemsA.some(i => i.name === 'Bread (online)')).toBe(true);
    expect(itemsA.some(i => i.name === 'Butter (online)')).toBe(true);

    // B should have A's offline items
    expect(itemsB.some(i => i.name === 'Milk (offline)')).toBe(true);
    expect(itemsB.some(i => i.name === 'Eggs (offline)')).toBe(true);

    // No duplicates: each name appears exactly once in each doc
    const namesA = itemsA.map(i => i.name);
    const namesB = itemsB.map(i => i.name);
    expect(new Set(namesA).size).toBe(namesA.length);
    expect(new Set(namesB).size).toBe(namesB.length);

    // Both docs should have the exact same set of items (same names, regardless of order)
    expect(new Set(namesA)).toEqual(new Set(namesB));

    docA.destroy();
    docB.destroy();
  });

  it('should handle concurrent modifications to the same item during offline period', async () => {
    const listId = 'e2e-offline-conflict';
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    // Both start with the same item
    const initialItem = await makeItem(listId, 'Apples', { quantity: 5 });
    yjsAddItemToDoc(docA, initialItem);
    syncFromAToB(docA, docB);

    // ── Device A goes offline ──
    // Device A changes quantity to 10
    docA.transact(() => {
      const items = docA.getArray('items');
      const yItem = items.get(0) as Y.Map<any>;
      yItem.set('quantity', 10);
    });

    // Device B (online) changes quantity to 3
    docB.transact(() => {
      const items = docB.getArray('items');
      const yItem = items.get(0) as Y.Map<any>;
      yItem.set('quantity', 3);
    });

    // ── Device A reconnects ──
    syncFromAToB(docA, docB);
    syncFromAToB(docB, docA);

    // Both docs should have converged (no duplicate items)
    const itemsA = extractItemsFromDoc(docA);
    const itemsB = extractItemsFromDoc(docB);

    expect(itemsA.length).toBe(1);
    expect(itemsB.length).toBe(1);

    // Yjs is last-writer-wins per field. Both docs should have the same final value.
    // The Yjs clock determines which write wins — the important thing is they match.
    expect(itemsA[0].quantity).toBe(itemsB[0].quantity);
    expect(itemsA[0].id).toBe(initialItem.id);
    // Both docs should be numeric (not null/undefined/NaN)
    expect(typeof itemsA[0].quantity).toBe('number');
    expect(typeof itemsB[0].quantity).toBe('number');
    expect(isFinite(itemsA[0].quantity)).toBe(true);

    docA.destroy();
    docB.destroy();
  });

  it('should converge when three devices with overlapping offline periods sync', async () => {
    const listId = 'e2e-three-device-offline';
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const docC = new Y.Doc();

    // A goes offline, adds items
    const aItem = await makeItem(listId, 'A offline');
    yjsAddItemToDoc(docA, aItem);

    // A reconnects, syncs with B
    syncFromAToB(docA, docB);
    syncFromAToB(docB, docA);

    // C was offline the whole time, adds items independently
    const cItem = await makeItem(listId, 'C offline');
    yjsAddItemToDoc(docC, cItem);

    // All three converge
    syncFromAToB(docA, docB);
    syncFromAToB(docB, docA);
    syncFromAToB(docA, docC);
    syncFromAToB(docC, docA);
    syncFromAToB(docB, docC);
    syncFromAToB(docC, docB);

    // All three docs should have exactly 2 items (aItem + cItem)
    expect(extractItemsFromDoc(docA).length).toBe(2);
    expect(extractItemsFromDoc(docB).length).toBe(2);
    expect(extractItemsFromDoc(docC).length).toBe(2);

    // All docs should have the same set of item names
    const namesA = new Set(extractItemsFromDoc(docA).map(i => i.name));
    const namesB = new Set(extractItemsFromDoc(docB).map(i => i.name));
    const namesC = new Set(extractItemsFromDoc(docC).map(i => i.name));
    expect(namesA).toEqual(namesB);
    expect(namesB).toEqual(namesC);

    docA.destroy();
    docB.destroy();
    docC.destroy();
  });
});