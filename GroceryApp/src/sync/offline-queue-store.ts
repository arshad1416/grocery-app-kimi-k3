/**
 * Offline queue persistence — WatermelonDB-backed storage for Yjs updates
 * that were queued while the relay was unreachable.
 *
 * Without this, the in-memory queue in YjsWebSocketClient dies with the
 * process: an edit made offline reaches WatermelonDB (content is safe on
 * this device) but its incremental Yjs update is never delivered to the
 * family if the app is killed before reconnecting.
 *
 * SECURITY: payloads are stored as the same XChaCha20-Poly1305 envelope
 * used on the wire ({ciphertext, iv, tag}, AAD = listId). A raw Yjs update
 * contains plaintext item names and must never touch disk unencrypted.
 */

import { getDatabase } from '../storage/database';
import type { EncryptedData } from '../types';

export interface PersistedQueueEntry {
  id: string;
  listId: string;
  payload: EncryptedData;
  createdAt: number;
}

const TABLE = 'offline_queue';

/** Run fn inside a writer block when the adapter supports it (mocks may not). */
async function inWriter<T>(db: any, fn: () => Promise<T>): Promise<T> {
  if (typeof db.write === 'function') {
    return db.write(fn);
  }
  return fn();
}

function recordId(record: any): string {
  return record.id ?? record._raw?.id;
}

/**
 * Persist one queued update. Returns the record id, or null on failure
 * (persistence is best-effort; the in-memory queue still works without it).
 */
export async function saveQueueEntry(
  listId: string,
  payload: EncryptedData,
  createdAt: number,
): Promise<string | null> {
  try {
    const db: any = getDatabase();
    return await inWriter(db, async () => {
      const record: any = await db.get(TABLE).create((r: any) => {
        r.listId = listId;
        r.payload = JSON.stringify(payload);
        r.createdAt = createdAt;
      });
      return recordId(record) ?? null;
    });
  } catch (err) {
    console.warn('[offline-queue] Failed to persist entry:', err);
    return null;
  }
}

/**
 * Delete persisted entries by id (called after successful delivery).
 */
export async function deleteQueueEntries(ids: Array<string | null | undefined>): Promise<void> {
  const idSet = new Set(ids.filter(Boolean) as string[]);
  if (idSet.size === 0) return;
  try {
    const db: any = getDatabase();
    await inWriter(db, async () => {
      const records = await db.get(TABLE).query().fetch();
      for (const record of records as any[]) {
        if (idSet.has(recordId(record))) {
          await record.markAsDeleted();
        }
      }
    });
  } catch (err) {
    console.warn('[offline-queue] Failed to delete entries:', err);
  }
}

/**
 * Load all persisted queue entries (oldest first).
 *
 * A row that cannot yield a complete envelope is unusable forever — nothing
 * later in the app's life makes an unparseable payload parse. It is therefore
 * reported and deleted, not skipped: skipping left it on disk to be re-scanned
 * on every launch while the table grew without bound.
 */
export async function loadQueueEntries(): Promise<PersistedQueueEntry[]> {
  try {
    const db: any = getDatabase();
    const records = await db.get(TABLE).query().fetch();
    const entries: PersistedQueueEntry[] = [];
    const unusable: string[] = [];
    for (const record of records as any[]) {
      try {
        const payload = JSON.parse(record.payload) as EncryptedData;
        if (!payload?.ciphertext || !payload?.iv || !payload?.tag) {
          unusable.push(recordId(record));
          continue;
        }
        entries.push({
          id: recordId(record),
          listId: record.listId,
          payload,
          createdAt: record.createdAt,
        });
      } catch {
        unusable.push(recordId(record));
      }
    }
    if (unusable.length > 0) {
      console.warn(
        `[offline-queue] Discarding ${unusable.length} unusable row(s); ` +
        `those offline edits were never delivered.`,
      );
      await deleteQueueEntries(unusable);
    }
    entries.sort((a, b) => a.createdAt - b.createdAt);
    return entries;
  } catch (err) {
    console.warn('[offline-queue] Failed to load entries:', err);
    return [];
  }
}
