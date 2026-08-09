/**
 * Hydration: WatermelonDB → decrypt → Zustand.
 *
 * On app start, reads all records from WatermelonDB, decrypts sensitive fields,
 * and populates the Zustand stores. After each mutation, writes back through
 * the write-through pattern (encrypt → WatermelonDB).
 *
 * This module implements the write-through persistence strategy:
 *   - Every Zustand mutation also writes encrypted data to WatermelonDB
 *   - On app start, hydrate Zustand from WatermelonDB
 *   - No explicit "save" step needed — the database is always in sync
 */

import { Q } from '@nozbe/watermelondb';
import { getDatabase } from './database';
import { getMasterKey, encrypt, decrypt } from '../crypto';
import { FIELD_CONTEXTS } from '../types';

// ─── Type imports ─────────────────────────────────────────────────────────────

import type {
  GroceryItem,
  GroceryList,
  FamilyMember,
  EncryptedData,
} from '../types';

// ─── Sensitive field mappings ─────────────────────────────────────────────────
// Maps each model type's sensitive fields to their AAD context

const SENSITIVE_FIELDS = {
  grocery_items: {
    name: FIELD_CONTEXTS.GROCERY_ITEM_NAME,
    notes: FIELD_CONTEXTS.GROCERY_ITEM_NOTES,
  },
  grocery_lists: {
    name: FIELD_CONTEXTS.GROCERY_LIST_NAME,
    description: FIELD_CONTEXTS.GROCERY_LIST_DESCRIPTION,
    storePreference: FIELD_CONTEXTS.GROCERY_LIST_STORE_PREFERENCE,
  },
  family_members: {
    displayName: FIELD_CONTEXTS.FAMILY_MEMBER_DISPLAY_NAME,
  },
} as const;

// ─── Encrypt helpers ──────────────────────────────────────────────────────────

/**
 * Encrypt a single field value with context-bound AAD.
 * Returns the ciphertext as a base64 string, or the original value if no key.
 */
export async function encryptField(
  plaintext: string,
  key: Uint8Array,
  context: string,
): Promise<string> {
  const encrypted: EncryptedData = await encrypt(plaintext, key, context);
  // WatermelonDB stores a single string; serialize the envelope as JSON
  return JSON.stringify(encrypted);
}

/**
 * Decrypt a single field value that was encrypted with context-bound AAD.
 *
 * Two failures are possible here and they are NOT the same thing:
 *
 *   "this was never an envelope" — a legacy row written before field
 *     encryption existed. Correct response: hand the value back unchanged.
 *   "this IS an envelope and it would not authenticate" — wrong key, or
 *     corrupted/tampered ciphertext. Correct response: withhold it.
 *
 * They used to share one try/catch, with `decrypt()` inside the block whose
 * catch is commented "Not encrypted". So an AEAD authentication failure fell
 * through to `return stored` and the caller received the envelope JSON
 * (`{"ciphertext":…,"iv":…,"tag":…}`) as though it were the user's own text.
 * That is worse than a crash twice over: the grocery item renders as raw JSON,
 * and the integrity guarantee the Poly1305 tag exists to provide is discarded
 * at exactly the moment it fired. Write-through would then re-encrypt that
 * envelope-as-plaintext on the next edit, cementing the loss.
 *
 * On an authentication failure the field is withheld (null) rather than thrown:
 * every caller is on the hydration path, so throwing would stop the whole list
 * from loading over one bad row. Null degrades that row and keeps the app usable,
 * and the failure is logged loudly rather than disguised as plaintext.
 *
 * @returns The plaintext, the original value when it was never encrypted, or
 *          null when an envelope failed to authenticate.
 */
export async function decryptField(
  stored: string | null | undefined,
  key: Uint8Array,
  context: string,
): Promise<string | null> {
  if (!stored) return null;

  let parsed: EncryptedData | null = null;
  try {
    parsed = JSON.parse(stored) as EncryptedData;
  } catch {
    return stored; // Not JSON at all — a legacy plaintext row.
  }

  // Parsed, but not one of our envelopes (a number, null, a plain object).
  if (!parsed?.ciphertext || !parsed?.iv || !parsed?.tag) {
    return stored;
  }

  try {
    return await decrypt(parsed, key, context);
  } catch (err) {
    // Deliberately NOT surfaced in the UI, unlike the socket path.
    //
    // A failure here is NOT reliable evidence of a key mismatch. Joining a
    // family legitimately replaces this device's key (recovery.ts, and the
    // confirm dialog says so in as many words) and nothing wipes the rows
    // written under the old one — loadItemsFromDB/loadListsFromDB fetch the
    // whole collection with no familyId filter. So on a device that joined a
    // family and is syncing perfectly, hydration walks orphaned old-key rows
    // on EVERY launch and every one of them fails here. Driving the indicator
    // from this would latch "can't read your lists" permanently on a healthy
    // device — a false alarm that is worse than the silence it replaced,
    // because it trains the user to ignore the one warning that matters.
    //
    // decrypt() also base64-decodes inside its own try, so a truncated or
    // half-written field lands here too and is not an AEAD failure at all.
    //
    // The socket path has none of that ambiguity: a live family member sent
    // something this device cannot read, right now. That is what drives the UI.
    console.error(
      `[hydrate] AEAD authentication failed for field context "${context}". ` +
        'This means the wrong key, or corrupted/tampered ciphertext — NOT that ' +
        'the value was stored in plaintext. Withholding the field rather than ' +
        'returning the ciphertext envelope as if it were user data.',
      err,
    );
    return null;
  }
}

// ─── Scoping hydration to data this device can actually read ─────────────────

/**
 * Why this is NOT a `family_id` filter.
 *
 * The obvious fix for "a joined device hydrates rows written under its old
 * key" is to keep only rows whose family_id matches the current family. Two
 * things make that wrong, and the second is the dangerous one:
 *
 *  1. The column has never held a real family id. Lists always carry the
 *     literal 'default-family' (HomeScreen falls back to it because
 *     `addMember` has zero callers, so the family_members table is always
 *     empty); items always carry ''. So a strict match hides EVERYTHING.
 *
 *  2. The familyId is not stable, so making the column accurate would be
 *     worse than leaving it wrong. `ensureFamilyMembership` mints a fresh
 *     UUID whenever the membership is missing, and it goes missing in ways
 *     the user never chose: expo-secure-store DELETES entries whose Keystore
 *     key is gone (SecureStoreModule.kt — "occurs when the app is
 *     reinstalled"), which Android's allowBackup makes reachable on a device
 *     transfer, and `createFamilyInviteLink` re-founds a family after an
 *     unpair (invite-link.ts:69-73). `recoverFromPhrase` restores the master
 *     KEY but never the familyId. So a user who recovers correctly, with data
 *     that decrypts perfectly, gets a new familyId — and every row tagged
 *     with the old one would be hidden forever.
 *
 * Decryptability is the honest predicate, and it is what the problem was
 * actually about. A row whose ciphertext fails Poly1305 under the current key
 * is unusable no matter which family it claims; a row that decrypts is the
 * user's, whatever its family_id says. It also cannot be destabilised by an
 * identifier regenerating, because it does not consult one.
 */
function dropUnreadable<T>(
  rows: readonly (T | null)[],
  label: string,
): T[] {
  const kept = rows.filter((r): r is T => r !== null);
  const dropped = rows.length - kept.length;
  if (dropped > 0) {
    // Never silent. Rows vanishing is indistinguishable from data loss unless
    // something says otherwise.
    console.warn(
      `[hydrate] ${label}: skipped ${dropped} row(s) that could not be ` +
        'decrypted with this device\'s key. Expected on a device that joined a ' +
        'family — rows written before the join were encrypted under the old ' +
        'key and can never be read again.',
    );
  }
  return kept;
}

// ─── Write-through: encrypt and persist ───────────────────────────────────────

/**
 * Encrypt sensitive fields and write a GroceryItem to WatermelonDB.
 * Called after every Zustand mutation.
 */
export async function persistItem(
  item: GroceryItem,
  key: Uint8Array,
): Promise<void> {
  const collection = getDatabase().get('grocery_items');
  const encryptedName = await encryptField(
    item.name,
    key,
    FIELD_CONTEXTS.GROCERY_ITEM_NAME,
  );
  const encryptedNotes = item.notes !== undefined && item.notes !== null
    ? await encryptField(item.notes, key, FIELD_CONTEXTS.GROCERY_ITEM_NOTES)
    : null;

  const existing = await collection.query(Q.where('id', item.id)).fetch();
  await getDatabase().write(async () => {
    if (existing.length > 0) {
      await existing[0].update((record: any) => {
        record.name = encryptedName;
        record.notes = encryptedNotes;
        record.quantity = item.quantity;
        record.unit = item.unit;
        record.category = item.category;
        record.isChecked = item.isChecked;
        record.isDeleted = item.isDeleted;
        record.deletedAt = item.deletedAt;
        record.version = item.version;
        record.recordSyncStatus = item.syncStatus;
        record.updatedAt = item.updatedAt;
      });
    } else {
      await collection.create((record: any) => {
        record._raw.id = item.id;
        record.listId = item.listId;
        // Stamp the REAL familyId, so new rows are correctly scoped even
        // though every caller still hands us '' (see LEGACY_FAMILY_IDS).
        record.familyId = item.familyId;
        record.name = encryptedName;
        record.quantity = item.quantity;
        record.unit = item.unit;
        record.category = item.category;
        record.isChecked = item.isChecked;
        record.addedBy = item.addedBy;
        record.assignedTo = item.assignedTo ?? null;
        record.notes = encryptedNotes;
        record.sortOrder = item.sortOrder;
        record.isDeleted = item.isDeleted;
        record.deletedAt = item.deletedAt;
        record.version = item.version;
        record.recordSyncStatus = item.syncStatus;
        record.createdAt = item.createdAt;
        record.updatedAt = item.updatedAt;
      });
    }
  });
}

/**
 * Encrypt sensitive fields and write a GroceryList to WatermelonDB.
 */
export async function persistList(
  list: GroceryList,
  key: Uint8Array,
): Promise<void> {
  const collection = getDatabase().get('grocery_lists');
  const encryptedName = await encryptField(
    list.name,
    key,
    FIELD_CONTEXTS.GROCERY_LIST_NAME,
  );
  const encryptedDesc = list.description
    ? await encryptField(list.description, key, FIELD_CONTEXTS.GROCERY_LIST_DESCRIPTION)
    : null;
  const encryptedStore = list.storePreference
    ? await encryptField(list.storePreference, key, FIELD_CONTEXTS.GROCERY_LIST_STORE_PREFERENCE)
    : null;

  const existing = await collection.query(Q.where('id', list.id)).fetch();
  await getDatabase().write(async () => {
    if (existing.length > 0) {
      await existing[0].update((record: any) => {
        record.name = encryptedName;
        record.description = encryptedDesc;
        record.storePreference = encryptedStore;
        record.isActive = list.isActive;
        record.isDeleted = list.isDeleted;
        record.deletedAt = list.deletedAt;
        record.version = list.version;
        record.recordSyncStatus = list.syncStatus;
        record.updatedAt = list.updatedAt;
      });
    } else {
      await collection.create((record: any) => {
        record._raw.id = list.id;
        record.familyId = list.familyId;
        record.name = encryptedName;
        record.description = encryptedDesc;
        record.storePreference = encryptedStore;
        record.isActive = list.isActive;
        record.isDeleted = list.isDeleted;
        record.deletedAt = list.deletedAt;
        record.version = list.version;
        record.recordSyncStatus = list.syncStatus;
        record.createdAt = list.createdAt;
        record.updatedAt = list.updatedAt;
      });
    }
  });
}

/**
 * Encrypt sensitive fields and write a FamilyMember to WatermelonDB.
 */
export async function persistMember(
  member: FamilyMember,
  key: Uint8Array,
): Promise<void> {
  const collection = getDatabase().get('family_members');
  const encryptedDisplayName = await encryptField(
    member.displayName,
    key,
    FIELD_CONTEXTS.FAMILY_MEMBER_DISPLAY_NAME,
  );

  const existing = await collection.query(Q.where('id', member.id)).fetch();
  await getDatabase().write(async () => {
    if (existing.length > 0) {
      await existing[0].update((record: any) => {
        record.displayName = encryptedDisplayName;
        record.avatarUrl = member.avatarUrl ?? null;
        record.isActive = member.isActive;
        record.isDeleted = member.isDeleted;
        record.deletedAt = member.deletedAt;
        record.version = member.version;
        record.recordSyncStatus = member.syncStatus;
        record.updatedAt = member.updatedAt;
      });
    } else {
      await collection.create((record: any) => {
        record._raw.id = member.id;
        record.familyId = member.familyId;
        record.displayName = encryptedDisplayName;
        record.avatarUrl = member.avatarUrl ?? null;
        record.isActive = member.isActive;
        record.isDeleted = member.isDeleted;
        record.deletedAt = member.deletedAt;
        record.version = member.version;
        record.recordSyncStatus = member.syncStatus;
        record.joinedAt = member.joinedAt;
        record.updatedAt = member.updatedAt;
      });
    }
  });
}

/**
 * Delete a record from WatermelonDB permanently (for hard-delete scenarios).
 * For soft-delete, use persistItem/persistList/persistMember with isDeleted=true.
 */
export async function deleteRecord(
  table: 'grocery_items' | 'grocery_lists' | 'family_members',
  id: string,
): Promise<void> {
  const collection = getDatabase().get(table);
  const records = await collection.query(Q.where('id', id)).fetch();
  if (records.length > 0) {
    await records[0].markAsDeleted();
  }
}

// ─── Hydrate: read from WatermelonDB → decrypt → Zustand ─────────────────────

/**
 * Read all items from WatermelonDB, decrypt sensitive fields, and return them.
 * Used by Zustand stores during app initialization.
 */
export async function loadItemsFromDB(
  key: Uint8Array,
  options?: { listIds?: readonly string[] },
): Promise<GroceryItem[]> {
  const collection = getDatabase().get('grocery_items');
  const all = await collection.query().fetch();

  // Scoped by LIST membership, not by the item's own familyId.
  //
  // Filtering items independently lets an item's familyId disagree with its
  // list's, so the item vanishes from a list that is still on screen — a
  // half-populated list, which is worse than a hidden one because it looks
  // like the data is corrupt rather than absent. Membership in a surviving
  // list is the real predicate, and it cannot skew.
  const records =
    options?.listIds === undefined
      ? all
      : (() => {
          const allowed = new Set(options.listIds);
          const kept = all.filter((r) => allowed.has((r as any).listId));
          const dropped = all.length - kept.length;
          if (dropped > 0) {
            console.warn(
              `[hydrate] items: ignored ${dropped} row(s) whose list is not in ` +
                'this family.',
            );
          }
          return kept;
        })();

  const items: (GroceryItem | null)[] = [];

  for (const record of records) {
    const name = await decryptField(
      (record as any).name,
      key,
      FIELD_CONTEXTS.GROCERY_ITEM_NAME,
    );
    const notes = await decryptField(
      (record as any).notes,
      key,
      FIELD_CONTEXTS.GROCERY_ITEM_NOTES,
    );

    if (name === null) {
      items.push(null);
      continue;
    }

    items.push({
      id: (record as any).id,
      listId: (record as any).listId,
      familyId: (record as any).familyId,
      name,
      quantity: (record as any).quantity,
      unit: (record as any).unit,
      category: (record as any).category,
      isChecked: (record as any).isChecked,
      addedBy: (record as any).addedBy,
      assignedTo: (record as any).assignedTo,
      notes: notes ?? undefined,
      sortOrder: (record as any).sortOrder,
      isDeleted: (record as any).isDeleted,
      deletedAt: (record as any).deletedAt,
      version: (record as any).version,
      syncStatus: (record as any).recordSyncStatus ?? 'synced',
      createdAt: (record as any).createdAt,
      updatedAt: (record as any).updatedAt,
    });
  }

  return dropUnreadable(items, 'items');
}

/**
 * Read all lists from WatermelonDB, decrypt sensitive fields, and return them.
 */
export async function loadListsFromDB(key: Uint8Array): Promise<GroceryList[]> {
  const collection = getDatabase().get('grocery_lists');
  const records = await collection.query().fetch();
  const lists: (GroceryList | null)[] = [];

  for (const record of records) {
    const name = await decryptField(
      (record as any).name,
      key,
      FIELD_CONTEXTS.GROCERY_LIST_NAME,
    );
    const description = await decryptField(
      (record as any).description,
      key,
      FIELD_CONTEXTS.GROCERY_LIST_DESCRIPTION,
    );
    const storePreference = await decryptField(
      (record as any).storePreference,
      key,
      FIELD_CONTEXTS.GROCERY_LIST_STORE_PREFERENCE,
    );

    // `name` is the only field guaranteed encrypted on every list, so it is
    // the decryptability probe. null means the AEAD tag rejected it — the row
    // was written under a different key and is gone for good. It used to be
    // coerced to '' and rendered as a nameless list the user could tap into.
    if (name === null) {
      lists.push(null);
      continue;
    }

    lists.push({
      id: (record as any).id,
      familyId: (record as any).familyId,
      name,
      description: description ?? undefined,
      storePreference: storePreference ?? undefined,
      isActive: (record as any).isActive,
      isDeleted: (record as any).isDeleted,
      deletedAt: (record as any).deletedAt,
      version: (record as any).version,
      syncStatus: (record as any).recordSyncStatus ?? 'synced',
      createdAt: (record as any).createdAt,
      updatedAt: (record as any).updatedAt,
    });
  }

  return dropUnreadable(lists, 'lists');
}

/**
 * Read all family members from WatermelonDB, decrypt sensitive fields, and return them.
 */
export async function loadMembersFromDB(key: Uint8Array): Promise<FamilyMember[]> {
  const collection = getDatabase().get('family_members');
  const records = await collection.query().fetch();
  const members: (FamilyMember | null)[] = [];

  for (const record of records) {
    const displayName = await decryptField(
      (record as any).displayName,
      key,
      FIELD_CONTEXTS.FAMILY_MEMBER_DISPLAY_NAME,
    );

    if (displayName === null) {
      members.push(null);
      continue;
    }

    members.push({
      id: (record as any).id,
      familyId: (record as any).familyId,
      displayName,
      avatarUrl: (record as any).avatarUrl,
      isActive: (record as any).isActive,
      isDeleted: (record as any).isDeleted,
      deletedAt: (record as any).deletedAt,
      version: (record as any).version,
      syncStatus: (record as any).recordSyncStatus ?? 'synced',
      joinedAt: (record as any).joinedAt,
      updatedAt: (record as any).updatedAt,
    });
  }

  return dropUnreadable(members, 'members');
}