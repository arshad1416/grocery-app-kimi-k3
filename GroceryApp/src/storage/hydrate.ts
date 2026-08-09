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

// ─── Family scoping ──────────────────────────────────────────────────────────

/**
 * Values that appear in the `family_id` column but do not identify a family.
 *
 * The column was never wired to the real family identity. Every list this app
 * has ever written carries the literal 'default-family', because HomeScreen
 * resolves it from the family_members TABLE and `addMember` has zero callers,
 * so that table is always empty. Items are worse: AddItemSheet and
 * ItemEditScreen fall through to '' for the first item in a list, and every
 * later item copies it from the first.
 *
 * So a filter of `family_id === currentFamilyId` — the obvious fix — would
 * hide 100% of every existing user's lists and items. These rows are adopted
 * into the current family on read instead, which is safe precisely because
 * they cannot belong to any OTHER family: no code path has ever written a real
 * familyId here.
 */
const LEGACY_FAMILY_IDS: ReadonlySet<string> = new Set(['', 'default-family']);

const isLegacyFamilyId = (v: unknown): boolean =>
  v == null || (typeof v === 'string' && LEGACY_FAMILY_IDS.has(v));

/**
 * Keep only rows belonging to this family, adopting legacy-scoped ones.
 *
 * A row is excluded ONLY when it carries a real familyId that is not ours —
 * which is exactly the join-orphan case this exists for: joining a family
 * replaces the device key, and the rows written under the old key are dead
 * weight that fails to decrypt on every launch forever.
 *
 * `familyId === null` means membership does not exist yet (mid-provisioning,
 * or a cold-start race). Everything is kept in that case, deliberately: a
 * device that has not yet resolved who it is must not blank the user's lists.
 * Excluding on an unknown identity is the failure mode that looks like total
 * data loss.
 */
function scopeToFamily<T extends { familyId?: unknown }>(
  records: readonly T[],
  familyId: string | null,
  label: string,
): { kept: T[]; dropped: number } {
  if (!familyId) return { kept: [...records], dropped: 0 };

  const kept = records.filter(
    (r) => r.familyId === familyId || isLegacyFamilyId(r.familyId),
  );
  const dropped = records.length - kept.length;
  if (dropped > 0) {
    // Say it out loud. Filtering makes rows DISAPPEAR, which from the user's
    // side is indistinguishable from data loss — and a silent disappearance is
    // the exact class of failure the rest of this work removed.
    console.warn(
      `[hydrate] ${label}: ignored ${dropped} row(s) belonging to a different ` +
        `family. This is expected on a device that joined a family — the rows ` +
        `written before the join are encrypted under the old key and can never ` +
        `be read again.`,
    );
  }
  return { kept, dropped };
}

/**
 * The familyId to stamp on rows this device writes.
 *
 * Reads through to the membership in SecureStore — the ONLY place a real
 * familyId has ever lived. Returns null when there is no membership yet, in
 * which case the caller keeps whatever it was given rather than inventing one.
 */
async function currentFamilyId(): Promise<string | null> {
  try {
    const { getFamilyId } = await import('../identity/family');
    return await getFamilyId();
  } catch {
    return null;
  }
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

  // Resolved before the write block: create() takes a synchronous callback.
  const stampedFamilyId = (await currentFamilyId()) ?? item.familyId;

  const existing = await collection.query(Q.where('id', item.id)).fetch();
  await getDatabase().write(async () => {
    if (existing.length > 0) {
      await existing[0].update((record: any) => {
        // Adopt on update too, so a legacy row corrects itself the first time
        // it is touched rather than staying ambiguous forever.
        if (isLegacyFamilyId(record.familyId)) record.familyId = stampedFamilyId;
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
        record.familyId = stampedFamilyId;
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

  const stampedFamilyId = (await currentFamilyId()) ?? list.familyId;

  const existing = await collection.query(Q.where('id', list.id)).fetch();
  await getDatabase().write(async () => {
    if (existing.length > 0) {
      await existing[0].update((record: any) => {
        if (isLegacyFamilyId(record.familyId)) record.familyId = stampedFamilyId;
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
        record.familyId = stampedFamilyId;
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

  const stampedFamilyId = (await currentFamilyId()) ?? member.familyId;

  const existing = await collection.query(Q.where('id', member.id)).fetch();
  await getDatabase().write(async () => {
    if (existing.length > 0) {
      await existing[0].update((record: any) => {
        if (isLegacyFamilyId(record.familyId)) record.familyId = stampedFamilyId;
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
        record.familyId = stampedFamilyId;
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
  const all = await collection.query().fetch();
  const { kept: records } = scopeToFamily(
    all as unknown as Array<{ familyId?: unknown }>,
    await currentFamilyId(),
    'lists',
  ) as unknown as { kept: typeof all };
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
  const all = await collection.query().fetch();
  const { kept: records } = scopeToFamily(
    all as unknown as Array<{ familyId?: unknown }>,
    await currentFamilyId(),
    'members',
  ) as unknown as { kept: typeof all };
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