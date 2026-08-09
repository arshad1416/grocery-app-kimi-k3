/**
 * Rows from a family this device no longer belongs to must not be hydrated.
 *
 * Joining a family replaces this device's master key — the confirm dialog in
 * RecoveryScreen says so in as many words — and nothing wipes the rows written
 * under the old one. loadListsFromDB / loadItemsFromDB / loadMembersFromDB
 * fetched the whole collection, so every launch walked dead rows that can
 * never decrypt again. That is what forced the AEAD surfacing work to exclude
 * hydrate from the user-visible warning: on a healthy joined device, hydrate
 * failures are EXPECTED.
 *
 * The dangerous half is the fix, not the bug. `family_id` was never wired to
 * real family identity:
 *
 *   - Lists always carry the literal 'default-family'. HomeScreen resolves it
 *     from the family_members TABLE via `firstMember?.familyId ??
 *     'default-family'`, and `addMember` has ZERO callers, so that table is
 *     always empty and the fallback always wins.
 *   - Items always carry ''. AddItemSheet and ItemEditScreen fall through to
 *     '' for the first item in a list, and later items copy the first.
 *
 * So the obvious fix — `family_id === currentFamilyId` — would hide 100% of
 * every existing user's data. Those legacy values are adopted instead, which
 * is safe precisely because no code path has ever written a real familyId
 * there, so they cannot belong to some other family.
 *
 * Run: npx jest __tests__/family-scoping.test.ts
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import { Q } from '@nozbe/watermelondb';
import * as WatermelonDB from '@nozbe/watermelondb';

import { initCrypto } from '../src/crypto';
import { initDeviceIdentity, getDeviceKeypair } from '../src/identity/device';
import {
  ensureFamilyMembership,
  clearFamilyMembership,
  getFamilyId,
} from '../src/identity/family';
import {
  persistItem,
  persistList,
  loadItemsFromDB,
  loadListsFromDB,
} from '../src/storage/hydrate';
import { getDatabase } from '../src/storage/database';
import type { GroceryItem, GroceryList } from '../src/types';

const KEY = new Uint8Array(32).fill(4);

const makeList = (id: string, familyId: string): GroceryList => ({
  id,
  familyId,
  name: `list ${id}`,
  description: undefined,
  storePreference: undefined,
  isActive: true,
  isDeleted: false,
  deletedAt: null,
  version: 1,
  syncStatus: 'synced',
  createdAt: 1,
  updatedAt: 1,
});

const makeItem = (id: string, listId: string, familyId: string): GroceryItem => ({
  id,
  listId,
  familyId,
  name: `item ${id}`,
  quantity: 1,
  unit: 'ea',
  category: 'other',
  isChecked: false,
  addedBy: 'dev',
  assignedTo: undefined,
  notes: undefined,
  sortOrder: 0,
  isDeleted: false,
  deletedAt: null,
  version: 1,
  syncStatus: 'synced',
  createdAt: 1,
  updatedAt: 1,
});

/** Force a row's family_id to a literal, bypassing the write-time stamp. */
async function forceFamilyId(table: string, id: string, familyId: string) {
  const collection = getDatabase().get(table);
  const [record] = await collection.query(Q.where('id', id)).fetch();
  await getDatabase().write(async () => {
    await (record as any).update((r: any) => {
      r.familyId = familyId;
    });
  });
}

beforeEach(async () => {
  (SecureStore as any)._clearStore();
  await initCrypto();
  (WatermelonDB as any)._resetDB();
  await clearFamilyMembership();
  await initDeviceIdentity();
  await ensureFamilyMembership(getDeviceKeypair());
});

describe('rows from another family are excluded', () => {
  it('drops a foreign list while KEEPING our own', async () => {
    // Both halves matter. Asserting only that the foreign row is gone passes
    // on a filter that returns nothing at all — which is total data loss.
    await persistList(makeList('mine', 'ignored-at-write'), KEY);
    await persistList(makeList('theirs', 'ignored-at-write'), KEY);
    await forceFamilyId('grocery_lists', 'theirs', 'some-other-family-uuid');

    const loaded = await loadListsFromDB(KEY);
    const ids = loaded.map((l) => l.id);

    expect(ids).toContain('mine');
    expect(ids).not.toContain('theirs');
    expect(loaded).toHaveLength(1);
  });

  it('drops a foreign list even when it is the ONLY foreign one of many', async () => {
    for (const id of ['a', 'b', 'c']) await persistList(makeList(id, 'x'), KEY);
    await forceFamilyId('grocery_lists', 'b', 'other-family');

    const ids = (await loadListsFromDB(KEY)).map((l) => l.id).sort();
    expect(ids).toEqual(['a', 'c']);
  });
});

describe('legacy rows are adopted, not hidden', () => {
  // The whole reason this is not a one-line Q.where. Every list this app has
  // written says 'default-family'; every item says ''.
  for (const legacy of ['default-family', '']) {
    it(`keeps a list whose family_id is ${JSON.stringify(legacy)}`, async () => {
      await persistList(makeList('legacy', 'x'), KEY);
      await forceFamilyId('grocery_lists', 'legacy', legacy);

      const loaded = await loadListsFromDB(KEY);
      expect(loaded.map((l) => l.id)).toEqual(['legacy']);
    });
  }

  it('keeps EVERY list on a device that predates this change', async () => {
    // The realistic upgrade: nothing has a real familyId, because nothing ever
    // wrote one. A strict filter would blank this user's entire app.
    for (const id of ['a', 'b', 'c', 'd']) {
      await persistList(makeList(id, 'x'), KEY);
      await forceFamilyId('grocery_lists', id, 'default-family');
    }
    expect((await loadListsFromDB(KEY)).map((l) => l.id).sort()).toEqual([
      'a', 'b', 'c', 'd',
    ]);
  });
});

describe('with no family membership yet, nothing is excluded', () => {
  it('keeps foreign rows rather than blanking the app mid-provisioning', async () => {
    await persistList(makeList('mine', 'x'), KEY);
    await persistList(makeList('theirs', 'x'), KEY);
    await forceFamilyId('grocery_lists', 'theirs', 'other-family');

    await clearFamilyMembership();
    expect(await getFamilyId()).toBeNull();

    // Excluding on an unknown identity is the failure that looks like total
    // data loss. An unresolved device shows everything.
    const ids = (await loadListsFromDB(KEY)).map((l) => l.id).sort();
    expect(ids).toEqual(['mine', 'theirs']);
  });
});

describe('new rows carry the real familyId', () => {
  it('stamps the membership familyId, not the caller’s placeholder', async () => {
    // Callers still pass 'default-family' / '' — the screens were not changed.
    // Stamping at the single write point fixes every one of them at once.
    await persistList(makeList('l1', 'default-family'), KEY);
    await persistItem(makeItem('i1', 'l1', ''), KEY);

    const familyId = await getFamilyId();
    expect(familyId).toBeTruthy();

    const [list] = await getDatabase()
      .get('grocery_lists')
      .query(Q.where('id', 'l1'))
      .fetch();
    const [item] = await getDatabase()
      .get('grocery_items')
      .query(Q.where('id', 'i1'))
      .fetch();

    expect((list as any).familyId).toBe(familyId);
    expect((item as any).familyId).toBe(familyId);
    expect((list as any).familyId).not.toBe('default-family');
  });

  it('adopts a legacy row the first time it is updated', async () => {
    await persistList(makeList('l1', 'x'), KEY);
    await forceFamilyId('grocery_lists', 'l1', 'default-family');

    await persistList({ ...makeList('l1', 'x'), name: 'renamed', version: 2 }, KEY);

    const [record] = await getDatabase()
      .get('grocery_lists')
      .query(Q.where('id', 'l1'))
      .fetch();
    expect((record as any).familyId).toBe(await getFamilyId());
  });

  it('does NOT overwrite a real familyId on update', async () => {
    // Adoption is for legacy sentinels only. Rewriting a genuine foreign id
    // would silently claim another family's row instead of excluding it.
    await persistList(makeList('l1', 'x'), KEY);
    await forceFamilyId('grocery_lists', 'l1', 'other-family');

    await persistList({ ...makeList('l1', 'x'), name: 'renamed', version: 2 }, KEY);

    const [record] = await getDatabase()
      .get('grocery_lists')
      .query(Q.where('id', 'l1'))
      .fetch();
    expect((record as any).familyId).toBe('other-family');
  });
});

describe('items are scoped by their LIST, not their own familyId', () => {
  it('keeps an item whose familyId disagrees with its surviving list', async () => {
    // Filtering items independently produces a half-populated list, which
    // reads as corruption rather than absence — strictly worse than hiding it.
    await persistList(makeList('l1', 'x'), KEY);
    await persistItem(makeItem('i1', 'l1', 'x'), KEY);
    await forceFamilyId('grocery_items', 'i1', 'some-other-family');

    const items = await loadItemsFromDB(KEY, { listIds: ['l1'] });
    expect(items.map((i) => i.id)).toEqual(['i1']);
  });

  it('drops items whose list was excluded', async () => {
    await persistList(makeList('l1', 'x'), KEY);
    await persistItem(makeItem('i1', 'l1', 'x'), KEY);
    await persistItem(makeItem('i2', 'gone', 'x'), KEY);

    const items = await loadItemsFromDB(KEY, { listIds: ['l1'] });
    expect(items.map((i) => i.id)).toEqual(['i1']);
  });

  it('returns everything when no list scope is supplied', async () => {
    // The un-scoped call must stay backward compatible; only hydrateFromDB
    // passes listIds.
    await persistList(makeList('l1', 'x'), KEY);
    await persistItem(makeItem('i1', 'l1', 'x'), KEY);
    await persistItem(makeItem('i2', 'l2', 'x'), KEY);

    expect((await loadItemsFromDB(KEY)).map((i) => i.id).sort()).toEqual(['i1', 'i2']);
  });
});

describe('the exclusion is announced, never silent', () => {
  it('warns with a count when rows are dropped', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await persistList(makeList('mine', 'x'), KEY);
      await persistList(makeList('theirs', 'x'), KEY);
      await forceFamilyId('grocery_lists', 'theirs', 'other-family');

      await loadListsFromDB(KEY);

      const said = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(said).toMatch(/ignored 1 row/);
      expect(said).toMatch(/different family/);
    } finally {
      warn.mockRestore();
    }
  });

  it('says nothing when nothing is dropped', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await persistList(makeList('mine', 'x'), KEY);
      await loadListsFromDB(KEY);
      const said = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(said).not.toMatch(/ignored/);
    } finally {
      warn.mockRestore();
    }
  });
});
