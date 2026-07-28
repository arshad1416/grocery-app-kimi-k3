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
 */

import { Model } from '@nozbe/watermelondb';
import { field, readonly, relation, date } from '@nozbe/watermelondb/decorators';

// ─── GroceryList Model ──────────────────────────────────────────────────────

export class GroceryListModel extends Model {
  static table = 'grocery_lists' as const;

  static associations = {
    grocery_items: { type: 'has_many' as const, foreignKey: 'list_id' },
  } as const;

  @field('family_id') familyId: string;
  @field('name') name: string;                         // encrypted
  @field('description') description: string | null;     // encrypted
  @field('store_preference') storePreference: string | null; // encrypted
  @field('is_active') isActive: boolean;
  @field('is_deleted') isDeleted: boolean;
  @field('deleted_at') deletedAt: number | null;
  @field('version') version: number;
  @field('sync_status') recordSyncStatus: string;
  @field('created_at') createdAt: number;
  @field('updated_at') updatedAt: number;
}

// ─── GroceryItem Model ──────────────────────────────────────────────────────

export class GroceryItemModel extends Model {
  static table = 'grocery_items' as const;

  static associations = {
    grocery_lists: { type: 'belongs_to' as const, key: 'list_id' },
  } as const;

  @field('list_id') listId: string;
  @field('family_id') familyId: string;
  @field('name') name: string;                         // encrypted
  @field('quantity') quantity: number;
  @field('unit') unit: string;                         // encrypted
  @field('category') category: string;
  @field('is_checked') isChecked: boolean;
  @field('added_by') addedBy: string;
  @field('assigned_to') assignedTo: string | null;
  @field('notes') notes: string | null;                // encrypted
  @field('image_url') imageUrl: string | null;
  @field('sort_order') sortOrder: number;
  @field('is_deleted') isDeleted: boolean;
  @field('deleted_at') deletedAt: number | null;
  @field('version') version: number;
  @field('sync_status') recordSyncStatus: string;
  @field('created_at') createdAt: number;
  @field('updated_at') updatedAt: number;

  @relation('grocery_lists', 'list_id') list: GroceryListModel;
}

// ─── FamilyMember Model ─────────────────────────────────────────────────────

export class FamilyMemberModel extends Model {
  static table = 'family_members' as const;

  @field('family_id') familyId: string;
  @field('display_name') displayName: string;           // encrypted
  @field('avatar_url') avatarUrl: string | null;
  // 'role' column still exists in the schema (kept to avoid a migration) but is
  // intentionally unmapped: roles were never enforced and are dropped in v1.
  @field('is_active') isActive: boolean;
  @field('is_deleted') isDeleted: boolean;
  @field('deleted_at') deletedAt: number | null;
  @field('version') version: number;
  @field('sync_status') recordSyncStatus: string;
  @field('joined_at') joinedAt: number;
  @field('updated_at') updatedAt: number;
}

// ─── Notification Model ────────────────────────────────────────────────────

export class NotificationModel extends Model {
  static table = 'notifications' as const;

  @field('event_type') eventType: string;
  @field('timestamp') timestamp: number;
  @field('sender_device_id') senderDeviceId: string;
  @field('list_id') listId: string;
  @field('list_name') listName: string;
  @field('item_id') itemId: string;
  @field('item_name') itemName: string;
  @field('item_category') itemCategory: string;
  @field('is_read') isRead: boolean;
}

// ─── Offline Queue Model ────────────────────────────────────────────────────

export class OfflineQueueModel extends Model {
  static table = 'offline_queue' as const;

  @field('list_id') listId: string;
  @field('payload') payload: string;                    // encrypted (EncryptedData JSON)
  @field('created_at') createdAt: number;
}
