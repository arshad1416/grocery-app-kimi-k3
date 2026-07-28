/**
 * WatermelonDB migrations for schema version upgrades.
 *
 * Migration path:
 *   v1 → v2: Add `family_id` column to `grocery_items` table.
 *            Add `is_deleted` + `deleted_at` to `grocery_lists` and `family_members`.
 */

import { schemaMigrations, addColumns, createTable } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({
  migrations: [
    // v1 → v2: Add family_id to grocery_items, soft-delete columns to lists and members
    {
      toVersion: 2,
      steps: [
        addColumns({
          table: 'grocery_items',
          columns: [
            { name: 'family_id', type: 'string' },
          ],
        }),
        addColumns({
          table: 'grocery_lists',
          columns: [
            { name: 'is_deleted', type: 'boolean' },
            { name: 'deleted_at', type: 'number', isOptional: true },
          ],
        }),
        addColumns({
          table: 'family_members',
          columns: [
            { name: 'is_deleted', type: 'boolean' },
            { name: 'deleted_at', type: 'number', isOptional: true },
          ],
        }),
      ],
    },
    // v2 → v3: Add image_url to grocery_items for product images
    {
      toVersion: 3,
      steps: [
        addColumns({
          table: 'grocery_items',
          columns: [
            { name: 'image_url', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    // v3 → v4: Add notifications table for family notification system
    {
      toVersion: 4,
      steps: [
        createTable({
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
      ],
    },
    // v4 → v5: Add offline_queue table so undelivered Yjs updates survive app kill
    {
      toVersion: 5,
      steps: [
        createTable({
          name: 'offline_queue',
          columns: [
            { name: 'list_id', type: 'string' },
            { name: 'payload', type: 'string' },
            { name: 'created_at', type: 'number' },
          ],
        }),
      ],
    },
  ],
});