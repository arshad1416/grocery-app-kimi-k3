/**
 * Yjs CRDT Adapter for GroceryApp.
 *
 * Manages Yjs documents for each grocery list, handling concurrent edits
 * from multiple family members via CRDT (Conflict-Free Replicated Data Types).
 *
 * Yjs shared types:
 *  - yMap<string, any> for list metadata (name, description, storePreference)
 *  - yArray<yMap> for items within a list
 *  - yMap for family members roster
 *
 * Yjs is the source of truth for sync. WatermelonDB persists state locally.
 * Encrypted Yjs updates are sent over WebSocket via y-websocket.ts.
 */

import * as Y from 'yjs';
import type { GroceryItem, GroceryList, FamilyMember } from '../types';

// ─── Document Map ────────────────────────────────────────────────────────────

/**
 * Map of list ID → Yjs document.
 * Each grocery list gets its own Yjs document for scope isolation.
 */
const docs = new Map<string, Y.Doc>();

// ─── Shared Type Accessors ───────────────────────────────────────────────────

/**
 * Get or create a Yjs document for a specific grocery list.
 * Documents are cached and reused.
 */
export function getDoc(listId: string): Y.Doc {
  let doc = docs.get(listId);
  if (!doc) {
    doc = new Y.Doc();
    docs.set(listId, doc);
  }
  return doc;
}

/**
 * Get or create the metadata shared type for a list.
 * Returns a Y.Map containing name, description, storePreference, etc.
 */
export function getListMeta(listId: string): Y.Map<any> {
  const doc = getDoc(listId);
  return doc.getMap('meta');
}

/**
 * Get or create the items array for a list.
 * Each item is represented as a Y.Map with typed fields.
 */
export function getItemsArray(listId: string): Y.Array<Y.Map<any>> {
  const doc = getDoc(listId);
  return doc.getArray('items');
}

/**
 * Get or create the awareness map for a list.
 * Tracks online presence of family members.
 */
export function getAwarenessMap(listId: string): Y.Map<any> {
  const doc = getDoc(listId);
  return doc.getMap('awareness');
}

// ─── Hydrate Yjs from application state ─────────────────────────────────────

/**
 * Hydrate a Yjs document from a GroceryList and its items.
 * Called on app start after loading from WatermelonDB.
 */
export function hydrateList(
  listId: string,
  list: GroceryList,
  items: GroceryItem[],
): void {
  const doc = getDoc(listId);
  doc.transact(() => {
    const meta = doc.getMap('meta');
    meta.set('id', list.id);
    meta.set('familyId', list.familyId);
    meta.set('name', list.name);
    meta.set('description', list.description ?? '');
    meta.set('storePreference', list.storePreference ?? '');
    meta.set('isActive', list.isActive);
    meta.set('isDeleted', list.isDeleted);
    meta.set('deletedAt', list.deletedAt);
    meta.set('version', list.version);
    meta.set('syncStatus', list.syncStatus);
    meta.set('createdAt', list.createdAt);
    meta.set('updatedAt', list.updatedAt);

    const itemsArr = doc.getArray('items');
    const yItems = items.map((item) => {
      const yItem = new Y.Map();
      Object.entries(item).forEach(([key, value]) => {
        yItem.set(key, value as any);
      });
      return yItem;
    });
    // Replace all existing items
    itemsArr.delete(0, itemsArr.length);
    itemsArr.push(yItems);
  });
}

/**
 * Hydrate the family members document from application state.
 * Uses a dedicated "family" document key.
 */
export function hydrateFamilyMembers(members: FamilyMember[]): void {
  const doc = getDoc('__family__');
  doc.transact(() => {
    const membersMap = doc.getMap('members');
    membersMap.clear();
    members.forEach((member) => {
      const yMember = new Y.Map();
      Object.entries(member).forEach(([key, value]) => {
        yMember.set(key, value as any);
      });
      membersMap.set(member.id, yMember);
    });
  });
}

// ─── Extract application state from Yjs ─────────────────────────────────────

/**
 * Extract a GroceryList from a Yjs document.
 */
export function extractList(listId: string): GroceryList | null {
  const doc = docs.get(listId);
  if (!doc) return null;
  const meta = doc.getMap('meta');
  const id = meta.get('id') as string | undefined;
  if (!id) return null; // doc exists but not hydrated yet
  return {
    id: id as string,
    familyId: meta.get('familyId') as string,
    name: meta.get('name') as string,
    description: (meta.get('description') as string) || undefined,
    storePreference: (meta.get('storePreference') as string) || undefined,
    isActive: meta.get('isActive') as boolean,
    isDeleted: meta.get('isDeleted') as boolean,
    deletedAt: (meta.get('deletedAt') as number) ?? null,
    version: meta.get('version') as number,
    syncStatus: (meta.get('syncStatus') as any) ?? 'synced',
    createdAt: meta.get('createdAt') as number,
    updatedAt: meta.get('updatedAt') as number,
  };
}

/**
 * Extract items from a Yjs document as GroceryItem[].
 */
export function extractItems(listId: string): GroceryItem[] {
  const doc = docs.get(listId);
  if (!doc) return [];
  const itemsArr = doc.getArray('items');
  return itemsArr.map((yItem: unknown) => {
    const item: Record<string, any> = {};
    (yItem as Y.Map<any>).forEach((value: any, key: string) => {
      item[key] = value;
    });
    return item as unknown as GroceryItem;
  });
}

/**
 * Extract family members from the family document.
 */
export function extractFamilyMembers(): FamilyMember[] {
  const doc = docs.get('__family__');
  if (!doc) return [];
  const membersMap = doc.getMap('members');
  const members: FamilyMember[] = [];
  membersMap.forEach((yMember: unknown) => {
    const member: Record<string, any> = {};
    (yMember as Y.Map<any>).forEach((value: any, key: string) => {
      member[key] = value;
    });
    members.push(member as unknown as FamilyMember);
  });
  return members;
}

// ─── Mutations via Yjs ──────────────────────────────────────────────────────

/**
 * Add an item to a list using Yjs shared types.
 * The CRDT will merge this with concurrent edits from family members.
 */
export function yjsAddItem(
  listId: string,
  item: GroceryItem,
): void {
  const doc = getDoc(listId);
  doc.transact(() => {
    const itemsArr = doc.getArray('items');
    const yItem = new Y.Map();
    Object.entries(item).forEach(([key, value]) => {
      yItem.set(key, value as any);
    });
    itemsArr.push([yItem]);

    // Bump list metadata version
    const meta = doc.getMap('meta');
    meta.set('version', (meta.get('version') as number) + 1);
    meta.set('updatedAt', Date.now());
  });
}

/**
 * Update an item in a list via Yjs.
 */
export function yjsUpdateItem(
  listId: string,
  itemId: string,
  changes: Partial<GroceryItem>,
): void {
  const doc = getDoc(listId);
  doc.transact(() => {
    const itemsArr = doc.getArray('items');
    const { createdAt: _, id: _id, listId: _listId, familyId: _familyId, addedBy: _addedBy, ...safeChanges } = changes;

    for (let i = 0; i < itemsArr.length; i++) {
      const yItem = itemsArr.get(i) as Y.Map<any>;
      if (yItem.get('id') === itemId) {
        Object.entries(safeChanges).forEach(([key, value]) => {
          yItem.set(key, value as any);
        });
        yItem.set('version', (yItem.get('version') as number) + 1);
        yItem.set('updatedAt', Date.now());
        break;
      }
    }

    // Bump list metadata version
    const meta = doc.getMap('meta');
    meta.set('version', (meta.get('version') as number) + 1);
    meta.set('updatedAt', Date.now());
  });
}

/**
 * Batch-update multiple items in a single atomic Yjs transaction.
 * Prevents data integrity issues (e.g. duplicate sortOrder values) when
 * multiple items must be updated together.
 *
 * Each entry is { itemId, changes } — same changes format as yjsUpdateItem.
 * All updates and the metadata version bump happen inside one doc.transact().
 */
export function yjsBatchUpdate(
  listId: string,
  updates: Array<{ itemId: string; changes: Partial<GroceryItem> }>,
): void {
  if (updates.length === 0) return;
  const doc = getDoc(listId);
  doc.transact(() => {
    const itemsArr = doc.getArray('items');
    for (const { itemId, changes } of updates) {
      const { createdAt: _, id: _id, listId: _listId, familyId: _familyId, addedBy: _addedBy, ...safeChanges } = changes;
      for (let i = 0; i < itemsArr.length; i++) {
        const yItem = itemsArr.get(i) as Y.Map<any>;
        if (yItem.get('id') === itemId) {
          Object.entries(safeChanges).forEach(([key, value]) => {
            yItem.set(key, value as any);
          });
          yItem.set('version', (yItem.get('version') as number) + 1);
          yItem.set('updatedAt', Date.now());
          break;
        }
      }
    }
    // Bump list metadata once for the entire batch
    const meta = doc.getMap('meta');
    meta.set('version', (meta.get('version') as number) + 1);
    meta.set('updatedAt', Date.now());
  });
}

/**
 * Remove (soft-delete) an item via Yjs.
 */
export function yjsDeleteItem(listId: string, itemId: string): void {
  const doc = getDoc(listId);
  doc.transact(() => {
    const itemsArr = doc.getArray('items');
    for (let i = 0; i < itemsArr.length; i++) {
      const yItem = itemsArr.get(i) as Y.Map<any>;
      if (yItem.get('id') === itemId) {
        yItem.set('isDeleted', true);
        yItem.set('deletedAt', Date.now());
        yItem.set('syncStatus', 'deleted');
        yItem.set('version', (yItem.get('version') as number) + 1);
        yItem.set('updatedAt', Date.now());
        break;
      }
    }

    const meta = doc.getMap('meta');
    meta.set('version', (meta.get('version') as number) + 1);
    meta.set('updatedAt', Date.now());
  });
}

/**
 * Auto-release threshold: an item claimed for longer than this is unclaimed
 * (prevents stale locks when someone claims and never unclaims).
 */
export const CLAIM_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Claim an item (lock it for shopping).
 * Sets claimedBy and claimedAt on the item's Y.Map.
 * If already claimed by another device, does nothing and returns false.
 */
export function yjsClaimItem(
  listId: string,
  itemId: string,
  deviceId: string,
): boolean {
  const doc = getDoc(listId);
  let didClaim = false;
  doc.transact(() => {
    const itemsArr = doc.getArray('items');
    for (let i = 0; i < itemsArr.length; i++) {
      const yItem = itemsArr.get(i) as Y.Map<any>;
      if (yItem.get('id') === itemId) {
        const existingClaim = yItem.get('claimedBy') as string | undefined;
        const claimedAt = yItem.get('claimedAt') as number | undefined;
        // Allow re-claim if existing claim has expired
        const isExpired = claimedAt
          ? Date.now() - claimedAt >= CLAIM_EXPIRY_MS
          : false;
        if (existingClaim && existingClaim !== deviceId && !isExpired) {
          return; // Already claimed by someone else, no-op
        }
        yItem.set('claimedBy', deviceId);
        yItem.set('claimedAt', Date.now());
        yItem.set('version', (yItem.get('version') as number) + 1);
        yItem.set('updatedAt', Date.now());
        didClaim = true;
        break;
      }
    }
  });

  if (didClaim) {
    const meta = doc.getMap('meta');
    doc.transact(() => {
      meta.set('version', (meta.get('version') as number) + 1);
      meta.set('updatedAt', Date.now());
    });
  }
  return didClaim;
}

/**
 * Unclaim an item (release the lock).
 * Only the claiming device or an admin can unclaim.
 * Returns true if the item was actually unclaimed, false if guarded or not found.
 */
export function yjsUnclaimItem(
  listId: string,
  itemId: string,
  deviceId?: string,
): boolean {
  const doc = getDoc(listId);
  let didUnclaim = false;
  doc.transact(() => {
    const itemsArr = doc.getArray('items');
    for (let i = 0; i < itemsArr.length; i++) {
      const yItem = itemsArr.get(i) as Y.Map<any>;
      if (yItem.get('id') === itemId) {
        const claimedBy = yItem.get('claimedBy') as string | undefined;
        // If deviceId provided, only allow unclaim by the claimer
        if (deviceId && claimedBy && claimedBy !== deviceId) {
          return; // Not the claimer, no-op
        }
        yItem.delete('claimedBy');
        yItem.delete('claimedAt');
        yItem.set('version', (yItem.get('version') as number) + 1);
        yItem.set('updatedAt', Date.now());
        didUnclaim = true;
        break;
      }
    }
  });
  return didUnclaim;
}

/**
 * Release every claim on the list that is older than CLAIM_EXPIRY_MS.
 * Safe to call from any device on a periodic tick: the operation is
 * idempotent and CRDT-converges even if several devices sweep at once.
 * Returns the number of claims released.
 */
export function yjsSweepExpiredClaims(listId: string): number {
  const doc = getDoc(listId);
  const now = Date.now();
  let released = 0;
  doc.transact(() => {
    const itemsArr = doc.getArray('items');
    for (let i = 0; i < itemsArr.length; i++) {
      const yItem = itemsArr.get(i) as Y.Map<any>;
      const claimedAt = yItem.get('claimedAt') as number | undefined;
      if (claimedAt !== undefined && now - claimedAt >= CLAIM_EXPIRY_MS) {
        yItem.delete('claimedBy');
        yItem.delete('claimedAt');
        yItem.set('version', (yItem.get('version') as number) + 1);
        yItem.set('updatedAt', now);
        released++;
      }
    }
    if (released > 0) {
      const meta = doc.getMap('meta');
      meta.set('version', (meta.get('version') as number) + 1);
      meta.set('updatedAt', now);
    }
  });
  return released;
}

/**
 * Update list metadata via Yjs.
 */
export function yjsUpdateListMeta(
  listId: string,
  changes: Partial<GroceryList>,
): void {
  const doc = getDoc(listId);
  doc.transact(() => {
    const meta = doc.getMap('meta');
    const { createdAt: _, ...safeChanges } = changes;
    Object.entries(safeChanges).forEach(([key, value]) => {
      // Convert camelCase keys to match Yjs meta keys
      meta.set(key, value as any);
    });
    meta.set('version', (meta.get('version') as number) + 1);
    meta.set('updatedAt', Date.now());
  });
}

// ─── Awareness / Presence ───────────────────────────────────────────────────

/**
 * Set the awareness state for the current user on a list.
 */
export function setAwareness(
  listId: string,
  memberId: string,
  state: { online: boolean; atStore?: boolean; lastSeen: number },
): void {
  const doc = getDoc(listId);
  doc.transact(() => {
    const awareness = doc.getMap('awareness');
    awareness.set(memberId, state);
  });
}

/**
 * Get all awareness states for a list.
 */
export function getAwareness(
  listId: string,
): Record<string, { online: boolean; atStore?: boolean; lastSeen: number }> {
  const doc = docs.get(listId);
  if (!doc) return {};
  const awareness = doc.getMap('awareness');
  const result: Record<string, any> = {};
  awareness.forEach((value: any, key: string) => {
    result[key] = value;
  });
  return result;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Destroy a Yjs document (e.g. when a list is permanently deleted).
 */
export function destroyDoc(listId: string): void {
  const doc = docs.get(listId);
  if (doc) {
    doc.destroy();
    docs.delete(listId);
  }
}

/**
 * Get all active document keys.
 */
export function getActiveDocIds(): string[] {
  return Array.from(docs.keys());
}

/**
 * Destroy every Yjs document (data-wipe path). After this, any getDoc()
 * call starts from a fresh, empty document.
 */
export function destroyAllDocs(): void {
  for (const doc of docs.values()) {
    doc.destroy();
  }
  docs.clear();
}