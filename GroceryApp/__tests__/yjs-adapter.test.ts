/**
 * Yjs adapter tests — CRDT document management
 */
import * as Y from 'yjs';
import {
  getDoc, getListMeta, getItemsArray, hydrateList,
  extractList, extractItems, yjsAddItem, yjsUpdateItem,
  yjsDeleteItem, destroyDoc, setAwareness, getAwareness,
  getActiveDocIds,
} from '../src/sync/yjs-adapter';
import type { GroceryItem, GroceryList } from '../src/types';

const makeList = (id: string): GroceryList => ({
  id, familyId: 'fam1', name: 'My List', isActive: true,
  isDeleted: false, deletedAt: null, version: 1,
  syncStatus: 'synced', createdAt: Date.now(), updatedAt: Date.now(),
});

const makeItem = (listId: string, idx: number): GroceryItem => ({
  id: `item-${idx}`, listId, familyId: 'fam1', name: `Item ${idx}`, quantity: 1,
  unit: 'pieces', category: 'produce', isChecked: false,
  addedBy: 'user1', sortOrder: idx, isDeleted: false,
  deletedAt: null, version: 1, syncStatus: 'synced',
  createdAt: Date.now(), updatedAt: Date.now(),
});

describe('Document Lifecycle', () => {
  test('getDoc creates on first call', () => {
    const doc = getDoc('test-list');
    expect(doc).toBeInstanceOf(Y.Doc);
  });

  test('getDoc returns cached on second call', () => {
    const doc1 = getDoc('test-list-2');
    const doc2 = getDoc('test-list-2');
    expect(doc1).toBe(doc2);
  });

  test('destroyDoc removes from cache', () => {
    getDoc('to-destroy');
    expect(getActiveDocIds()).toContain('to-destroy');
    destroyDoc('to-destroy');
    expect(getActiveDocIds()).not.toContain('to-destroy');
  });
});

describe('Shared Types', () => {
  test('getListMeta returns Y.Map', () => {
    const meta = getListMeta('meta-test');
    expect(meta).toBeInstanceOf(Y.Map);
  });

  test('getItemsArray returns Y.Array', () => {
    const arr = getItemsArray('items-test');
    expect(arr).toBeInstanceOf(Y.Array);
  });
});

describe('Hydrate / Extract', () => {
  const listId = 'hydrate-test';

  test('extractList returns null for blank doc', () => {
    getDoc(listId); // create blank
    expect(extractList(listId)).toBeNull();
  });

  test('hydrateList populates meta and items', () => {
    const list = makeList(listId);
    const items = [makeItem(listId, 1), makeItem(listId, 2)];
    hydrateList(listId, list, items);

    const extracted = extractList(listId);
    expect(extracted).not.toBeNull();
    expect(extracted!.id).toBe(listId);
    expect(extracted!.name).toBe('My List');

    const extractedItems = extractItems(listId);
    expect(extractedItems).toHaveLength(2);
  });
});

describe('Mutations via Yjs', () => {
  const listId = 'mutations-test';
  let item: GroceryItem;

  beforeAll(() => {
    const list = makeList(listId);
    hydrateList(listId, list, []);
    item = makeItem(listId, 1);
  });

  test('yjsAddItem adds and bumps version', () => {
    const metaBefore = getListMeta(listId).get('version') as number;
    yjsAddItem(listId, item);
    const items = extractItems(listId);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Item 1');
    expect(getListMeta(listId).get('version')).toBeGreaterThan(metaBefore);
  });

  test('yjsUpdateItem updates fields', () => {
    yjsUpdateItem(listId, item.id, { name: 'Updated Item', quantity: 3 });
    const items = extractItems(listId);
    expect(items[0].name).toBe('Updated Item');
    expect(items[0].quantity).toBe(3);
  });

  test('yjsUpdateItem does not overwrite createdAt', () => {
    const originalCreated = extractItems(listId)[0].createdAt;
    yjsUpdateItem(listId, item.id, { createdAt: 0 } as any);
    expect(extractItems(listId)[0].createdAt).toBe(originalCreated);
  });

  test('yjsUpdateItem does not overwrite id', () => {
    yjsUpdateItem(listId, item.id, { id: 'hacked' } as any);
    expect(extractItems(listId)[0].id).toBe(item.id);
  });

  test('yjsDeleteItem sets isDeleted', () => {
    yjsDeleteItem(listId, item.id);
    const items = extractItems(listId);
    expect(items[0].isDeleted).toBe(true);
    expect(items[0].deletedAt).not.toBeNull();
  });
});

describe('Awareness / Presence', () => {
  const listId = 'awareness-test';

  test('setAwareness stores state', () => {
    setAwareness(listId, 'user1', { online: true, atStore: true, lastSeen: Date.now() });
    const awareness = getAwareness(listId);
    expect(awareness['user1']).toBeDefined();
    expect(awareness['user1'].online).toBe(true);
    expect(awareness['user1'].atStore).toBe(true);
  });

  test('getAwareness returns empty for unknown list', () => {
    expect(getAwareness('nonexistent')).toEqual({});
  });
});