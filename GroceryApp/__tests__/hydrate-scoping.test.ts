/**
 * Hydration must skip rows this device can no longer decrypt — and NOTHING else.
 *
 * The bug: joining a family replaces this device's master key (the confirm
 * dialog in RecoveryScreen says so) and nothing wipes the rows written under
 * the old one. loadListsFromDB / loadItemsFromDB / loadMembersFromDB fetched
 * the whole collection, so every launch walked dead rows forever. Their
 * encrypted fields came back null and were coerced to '' — a nameless list the
 * user could tap into.
 *
 * WHY THIS IS NOT A `family_id` FILTER, which is what it looks like it should
 * be. Two reasons, and the second is why the obvious fix is worse than the bug:
 *
 *  1. The column has never held a real family id. Lists always carry the
 *     literal 'default-family' — HomeScreen resolves it from the
 *     family_members TABLE and `addMember` has ZERO callers, so that table is
 *     always empty and the fallback always wins. Items always carry ''. A
 *     strict match therefore hides 100% of every existing user's data.
 *
 *  2. Making the column accurate would be WORSE. familyId is not stable:
 *     `ensureFamilyMembership` mints a fresh UUID whenever the membership is
 *     missing, and it goes missing in ways the user never chose —
 *     expo-secure-store deletes entries whose Keystore key is gone (Android
 *     reinstall / device transfer, which allowBackup makes reachable), and
 *     `createFamilyInviteLink` re-founds a family after an unpair
 *     (invite-link.ts:69-73). `recoverFromPhrase` restores the master KEY but
 *     never the familyId. So a user who recovers correctly, whose data
 *     decrypts perfectly, gets a new familyId — and every row stamped with the
 *     old one would be hidden forever, with no path back.
 *
 * An earlier version of this change did exactly that: it stamped the real
 * familyId onto rows at write time and filtered on it. That converted a
 * recoverable state into an unrecoverable one. Decryptability is the honest
 * predicate — a row that decrypts is the user's, whatever its family_id says.
 *
 * Run: npx jest __tests__/hydrate-scoping.test.ts
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import { Q } from '@nozbe/watermelondb';
import * as WatermelonDB from '@nozbe/watermelondb';

import { initCrypto } from '../src/crypto';
import { initDeviceIdentity, getDeviceKeypair } from '../src/identity/device';
import { ensureFamilyMembership, clearFamilyMembership } from '../src/identity/family';
import {
  persistItem,
  persistList,
  loadItemsFromDB,
  loadListsFromDB,
} from '../src/storage/hydrate';
import { getDatabase } from '../src/storage/database';
import type { GroceryItem, GroceryList } from '../src/types';

/** The device's current key, and the key a pre-join row was written under. */
const KEY_NOW = new Uint8Array(32).fill(4);
const KEY_OLD = new Uint8Array(32).fill(9);

const makeList = (id: string, familyId = 'default-family'): GroceryList => ({
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

const makeItem = (id: string, listId: string, familyId = ''): GroceryItem => ({
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

async function setFamilyId(table: string, id: string, familyId: string) {
  const [record] = await getDatabase().get(table).query(Q.where('id', id)).fetch();
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

describe('rows written under a different key are skipped', () => {
  it('skips the dead row while KEEPING the live one', async () => {
    // Both halves matter. Asserting only that the dead row is gone passes on
    // an implementation that returns nothing at all — total data loss.
    await persistList(makeList('old'), KEY_OLD);
    await persistList(makeList('new'), KEY_NOW);

    expect((await loadListsFromDB(KEY_NOW)).map((l) => l.id)).toEqual(['new']);
  });

  it('never yields a row with an empty name instead of skipping it', async () => {
    // The pre-change behaviour was `name ?? ''`, so a dead row surfaced as a
    // nameless list the user could open.
    await persistList(makeList('old'), KEY_OLD);

    const lists = await loadListsFromDB(KEY_NOW);
    expect(lists).toHaveLength(0);
    expect(lists.map((l) => l.name)).not.toContain('');
  });

  it('skips dead items and keeps live ones', async () => {
    await persistList(makeList('l1'), KEY_NOW);
    await persistItem(makeItem('dead', 'l1'), KEY_OLD);
    await persistItem(makeItem('live', 'l1'), KEY_NOW);

    expect((await loadItemsFromDB(KEY_NOW)).map((i) => i.id)).toEqual(['live']);
  });

  it('keeps legacy plaintext rows, which are not encrypted at all', async () => {
    // decryptField returns non-JSON input verbatim. Those rows must not be
    // mistaken for undecryptable ones and swept away.
    await persistList(makeList('l1'), KEY_NOW);
    const [record] = await getDatabase().get('grocery_lists').query(Q.where('id', 'l1')).fetch();
    await getDatabase().write(async () => {
      await (record as any).update((r: any) => {
        r.name = 'a legacy plaintext name';
      });
    });

    const lists = await loadListsFromDB(KEY_NOW);
    expect(lists.map((l) => l.name)).toEqual(['a legacy plaintext name']);
  });
});

describe('family_id is NEVER consulted', () => {
  // The whole point. Every row here decrypts, so every one must be visible no
  // matter what its family_id says.
  for (const [label, fid] of [
    ['the universal legacy list value', 'default-family'],
    ['the universal legacy item value', ''],
    ['a foreign family UUID', 'a-completely-different-family-uuid'],
    ['a stale UUID from a previous membership', '11111111-2222-3333-4444-555555555555'],
  ] as const) {
    it(`keeps a decryptable row carrying ${label}`, async () => {
      await persistList(makeList('l1'), KEY_NOW);
      await setFamilyId('grocery_lists', 'l1', fid);

      expect((await loadListsFromDB(KEY_NOW)).map((l) => l.id)).toEqual(['l1']);
    });
  }

  it('survives the familyId regenerating under the user', async () => {
    // The scenario that killed the family_id approach: a keystore loss, or an
    // unpair followed by an invite, mints a NEW familyId while the master key
    // is intact — recoverFromPhrase restores the key and never the familyId.
    // The user's data decrypts perfectly and must stay visible.
    await persistList(makeList('l1'), KEY_NOW);
    await persistItem(makeItem('i1', 'l1'), KEY_NOW);

    await clearFamilyMembership();
    await ensureFamilyMembership(getDeviceKeypair()); // brand-new UUID

    expect((await loadListsFromDB(KEY_NOW)).map((l) => l.id)).toEqual(['l1']);
    expect((await loadItemsFromDB(KEY_NOW)).map((i) => i.id)).toEqual(['i1']);
  });

  it('shows everything when there is no membership at all', async () => {
    await persistList(makeList('l1'), KEY_NOW);
    await clearFamilyMembership();

    expect((await loadListsFromDB(KEY_NOW)).map((l) => l.id)).toEqual(['l1']);
  });

  it('does not rewrite family_id on create — nothing may become unadoptable', async () => {
    // An earlier version stamped the real familyId here. That is precisely
    // what made rows permanently excludable once the familyId regenerated.
    await persistList(makeList('l1', 'default-family'), KEY_NOW);
    await persistItem(makeItem('i1', 'l1', ''), KEY_NOW);

    const [list] = await getDatabase().get('grocery_lists').query(Q.where('id', 'l1')).fetch();
    const [item] = await getDatabase().get('grocery_items').query(Q.where('id', 'i1')).fetch();

    expect((list as any).familyId).toBe('default-family');
    expect((item as any).familyId).toBe('');
  });

  it('does not rewrite family_id on update either', async () => {
    await persistList(makeList('l1'), KEY_NOW);
    await setFamilyId('grocery_lists', 'l1', 'other-family');

    await persistList({ ...makeList('l1'), name: 'renamed', version: 2 }, KEY_NOW);

    const [record] = await getDatabase().get('grocery_lists').query(Q.where('id', 'l1')).fetch();
    expect((record as any).familyId).toBe('other-family');
  });
});

describe('items are scoped by their LIST when a scope is given', () => {
  it('keeps an item whose family_id disagrees with its surviving list', async () => {
    // Filtering items on their own family_id lets an item vanish from a list
    // still on screen. A half-populated list reads as corruption, which is
    // worse than absence.
    await persistList(makeList('l1'), KEY_NOW);
    await persistItem(makeItem('i1', 'l1'), KEY_NOW);
    await setFamilyId('grocery_items', 'i1', 'some-other-family');

    expect((await loadItemsFromDB(KEY_NOW, { listIds: ['l1'] })).map((i) => i.id)).toEqual(['i1']);
  });

  it('drops items whose list is not in scope', async () => {
    await persistList(makeList('l1'), KEY_NOW);
    await persistItem(makeItem('i1', 'l1'), KEY_NOW);
    await persistItem(makeItem('i2', 'gone'), KEY_NOW);

    expect((await loadItemsFromDB(KEY_NOW, { listIds: ['l1'] })).map((i) => i.id)).toEqual(['i1']);
  });

  it('returns everything when no scope is supplied', async () => {
    await persistItem(makeItem('i1', 'l1'), KEY_NOW);
    await persistItem(makeItem('i2', 'l2'), KEY_NOW);

    expect((await loadItemsFromDB(KEY_NOW)).map((i) => i.id).sort()).toEqual(['i1', 'i2']);
  });
});

describe('skipping is announced, never silent', () => {
  it('warns with a count when rows are skipped', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await persistList(makeList('old'), KEY_OLD);
      await persistList(makeList('new'), KEY_NOW);
      await loadListsFromDB(KEY_NOW);

      const said = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(said).toMatch(/skipped 1 row/);
      expect(said).toMatch(/could not be decrypted/);
    } finally {
      warn.mockRestore();
    }
  });

  it('says nothing when nothing is skipped', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await persistList(makeList('l1'), KEY_NOW);
      await loadListsFromDB(KEY_NOW);
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/skipped/);
    } finally {
      warn.mockRestore();
    }
  });
});
