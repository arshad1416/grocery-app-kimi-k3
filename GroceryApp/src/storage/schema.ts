/**
 * WatermelonDB schema for encrypted offline-first storage.
 *
 * Design decisions:
 *  - Sensitive fields (name, notes, displayName) stored as ciphertext (base64 string)
 *  - Non-sensitive fields (ids, booleans, timestamps) stored in plaintext for querying
 *  - Soft-delete via isDeleted + deletedAt (standardized across all tables)
 *  - Version field for conflict resolution during sync
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 5,
  tables: [
    // ─── Grocery Lists ────────────────────────────────────────────────────
    tableSchema({
      name: 'grocery_lists',
      columns: [
        { name: 'family_id', type: 'string' },
        { name: 'name', type: 'string' },             // encrypted
        { name: 'description', type: 'string', isOptional: true },  // encrypted
        { name: 'store_preference', type: 'string', isOptional: true }, // encrypted
        { name: 'is_active', type: 'boolean' },
        { name: 'is_deleted', type: 'boolean' },
        { name: 'deleted_at', type: 'number', isOptional: true },
        { name: 'version', type: 'number' },
        { name: 'sync_status', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // ─── Grocery Items ────────────────────────────────────────────────────
    tableSchema({
      name: 'grocery_items',
      columns: [
        { name: 'list_id', type: 'string' },
        { name: 'family_id', type: 'string' },
        { name: 'name', type: 'string' },             // encrypted
        { name: 'quantity', type: 'number' },
        { name: 'unit', type: 'string' },             // encrypted
        { name: 'category', type: 'string' },
        { name: 'is_checked', type: 'boolean' },
        { name: 'added_by', type: 'string' },
        { name: 'assigned_to', type: 'string', isOptional: true },
        { name: 'notes', type: 'string', isOptional: true },   // encrypted
        { name: 'image_url', type: 'string', isOptional: true },
        { name: 'sort_order', type: 'number' },
        { name: 'is_deleted', type: 'boolean' },
        { name: 'deleted_at', type: 'number', isOptional: true },
        { name: 'version', type: 'number' },
        { name: 'sync_status', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // ─── Family Members ───────────────────────────────────────────────────
    tableSchema({
      name: 'family_members',
      columns: [
        { name: 'family_id', type: 'string' },
        { name: 'display_name', type: 'string' },       // encrypted
        { name: 'avatar_url', type: 'string', isOptional: true },
        { name: 'role', type: 'string' },              // legacy, unused in v1 (kept to avoid migration)
        { name: 'is_active', type: 'boolean' },
        { name: 'is_deleted', type: 'boolean' },
        { name: 'deleted_at', type: 'number', isOptional: true },
        { name: 'version', type: 'number' },
        { name: 'sync_status', type: 'string' },
        { name: 'joined_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // ─── Notifications ──────────────────────────────────────────────────
    tableSchema({
      name: 'notifications',
      columns: [
        { name: 'event_type', type: 'string' },
        { name: 'timestamp', type: 'number' },
        { name: 'sender_device_id', type: 'string' },
        { name: 'list_id', type: 'string' },
        { name: 'list_name', type: 'string' },
        { name: 'item_id', type: 'string' },
        { name: 'item_name', type: 'string' },
        { name: 'item_category', type: 'string' },
        { name: 'is_read', type: 'boolean' },
      ],
    }),

    // ─── Offline Sync Queue ──────────────────────────────────────────────
    // Yjs updates queued while offline, so a killed app doesn't lose edits
    // that were never delivered to the relay. `payload` is the encrypted
    // wire envelope (JSON EncryptedData) — never a plaintext Yjs update.
    tableSchema({
      name: 'offline_queue',
      columns: [
        { name: 'list_id', type: 'string' },
        { name: 'payload', type: 'string' },            // encrypted (EncryptedData JSON)
        { name: 'created_at', type: 'number' },
      ],
    }),
  ],
});

export type TableName = 'grocery_lists' | 'grocery_items' | 'family_members' | 'notifications' | 'offline_queue';