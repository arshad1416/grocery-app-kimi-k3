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
    // Failing closed was already right. What was missing is that the field
    // just disappeared from the user's list with no explanation anywhere they
    // would look — the console message below has never been read by a user.
    //
    // These rows are written by persistItem under the family key, including
    // rows that arrived from other devices (sync-manager.ts:299), so a failure
    // here means the same thing it means at the socket: this device's key does
    // not match its own data.
    await reportHydrateDecryptFailure(context);
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

/** Contexts already reported this session — see reportHydrateDecryptFailure. */
const reportedContexts = new Set<string>();

/**
 * Surface a hydrate decryption failure in the UI, at most once per context.
 *
 * Throttled because hydration walks every row: a wrong key fails on all of
 * them, so an unthrottled report would be one store write per field per item.
 * Reported once per context ('item.name', 'list.description', …), which is
 * enough to change what the indicator says.
 *
 * The import is dynamic so storage/ takes no static dependency on state/,
 * which would close a cycle through useSyncStore -> sync-manager. It is
 * AWAITED rather than fired and forgotten: the caller is already async, the
 * module is cached after the first hit, and a report that lands a tick later
 * than the null it explains is a race every caller would have to know about.
 * Errors are swallowed — failing to report must never turn a withheld field
 * into a thrown hydrate.
 */
async function reportHydrateDecryptFailure(context: string): Promise<void> {
  if (reportedContexts.has(context)) return;
  reportedContexts.add(context);
  try {
    const { useSyncStore } = await import('../state/useSyncStore');
    useSyncStore.getState().noteDecryptFailure(context);
  } catch {
    // Reporting is best-effort; the withheld field is the guarantee.
  }
}

/** Test-only: forget which contexts have been reported. */
export function __resetHydrateFailureReporting(): void {
  reportedContexts.clear();
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
export async function loadItemsFromDB(key: Uint8Array): Promise<GroceryItem[]> {
  const collection = getDatabase().get('grocery_items');
  const records = await collection.query().fetch();
  const items: GroceryItem[] = [];

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

    items.push({
      id: (record as any).id,
      listId: (record as any).listId,
      familyId: (record as any).familyId,
      name: name ?? '',
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

  return items;
}

/**
 * Read all lists from WatermelonDB, decrypt sensitive fields, and return them.
 */
export async function loadListsFromDB(key: Uint8Array): Promise<GroceryList[]> {
  const collection = getDatabase().get('grocery_lists');
  const records = await collection.query().fetch();
  const lists: GroceryList[] = [];

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

    lists.push({
      id: (record as any).id,
      familyId: (record as any).familyId,
      name: name ?? '',
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

  return lists;
}

/**
 * Read all family members from WatermelonDB, decrypt sensitive fields, and return them.
 */
export async function loadMembersFromDB(key: Uint8Array): Promise<FamilyMember[]> {
  const collection = getDatabase().get('family_members');
  const records = await collection.query().fetch();
  const members: FamilyMember[] = [];

  for (const record of records) {
    const displayName = await decryptField(
      (record as any).displayName,
      key,
      FIELD_CONTEXTS.FAMILY_MEMBER_DISPLAY_NAME,
    );

    members.push({
      id: (record as any).id,
      familyId: (record as any).familyId,
      displayName: displayName ?? '',
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

  return members;
}