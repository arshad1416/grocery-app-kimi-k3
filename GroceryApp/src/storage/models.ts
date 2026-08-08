/**
 * WatermelonDB model definitions for grocery list app.
 *
 * These are ORM record classes that map to the schema tables.
 * The base Model class provides `id`, `syncStatus` (built-in WatermelonDB sync),
 * `collection`, and `database` automatically.
 *
 * Note: the base `syncStatus` is a read-only accessor owned by WatermelonDB.
 * Our own per-record sync state lives in the `sync_status` column and is
 * mapped to `recordSyncStatus` so the two never collide — assigning to the
 * built-in throws a TypeError under strict mode.
 *
 * Encrypted fields (name, notes, displayName, description, etc.) are stored
 * as base64 ciphertext strings in the database and decrypted at the
 * application layer.
 *
 * IMPORTANT — why this file does NOT use @decorator syntax:
 * Metro's Hermes transform profile (`transform.engine=hermes`,
 * `unstable_transformProfile=hermes-stable`, used by every dev build on
 * device) preserves native class syntax and class fields. In that profile,
 * legacy-decorated class fields compile to `_initializerWarningHelper(...)`
 * assignments that throw "Decorating class property failed. Please ensure
 * that transform-class-properties is enabled and runs after the decorators
 * transform." EVERY model instantiation threw on-device, so every
 * WatermelonDB write silently failed while reads of empty tables appeared
 * to work. Jest never caught it because @nozbe/watermelondb is mocked with
 * decorator no-ops. Babel-level fixes (loose class-properties) cannot be
 * scoped correctly under Metro: `overrides.test` crashes Metro's config
 * loader, `.babelrc` is ignored for the Hermes-profile transform cache key,
 * and global loose class-properties breaks Flow declaration-only statics in
 * react-native's own Event.js/DOMException.js. Applying the decorators
 * imperatively below is profile-proof: it emits plain Object.defineProperty
 * calls with the exact descriptors the decorator machinery would install.
 */

import { Model } from '@nozbe/watermelondb';
import { field, relation } from '@nozbe/watermelondb/decorators';

// ─── Imperative decorator application ────────────────────────────────────────

type DecoratorFactory = (
  target: object,
  key: string,
  descriptor: undefined,
) => PropertyDescriptor;

/**
 * Apply a WatermelonDB decorator to a model prototype imperatively.
 * Equivalent to `@decorator` on the class field, but with no decorator
 * syntax for Babel to miscompile (see file header).
 */
function defineModelProp(
  prototype: object,
  key: string,
  decorator: DecoratorFactory,
): void {
  Object.defineProperty(prototype, key, decorator(prototype, key, undefined));
}

const fieldProp = (proto: object, key: string, column: string): void =>
  defineModelProp(proto, key, field(column) as unknown as DecoratorFactory);

const relationProp = (proto: object, key: string, table: string, column: string): void =>
  defineModelProp(proto, key, relation(table, column) as unknown as DecoratorFactory);

// ─── GroceryList Model ──────────────────────────────────────────────────────

export class GroceryListModel extends Model {
  static table = 'grocery_lists' as const;

  static associations = {
    grocery_items: { type: 'has_many' as const, foreignKey: 'list_id' },
  } as const;
}

// Declaration merging: types the decorated instance fields without emitting
// class fields (an emitted field would shadow the prototype accessor).
export interface GroceryListModel {
  familyId: string;
  name: string;                              // encrypted
  description: string | null;                // encrypted
  storePreference: string | null;            // encrypted
  isActive: boolean;
  isDeleted: boolean;
  deletedAt: number | null;
  version: number;
  recordSyncStatus: string;
  createdAt: number;
  updatedAt: number;
}

fieldProp(GroceryListModel.prototype, 'familyId', 'family_id');
fieldProp(GroceryListModel.prototype, 'name', 'name');
fieldProp(GroceryListModel.prototype, 'description', 'description');
fieldProp(GroceryListModel.prototype, 'storePreference', 'store_preference');
fieldProp(GroceryListModel.prototype, 'isActive', 'is_active');
fieldProp(GroceryListModel.prototype, 'isDeleted', 'is_deleted');
fieldProp(GroceryListModel.prototype, 'deletedAt', 'deleted_at');
fieldProp(GroceryListModel.prototype, 'version', 'version');
fieldProp(GroceryListModel.prototype, 'recordSyncStatus', 'sync_status');
fieldProp(GroceryListModel.prototype, 'createdAt', 'created_at');
fieldProp(GroceryListModel.prototype, 'updatedAt', 'updated_at');

// ─── GroceryItem Model ──────────────────────────────────────────────────────

export class GroceryItemModel extends Model {
  static table = 'grocery_items' as const;

  static associations = {
    grocery_lists: { type: 'belongs_to' as const, key: 'list_id' },
  } as const;
}

export interface GroceryItemModel {
  listId: string;
  familyId: string;
  name: string;                              // encrypted
  quantity: number;
  unit: string;                              // encrypted
  category: string;
  isChecked: boolean;
  addedBy: string;
  assignedTo: string | null;
  notes: string | null;                      // encrypted
  imageUrl: string | null;
  sortOrder: number;
  isDeleted: boolean;
  deletedAt: number | null;
  version: number;
  recordSyncStatus: string;
  createdAt: number;
  updatedAt: number;
  list: GroceryListModel;
}

fieldProp(GroceryItemModel.prototype, 'listId', 'list_id');
fieldProp(GroceryItemModel.prototype, 'familyId', 'family_id');
fieldProp(GroceryItemModel.prototype, 'name', 'name');
fieldProp(GroceryItemModel.prototype, 'quantity', 'quantity');
fieldProp(GroceryItemModel.prototype, 'unit', 'unit');
fieldProp(GroceryItemModel.prototype, 'category', 'category');
fieldProp(GroceryItemModel.prototype, 'isChecked', 'is_checked');
fieldProp(GroceryItemModel.prototype, 'addedBy', 'added_by');
fieldProp(GroceryItemModel.prototype, 'assignedTo', 'assigned_to');
fieldProp(GroceryItemModel.prototype, 'notes', 'notes');
fieldProp(GroceryItemModel.prototype, 'imageUrl', 'image_url');
fieldProp(GroceryItemModel.prototype, 'sortOrder', 'sort_order');
fieldProp(GroceryItemModel.prototype, 'isDeleted', 'is_deleted');
fieldProp(GroceryItemModel.prototype, 'deletedAt', 'deleted_at');
fieldProp(GroceryItemModel.prototype, 'version', 'version');
fieldProp(GroceryItemModel.prototype, 'recordSyncStatus', 'sync_status');
fieldProp(GroceryItemModel.prototype, 'createdAt', 'created_at');
fieldProp(GroceryItemModel.prototype, 'updatedAt', 'updated_at');
relationProp(GroceryItemModel.prototype, 'list', 'grocery_lists', 'list_id');

// ─── FamilyMember Model ─────────────────────────────────────────────────────

export class FamilyMemberModel extends Model {
  static table = 'family_members' as const;
}

export interface FamilyMemberModel {
  familyId: string;
  displayName: string;                       // encrypted
  avatarUrl: string | null;
  // 'role' column still exists in the schema (kept to avoid a migration) but is
  // intentionally unmapped: roles were never enforced and are dropped in v1.
  isActive: boolean;
  isDeleted: boolean;
  deletedAt: number | null;
  version: number;
  recordSyncStatus: string;
  joinedAt: number;
  updatedAt: number;
}

fieldProp(FamilyMemberModel.prototype, 'familyId', 'family_id');
fieldProp(FamilyMemberModel.prototype, 'displayName', 'display_name');
fieldProp(FamilyMemberModel.prototype, 'avatarUrl', 'avatar_url');
fieldProp(FamilyMemberModel.prototype, 'isActive', 'is_active');
fieldProp(FamilyMemberModel.prototype, 'isDeleted', 'is_deleted');
fieldProp(FamilyMemberModel.prototype, 'deletedAt', 'deleted_at');
fieldProp(FamilyMemberModel.prototype, 'version', 'version');
fieldProp(FamilyMemberModel.prototype, 'recordSyncStatus', 'sync_status');
fieldProp(FamilyMemberModel.prototype, 'joinedAt', 'joined_at');
fieldProp(FamilyMemberModel.prototype, 'updatedAt', 'updated_at');

// ─── Notification Model ────────────────────────────────────────────────────

export class NotificationModel extends Model {
  static table = 'notifications' as const;
}

export interface NotificationModel {
  eventType: string;
  timestamp: number;
  senderDeviceId: string;
  listId: string;
  listName: string;
  itemId: string;
  itemName: string;
  itemCategory: string;
  isRead: boolean;
}

fieldProp(NotificationModel.prototype, 'eventType', 'event_type');
fieldProp(NotificationModel.prototype, 'timestamp', 'timestamp');
fieldProp(NotificationModel.prototype, 'senderDeviceId', 'sender_device_id');
fieldProp(NotificationModel.prototype, 'listId', 'list_id');
fieldProp(NotificationModel.prototype, 'listName', 'list_name');
fieldProp(NotificationModel.prototype, 'itemId', 'item_id');
fieldProp(NotificationModel.prototype, 'itemName', 'item_name');
fieldProp(NotificationModel.prototype, 'itemCategory', 'item_category');
fieldProp(NotificationModel.prototype, 'isRead', 'is_read');

// ─── Offline Queue Model ────────────────────────────────────────────────────

export class OfflineQueueModel extends Model {
  static table = 'offline_queue' as const;
}

export interface OfflineQueueModel {
  listId: string;
  payload: string;                           // encrypted (EncryptedData JSON)
  createdAt: number;
}

fieldProp(OfflineQueueModel.prototype, 'listId', 'list_id');
fieldProp(OfflineQueueModel.prototype, 'payload', 'payload');
fieldProp(OfflineQueueModel.prototype, 'createdAt', 'created_at');

// ─── Entitlement Model ────────────────────────────────────────────────
// Local backing record for PantryRun Plus. Read/written ONLY by
// src/config/entitlements.ts — the single module that computes entitlement
// state (see that file's header for the invariant).

export class EntitlementModel extends Model {
  static table = 'entitlements' as const;
}

export interface EntitlementModel {
  familyId: string;
  productId: string;
  platform: string;                          // 'ios' | 'android'
  transactionId: string;
  purchasedAt: number;
  expiresAt: number | null;
  source: string;                            // 'purchase' | 'restore' | 'sync'
  updatedAt: number;
}

fieldProp(EntitlementModel.prototype, 'familyId', 'family_id');
fieldProp(EntitlementModel.prototype, 'productId', 'product_id');
fieldProp(EntitlementModel.prototype, 'platform', 'platform');
fieldProp(EntitlementModel.prototype, 'transactionId', 'transaction_id');
fieldProp(EntitlementModel.prototype, 'purchasedAt', 'purchased_at');
fieldProp(EntitlementModel.prototype, 'expiresAt', 'expires_at');
fieldProp(EntitlementModel.prototype, 'source', 'source');
fieldProp(EntitlementModel.prototype, 'updatedAt', 'updated_at');

