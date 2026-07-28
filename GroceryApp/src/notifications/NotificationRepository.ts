/**
 * NotificationRepository — WatermelonDB CRUD for notification records.
 *
 * Persists incoming notifications for badge count management and history.
 * Uses the 'notifications' table added in schema v4.
 */

import { Q } from '@nozbe/watermelondb';
import { getDatabase } from '../storage/database';
import type { NotificationRecord } from '../types/notifications';

/**
 * Save a notification record to WatermelonDB.
 */
export async function saveNotification(record: NotificationRecord): Promise<void> {
  const database = getDatabase();
  await database.write(async () => {
    await database.get('notifications').create((n: any) => {
      n._raw.id = record.id;
      n.eventType = record.eventType;
      n.timestamp = record.timestamp;
      n.senderDeviceId = record.senderDeviceId;
      n.listId = record.listId;
      n.listName = record.listName;
      n.itemId = record.itemId;
      n.itemName = record.itemName;
      n.itemCategory = record.itemCategory;
      n.isRead = false;
    });
  });
}

/**
 * Get count of unread notifications.
 */
export async function getUnreadCount(): Promise<number> {
  const database = getDatabase();
  const collection = database.get('notifications');
  const unread = await collection.query(Q.where('is_read', false)).fetch();
  return unread.length;
}

/**
 * Mark all notifications as read.
 */
export async function markAllAsRead(): Promise<void> {
  const database = getDatabase();
  const collection = database.get('notifications');
  const unread = await collection.query(Q.where('is_read', false)).fetch();
  await database.write(async () => {
    for (const n of unread) {
      await n.update((record: any) => {
        record.isRead = true;
      });
    }
  });
}

/**
 * Get recent notifications sorted by timestamp descending.
 */
export async function getRecentNotifications(limit = 50): Promise<NotificationRecord[]> {
  const database = getDatabase();
  const collection = database.get('notifications');
  const records = await collection.query(
    Q.sortBy('timestamp', Q.desc),
    Q.take(limit),
  ).fetch();
  return records.map((r: any) => ({
    id: r.id,
    eventType: r.eventType,
    timestamp: r.timestamp,
    senderDeviceId: r.senderDeviceId,
    listId: r.listId,
    listName: r.listName,
    itemId: r.itemId,
    itemName: r.itemName,
    itemCategory: r.itemCategory,
    isRead: r.isRead,
  }));
}

/**
 * Prune old notifications (keep last 200).
 */
export async function pruneOldNotifications(): Promise<void> {
  const database = getDatabase();
  const collection = database.get('notifications');
  const all = await collection.query(Q.sortBy('timestamp', Q.desc)).fetch();
  if (all.length > 200) {
    const toDelete = all.slice(200);
    await database.write(async () => {
      for (const n of toDelete) {
        await n.destroyPermanently();
      }
    });
  }
}
