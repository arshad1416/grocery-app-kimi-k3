# StopHop Family Notification System — Architecture Design

**Date:** 2026-06-15
**Status:** Draft
**Scope:** Family push notifications for shared grocery list events (item added, item checked off)

---

## 1. Overview

When a family member adds or checks off a grocery item, all other paired family members receive a notification — visible in the Android notification drawer / iOS notification center, with an app icon badge counter showing unread notifications.

The design layers on top of the existing Yjs CRDT + WebSocket relay architecture without breaking the zero-knowledge encryption model.

### Design Principles

1. **Self-hosted first** — notifications work entirely through the existing relay server when the app is foregrounded. No cloud dependency required for core functionality.
2. **FCM optional, additive** — Firebase Cloud Messaging can be added later for background/killed-app delivery. The architecture is designed so FCM slots in as a transport, not a replacement.
3. **End-to-end encryption preserved** — notification payloads are encrypted the same way Yjs updates are (XChaCha20-Poly1305 with the shared family key). The relay server never sees plaintext item names.
4. **Minimal relay server changes** — notifications piggyback on existing WebSocket infrastructure. The relay simply routes a new message type.
5. **Offline-tolerant** — if a device is offline, notifications are queued on the relay and delivered on reconnect. Badge counts persist across app restarts.

---

## 2. Data Model Changes

### 2.1 New TypeScript Types

```typescript
// src/types/notifications.ts

/** Notification event types the system can emit */
export type NotificationEventType =
  | 'item_added'
  | 'item_checked'
  | 'item_unchecked'
  | 'item_deleted';

/** The notification payload — encrypted end-to-end before sending over the wire */
export interface NotificationPayload {
  /** Unique notification ID (UUID) */
  id: string;
  /** Event type */
  eventType: NotificationEventType;
  /** Timestamp (ms since epoch) */
  timestamp: number;
  /** Device ID of the sender (who performed the action) */
  senderDeviceId: string;
  /** List ID the item belongs to */
  listId: string;
  /** List name (encrypted — decrypted on receipt for display) */
  listName: string;
  /** Item ID */
  itemId: string;
  /** Item name (encrypted — decrypted on receipt for display) */
  itemName: string;
  /** Item category (for grouping/display) */
  itemCategory: string;
}

/** A stored notification record (persisted locally for badge count + history) */
export interface NotificationRecord {
  id: string;
  eventType: NotificationEventType;
  timestamp: number;
  senderDeviceId: string;
  listId: string;
  listName: string;
  itemId: string;
  itemName: string;
  itemCategory: string;
  /** Whether the user has seen/dismissed this notification */
  isRead: boolean;
}
```

### 2.2 WatermelonDB Schema Addition (v3 → v4 migration)

Add a `notifications` table to `src/storage/schema.ts`:

```typescript
tableSchema({
  name: 'notifications',
  columns: [
    { name: 'event_type', type: 'string' },          // 'item_added' | 'item_checked' | ...
    { name: 'timestamp', type: 'number' },
    { name: 'sender_device_id', type: 'string' },
    { name: 'list_id', type: 'string' },
    { name: 'list_name', type: 'string' },            // encrypted
    { name: 'item_id', type: 'string' },
    { name: 'item_name', type: 'string' },            // encrypted
    { name: 'item_category', type: 'string' },
    { name: 'is_read', type: 'boolean' },
  ],
})
```

**Migration:** Increment schema version to 4. The migration adds the `notifications` table with no data transformation on existing tables.

### 2.3 WatermelonDB Model

```typescript
// src/storage/models.ts — add NotificationModel

export class NotificationModel extends Model {
  static table = 'notifications' as const;

  @field('event_type') eventType: string;
  @field('timestamp') timestamp: number;
  @field('sender_device_id') senderDeviceId: string;
  @field('list_id') listId: string;
  @field('list_name') listName: string;        // encrypted
  @field('item_id') itemId: string;
  @field('item_name') itemName: string;        // encrypted
  @field('item_category') itemCategory: string;
  @field('is_read') isRead: boolean;
}
```

---

## 3. Relay Server Changes

### 3.1 New WebSocket Message Type: `notification`

The relay server already handles `auth`, `identity`, `update`, `ack`, `error` message types. We add a `notification` type that works identically to `update` — it's routed to all other clients in the same family room, except the sender.

**Relay message format (sent by client):**

```json
{
  "type": "notification",
  "familyId": "<family-id>",
  "deviceId": "<sender-device-id>",
  "listId": "<list-id>",
  "payload": {
    "ciphertext": "<base64>",
    "iv": "<base64>",
    "tag": "<base64>"
  }
}
```

The `payload` field is an `EncryptedData` object — the encrypted `NotificationPayload` (same XChaCha20-Poly1305 encryption as Yjs updates, using `listId` as AAD).

**Relay message received by other clients:**

```json
{
  "type": "notification",
  "familyId": "<family-id>",
  "deviceId": "<sender-device-id>",
  "listId": "<list-id>",
  "payload": { "ciphertext": "...", "iv": "...", "tag": "..." }
}
```

### 3.2 Server Implementation (server.js)

Add to `handleMessage()` switch statement:

```javascript
case 'notification': {
  // Same auth + rate-limit checks as 'update'
  if (!sender._relayToken) {
    sendTo(sender, { type: 'error', message: 'Not authenticated' });
    return;
  }
  if (!checkRateLimit(sender._relayToken)) {
    sendTo(sender, { type: 'error', message: 'Rate limit exceeded' });
    return;
  }

  const { familyId, deviceId, listId, payload } = message;
  if (!familyId || !listId || !payload) {
    sendTo(sender, { type: 'error', message: 'notification requires familyId, listId, and payload' });
    return;
  }

  const senderInfo = clientInfo.get(sender);
  if (!senderInfo || senderInfo.familyId !== familyId) {
    sendTo(sender, { type: 'error', message: 'Not authenticated for this family room' });
    return;
  }

  // Relay to all OTHER clients in the same family room
  const room = familyRooms.get(familyId);
  if (room) {
    let relayed = 0;
    room.forEach((client) => {
      if (client !== sender && client.readyState === client.OPEN) {
        sendTo(client, {
          type: 'notification',
          familyId,
          deviceId,
          listId,
          payload,
        });
        relayed++;
      }
    });
    console.log(`[notify] Device "${deviceId.slice(0, 12)}..." → family "${familyId}" list "${listId}" → ${relayed} peers`);
  }

  sendTo(sender, { type: 'ack', message: 'Notification relayed' });
  break;
}
```

**Key point:** The server is stateless for notifications — it does NOT store/queue notifications. If a device is offline, it misses the notification in real-time. This is acceptable because:
- Yjs CRDT sync already handles offline reconciliation (the actual data change is synced)
- Badge count is reconstructed from local state on app launch
- Optional FCM (Phase 2) handles background delivery

### 3.3 Why No Server-Side Notification Queue

The relay server is intentionally kept simple (no database, no persistence beyond enrollment state). Adding a notification queue would require:
- Per-device message queue with TTL
- Read/unread tracking on the server
- Queue pruning logic

This contradicts the zero-knowledge, minimal-server philosophy. Instead:
- **Foreground delivery:** Direct WebSocket relay (instant)
- **Background delivery (future):** FCM push notification sent alongside the WebSocket relay
- **Offline reconciliation:** Yjs CRDT handles the actual data; badge count is rebuilt from local DB on next launch

---

## 4. Client-Side Changes

### 4.1 New File: `src/notifications/NotificationManager.ts`

Central coordinator for notification sending, receiving, and badge management.

```typescript
// src/notifications/NotificationManager.ts

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { encrypt, decrypt } from '../crypto';
import { getDeviceId } from '../identity/device';
import { syncManager } from '../sync/sync-manager';
import type { NotificationPayload, NotificationRecord, NotificationEventType } from '../types/notifications';
import type { EncryptedData } from '../types';

// ─── Notification Channel (Android) ──────────────────────────────────────

const NOTIFICATION_CHANNEL_ID = 'stophop-family';

async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: 'Family Updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#10B981',
      sound: 'default',
    });
  }
}

// ─── Permissions ──────────────────────────────────────────────────────────

export async function requestNotificationPermissions(): Promise<boolean> {
  await ensureNotificationChannel();

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// ─── Badge Management ────────────────────────────────────────────────────

let unreadCount = 0;

/** Initialize badge count from persisted state (call on app start) */
export async function initBadgeCount(count: number): Promise<void> {
  unreadCount = count;
  await Notifications.setBadgeCountAsync(count);
}

/** Increment badge and persist */
export async function incrementBadge(): Promise<void> {
  unreadCount++;
  await Notifications.setBadgeCountAsync(unreadCount);
}

/** Clear badge (mark all as read) */
export async function clearBadge(): Promise<void> {
  unreadCount = 0;
  await Notifications.setBadgeCountAsync(0);
}

/** Get current unread count */
export function getUnreadCount(): number {
  return unreadCount;
}

// ─── Send Notification ───────────────────────────────────────────────────

/**
 * Send a family notification to all paired devices.
 * Called after a local item mutation (add, check, uncheck, delete).
 *
 * Does NOT show a local notification on the sender's device.
 */
export async function sendFamilyNotification(
  eventType: NotificationEventType,
  listId: string,
  listName: string,
  itemId: string,
  itemName: string,
  itemCategory: string,
  encryptionKey: Uint8Array,
): Promise<void> {
  const deviceId = getDeviceId();

  const payload: NotificationPayload = {
    id: generateNotificationId(),
    eventType,
    timestamp: Date.now(),
    senderDeviceId: deviceId,
    listId,
    listName,
    itemId,
    itemName,
    itemCategory,
  };

  // Encrypt the payload using the same scheme as Yjs updates
  const encrypted = encryptNotificationPayload(payload, listId, encryptionKey);

  // Send via the existing sync manager's WebSocket client
  syncManager.sendNotification(listId, encrypted);
}

// ─── Receive & Display Notification ──────────────────────────────────────

/**
 * Handle an incoming notification from the relay server.
 * Decrypt, persist locally, show system notification, increment badge.
 */
export async function handleIncomingNotification(
  listId: string,
  encryptedPayload: EncryptedData,
  encryptionKey: Uint8Array,
): Promise<NotificationRecord | null> {
  try {
    const payload = decryptNotificationPayload(encryptedPayload, listId, encryptionKey);

    // Don't show notification for our own actions
    if (payload.senderDeviceId === getDeviceId()) return null;

    // Build display text
    const { title, body } = buildNotificationText(payload);

    // Persist to local DB
    const record: NotificationRecord = {
      ...payload,
      isRead: false,
    };
    await persistNotification(record);

    // Show system notification (notification drawer / notification center)
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          notificationId: payload.id,
          listId: payload.listId,
          itemId: payload.itemId,
          eventType: payload.eventType,
        },
        sound: 'default',
        ...(Platform.OS === 'android' && {
          channelId: NOTIFICATION_CHANNEL_ID,
        }),
      },
      trigger: null, // immediate
    });

    // Increment badge count
    await incrementBadge();

    return record;
  } catch (err) {
    console.warn('[NotificationManager] Failed to handle incoming notification:', err);
    return null;
  }
}

// ─── Display Text Builder ────────────────────────────────────────────────

function buildNotificationText(payload: NotificationPayload): { title: string; body: string } {
  const { eventType, itemName, listName } = payload;

  switch (eventType) {
    case 'item_added':
      return {
        title: 'Item Added',
        body: `"${itemName}" was added to ${listName}`,
      };
    case 'item_checked':
      return {
        title: 'Item Purchased',
        body: `"${itemName}" was checked off in ${listName}`,
      };
    case 'item_unchecked':
      return {
        title: 'Item Unchecked',
        body: `"${itemName}" was unchecked in ${listName}`,
      };
    case 'item_deleted':
      return {
        title: 'Item Removed',
        body: `"${itemName}" was removed from ${listName}`,
      };
    default:
      return {
        title: 'List Updated',
        body: `${listName} has been updated`,
      };
  }
}

// ─── Encryption Helpers ──────────────────────────────────────────────────

function encryptNotificationPayload(
  payload: NotificationPayload,
  listId: string,
  key: Uint8Array,
): EncryptedData {
  // Use the same encrypt() function from crypto/index.ts
  // with listId as AAD context — same as Yjs update encryption
  const serialized = JSON.stringify(payload);
  // Synchronous encryption using sodium directly (same pattern as y-websocket.ts)
  const sodium = require('react-native-libsodium');
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const additionalData = new TextEncoder().encode(listId);
  const plaintext = new TextEncoder().encode(serialized);
  const cipherWithTag = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext, additionalData, null, nonce, key,
  );
  const abytes = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES;
  return {
    ciphertext: sodium.to_base64(cipherWithTag.slice(0, cipherWithTag.length - abytes), sodium.base64_variants.ORIGINAL),
    iv: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
    tag: sodium.to_base64(cipherWithTag.slice(cipherWithTag.length - abytes), sodium.base64_variants.ORIGINAL),
  };
}

function decryptNotificationPayload(
  data: EncryptedData,
  listId: string,
  key: Uint8Array,
): NotificationPayload {
  const sodium = require('react-native-libsodium');
  const nonce = sodium.from_base64(data.iv, sodium.base64_variants.ORIGINAL);
  const tag = sodium.from_base64(data.tag, sodium.base64_variants.ORIGINAL);
  const ciphertext = sodium.from_base64(data.ciphertext, sodium.base64_variants.ORIGINAL);
  const cipherWithTag = new Uint8Array(ciphertext.length + tag.length);
  cipherWithTag.set(ciphertext);
  cipherWithTag.set(tag, ciphertext.length);
  const additionalData = new TextEncoder().encode(listId);
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null, cipherWithTag, additionalData, nonce, key,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as NotificationPayload;
}

// ─── Local Persistence ───────────────────────────────────────────────────

async function persistNotification(record: NotificationRecord): Promise<void> {
  // Persist to WatermelonDB via database module
  // (implementation in NotificationRepository)
  const { saveNotification } = await import('./NotificationRepository');
  await saveNotification(record);
}

function generateNotificationId(): string {
  const sodium = require('react-native-libsodium');
  return sodium.to_base64(
    sodium.randombytes_buf(16),
    sodium.base64_variants.ORIGINAL,
  );
}
```

### 4.2 New File: `src/notifications/NotificationRepository.ts`

WatermelonDB persistence for notifications.

```typescript
// src/notifications/NotificationRepository.ts

import { database } from '../storage/database';
import { Q } from '@nozbe/watermelondb';
import type { NotificationRecord } from '../types/notifications';

export async function saveNotification(record: NotificationRecord): Promise<void> {
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

export async function getUnreadCount(): Promise<number> {
  const collection = database.get('notifications');
  const unread = await collection.query(Q.where('is_read', false)).fetch();
  return unread.length;
}

export async function markAllAsRead(): Promise<void> {
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

export async function getRecentNotifications(limit = 50): Promise<NotificationRecord[]> {
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

/** Prune old notifications (keep last 200) */
export async function pruneOldNotifications(): Promise<void> {
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
```

### 4.3 Changes to `SyncManager` (`src/sync/sync-manager.ts`)

Add a `sendNotification()` method that delegates to the WebSocket client:

```typescript
// Add to SyncManager class

/**
 * Send a notification to all paired family members.
 * The payload is already encrypted by the caller.
 */
sendNotification(listId: string, encryptedPayload: EncryptedData): void {
  if (!this.wsClient) {
    console.warn('SyncManager: no WebSocket client, notification dropped');
    return;
  }
  this.wsClient.sendNotification(listId, encryptedPayload);
}
```

### 4.4 Changes to `YjsWebSocketClient` (`src/sync/y-websocket.ts`)

Add notification send/receive methods:

```typescript
// Add to YjsWebSocketClient class

/**
 * Send an encrypted notification to the relay server.
 */
sendNotification(listId: string, encryptedPayload: EncryptedData): void {
  if (this.state !== 'connected' || !this.ws) {
    console.warn('YjsWebSocket: offline, notification dropped (non-critical)');
    return; // Notifications are best-effort — don't queue
  }

  this.sendMessage({
    type: 'notification',
    familyId: this.config.familyId,
    deviceId: this.config.deviceId,
    listId,
    payload: encryptedPayload,
  });
}

// Add callback
onNotification?: (listId: string, payload: EncryptedData, senderDeviceId: string) => void;
```

Update `handleMessage()` to handle the new `notification` message type:

```typescript
case 'notification': {
  if (data.listId && data.payload) {
    this.onNotification?.(data.listId, data.payload, data.deviceId ?? '');
  }
  break;
}
```

Update `RelayMessage` interface:

```typescript
interface RelayMessage {
  type: 'auth' | 'auth_ack' | 'identity' | 'update' | 'ack' | 'error' | 'notification';
  familyId?: string;
  deviceId?: string;
  listId?: string;
  payload?: EncryptedData;
  message?: string;
  relayToken?: string;
}
```

### 4.5 Wiring Notifications into SyncManager.init()

In `SyncManager.init()`, wire the notification callback:

```typescript
this.wsClient.onNotification = (listId, payload, senderDeviceId) => {
  this.handleIncomingNotification(listId, payload, senderDeviceId);
};

private async handleIncomingNotification(
  listId: string,
  encryptedPayload: EncryptedData,
  senderDeviceId: string,
): Promise<void> {
  const { handleIncomingNotification } = await import('../notifications/NotificationManager');
  await handleIncomingNotification(listId, encryptedPayload, this.encryptionKey!);
}
```

### 4.6 Triggering Notifications from useGroceryStore

After each mutation in `useGroceryStore`, send a notification. The notification includes the **plaintext** item name for display — this is acceptable because it's encrypted end-to-end before transmission (same model as Yjs sync).

```typescript
// In useGroceryStore — after addItem succeeds:

addItem: async (itemData) => {
  // ... existing code ...

  // After yjsAddItem + set state:
  const { sendFamilyNotification } = await import('../notifications/NotificationManager');
  const { getEncryptionKey } = await import('../crypto/key-accessor');
  await sendFamilyNotification(
    'item_added',
    listId,
    listName,      // needs to be available — pull from list store or Yjs meta
    newItem.id,
    newItem.name,
    newItem.category,
    getEncryptionKey(),
  );

  return newItem;
},

// After toggleChecked succeeds:
toggleChecked: async (id) => {
  const item = get().items[id];
  if (!item) return;
  const wasChecked = item.isChecked;
  await get().updateItem(id, { isChecked: !wasChecked });

  const { sendFamilyNotification } = await import('../notifications/NotificationManager');
  const { getEncryptionKey } = await import('../crypto/key-accessor');
  await sendFamilyNotification(
    wasChecked ? 'item_unchecked' : 'item_checked',
    item.listId || get().activeListId || '',
    listName,
    id,
    item.name,
    item.category,
    getEncryptionKey(),
  );
},

// After deleteItem succeeds:
deleteItem: async (id) => {
  const existing = get().items[id];
  // ... existing code ...

  const { sendFamilyNotification } = await import('../notifications/NotificationManager');
  const { getEncryptionKey } = await import('../crypto/key-accessor');
  await sendFamilyNotification(
    'item_deleted',
    existing.listId || get().activeListId || '',
    listName,
    id,
    existing.name,
    existing.category,
    getEncryptionKey(),
  );
},
```

**Note:** The `listName` parameter needs to be accessible from the store. Options:
1. Add `activeListName` to `useGroceryStore` state (set in `loadItems()`)
2. Import from `useListStore`
3. Read from Yjs meta (`getListMeta(listId).get('name')`)

Option 3 is cleanest since it avoids cross-store coupling.

### 4.7 Notification Response Handling (Navigation)

When a user taps a notification, navigate to the relevant list/item.

Add to the app's root component or navigation setup:

```typescript
// src/navigation/useNotificationNavigation.ts

import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import type { AppNavigationProp } from './deepLinks';

export function useNotificationNavigation(navigation: AppNavigationProp) {
  const lastResponse = useRef<Notifications.NotificationResponse | null>(null);

  useEffect(() => {
    // Handle notification tap when app is in background/killed
    const response = Notifications.getLastNotificationResponseAsync();
    response.then((r) => {
      if (r && r !== lastResponse.current) {
        lastResponse.current = r;
        navigateToNotification(r.notification);
      }
    });

    // Handle notification tap when app is in foreground
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      navigateToNotification(response.notification);
    });

    return () => subscription.remove();
  }, [navigation]);

  function navigateToNotification(notification: Notifications.Notification) {
    const data = notification.request.content.data;
    if (data?.listId) {
      navigation.navigate('GroceryList', { listId: data.listId });
    }
  }
}
```

### 4.8 Foreground Notification Display

Configure `expo-notifications` to show notifications even when the app is in the foreground:

```typescript
// src/notifications/notificationHandler.ts

import * as Notifications from 'expo-notifications';

/**
 * Configure how notifications are displayed when the app is in the foreground.
 * Call this once at app startup (before any notifications arrive).
 */
export function configureForegroundNotificationBehavior(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}
```

---

## 5. Push Notification Strategy

### 5.1 Phase 1: WebSocket-Only (This Implementation)

| Scenario | Behavior |
|----------|----------|
| **App foregrounded** | ✅ Real-time notification via WebSocket relay |
| **App backgrounded** | ❌ No notification (WebSocket disconnected) |
| **App killed** | ❌ No notification |

This covers the primary use case: family members actively using the app at the same time (e.g., one person at the store, another adding items at home).

### 5.2 Phase 2: FCM Integration (Future, Optional)

Add FCM for background/killed-app delivery:

1. Install `expo-notifications` (already supports FCM)
2. On device registration, send the FCM push token to the relay server alongside the WebSocket connection
3. When the relay receives a `notification` message, in addition to forwarding via WebSocket, it also sends an FCM push to all offline family devices
4. The FCM payload is a **silent notification** containing only the encrypted notification ID — the client decrypts the full payload from local Yjs state on wake

**Relay server changes for Phase 2:**
```
POST /register-push-token
Body: { deviceId, pushToken, platform: 'android' | 'ios' }

// Store: Map<deviceId, { pushToken, platform }>
```

On `notification` message relay, for each family device NOT currently connected via WebSocket:
```javascript
if (!deviceSockets.has(familyDeviceId)) {
  sendFCM(pushTokenStore.get(familyDeviceId), {
    title: 'StopHop',
    body: encryptedNotificationId,
    data: { listId, notificationId },
  });
}
```

### 5.3 Why Not FCM-Only?

| Factor | WebSocket Relay | FCM |
|--------|----------------|-----|
| **Latency** | ~50ms (LAN) | 200-2000ms (cloud hop) |
| **Reliability** | Guaranteed if connected | May be delayed/dropped |
| **Privacy** | Zero-knowledge (E2E encrypted) | Google sees metadata |
| **Cost** | Free (self-hosted) | Free tier limits |
| **Dependency** | None | Google Play Services required |
| **Offline** | Queued by Yjs CRDT | Requires FCM SDK |

The WebSocket relay is superior for the self-hosted, privacy-first model. FCM is a supplementary transport for background delivery only.

---

## 6. State Management for Notification Badge Count

### 6.1 New Zustand Store: `src/state/useNotificationStore.ts`

```typescript
import { create } from 'zustand';
import type { NotificationRecord } from '../types/notifications';
import {
  getUnreadCount as getUnreadCountFromDB,
  markAllAsRead as markAllAsReadInDB,
  getRecentNotifications as getRecentFromDB,
  pruneOldNotifications,
} from '../notifications/NotificationRepository';
import {
  initBadgeCount,
  clearBadge as clearBadgeNative,
} from '../notifications/NotificationManager';

interface NotificationState {
  unreadCount: number;
  recentNotifications: NotificationRecord[];
  isLoading: boolean;

  /** Initialize badge count from persisted state (app start) */
  init: () => Promise<void>;

  /** Called when a new notification arrives */
  onNotificationReceived: (record: NotificationRecord) => void;

  /** Mark all as read + clear badge */
  markAllRead: () => Promise<void>;

  /** Refresh recent notifications list */
  loadRecent: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unreadCount: 0,
  recentNotifications: [],
  isLoading: false,

  init: async () => {
    try {
      const count = await getUnreadCountFromDB();
      set({ unreadCount: count });
      await initBadgeCount(count);
    } catch (err) {
      console.warn('[NotificationStore] Failed to init:', err);
    }
  },

  onNotificationReceived: (record) => {
    set((state) => ({
      unreadCount: state.unreadCount + 1,
      recentNotifications: [record, ...state.recentNotifications].slice(0, 50),
    }));
  },

  markAllRead: async () => {
    await markAllAsReadInDB();
    await clearBadgeNative();
    set((state) => ({
      unreadCount: 0,
      recentNotifications: state.recentNotifications.map((n) => ({ ...n, isRead: true })),
    }));
  },

  loadRecent: async () => {
    set({ isLoading: true });
    try {
      const notifications = await getRecentFromDB(50);
      set({ recentNotifications: notifications, isLoading: false });
      // Prune in background
      pruneOldNotifications().catch(() => {});
    } catch {
      set({ isLoading: false });
    }
  },
}));
```

### 6.2 Badge Count Lifecycle

```
App Start:
  1. initSettings() + initDeviceIdentity() + crypto init
  2. useNotificationStore.init()
     → query WatermelonDB for unread count
     → set native badge count via Notifications.setBadgeCountAsync()
  3. SyncManager.init() connects WebSocket
  4. WebSocket.onNotification → handleIncomingNotification
     → persist to DB → show native notification → increment badge
     → useNotificationStore.onNotificationReceived()

App Resume (from background):
  1. Yjs CRDT sync reconciles any missed data changes
  2. Badge count is already persisted natively (expo-notifications maintains it)
  3. No special handling needed — badge is correct

User Marks All Read:
  1. useNotificationStore.markAllRead()
     → WatermelonDB: set all is_read = true
     → Notifications.setBadgeCountAsync(0)
     → Zustand: unreadCount = 0
```

### 6.3 Badge Counter Display in UI

The `HomeScreen` can show a badge on a notification bell icon:

```typescript
// In HomeScreen:
const unreadCount = useNotificationStore((s) => s.unreadCount);

// Render a badge icon if unreadCount > 0
{unreadCount > 0 && (
  <View style={styles.badge}>
    <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
  </View>
)}
```

---

## 7. Offline / Queue Handling

### 7.1 Sending Notifications While Offline

Notifications are **best-effort** when sending. If the device is offline:
- The grocery item mutation is still persisted locally via Yjs + WatermelonDB
- The Yjs update is queued in the existing offline queue and synced on reconnect
- The notification is **not** queued — it's dropped silently

**Rationale:** The notification is about a real-time event. If you added an item while offline, by the time you reconnect, the other family members will see the item via Yjs sync. A stale notification saying "Item added" arriving 30 minutes later is more confusing than no notification.

### 7.2 Receiving Notifications While Offline

If a device is offline when a notification is sent:
- It misses the notification (no server-side queue by design)
- On reconnect, Yjs CRDT syncs the actual data change
- The item appears in the list with no notification history for that event
- This is acceptable — the notification is supplementary to the data sync

### 7.3 Reconnect Behavior

On reconnect, the existing `flushOfflineQueue()` in `YjsWebSocketClient` handles queued Yjs updates. No special notification handling is needed — the data sync is the source of truth.

---

## 8. File Structure Summary

### New Files

```
src/
├── notifications/
│   ├── NotificationManager.ts        # Core logic: send, receive, encrypt, display
│   ├── NotificationRepository.ts     # WatermelonDB CRUD for notifications
│   ├── notificationHandler.ts        # Foreground notification behavior config
│   └── __tests__/
│       ├── NotificationManager.test.ts
│       └── NotificationRepository.test.ts
├── navigation/
│   └── useNotificationNavigation.ts  # Handle notification taps → navigation
├── state/
│   └── useNotificationStore.ts       # Zustand store for badge count + recent list
└── types/
    └── notifications.ts              # NotificationPayload, NotificationRecord types
```

### Modified Files

```
relay-server/server.js                 # Add 'notification' message type handler
src/sync/y-websocket.ts                # Add sendNotification(), onNotification callback, update RelayMessage
src/sync/sync-manager.ts              # Add sendNotification() method, wire onNotification
src/state/useGroceryStore.ts          # Fire notifications after addItem/toggleChecked/deleteItem
src/storage/schema.ts                  # Add 'notifications' table (schema v4)
src/storage/models.ts                  # Add NotificationModel class
src/storage/migrations.ts              # Add v3→v4 migration
src/screens/HomeScreen.ts             # Add notification bell icon with badge
src/navigation/deepLinks.ts           # (optional) add notification screen route
app.json                               # Add expo-notifications config plugin
package.json                           # Add expo-notifications dependency
```

---

## 9. app.json Plugin Configuration

```json
{
  "expo": {
    "plugins": [
      ["expo-notifications", {
        "icon": "./assets/notification-icon.png",
        "color": "#10B981",
        "defaultChannel": "stophop-family",
        "sounds": ["./assets/notification-sound.wav"]
      }]
    ]
  }
}
```

**Notification icon requirements (Android):**
- 96×96 pixels, all-white with transparency
- PNG format
- Place at `./assets/notification-icon.png`

---

## 10. Installation

```bash
cd ~/Documents/GroceryApp/GroceryApp
npx expo install expo-notifications
```

This installs `expo-notifications ~0.11.x` (SDK 56 compatible). No additional native modules needed — expo-notifications handles FCM/APNs registration internally.

---

## 11. Testing Strategy

### 11.1 Unit Tests

| Test | File | What |
|------|------|------|
| Encrypt/decrypt notification payload | `NotificationManager.test.ts` | Round-trip encryption with XChaCha20-Poly1305 |
| Build notification text | `NotificationManager.test.ts` | Correct title/body for each event type |
| Badge count lifecycle | `NotificationManager.test.ts` | init, increment, clear |
| Notification persistence | `NotificationRepository.test.ts` | Save, query unread, mark all read, prune |
| Sender exclusion | `NotificationManager.test.ts` | Own notifications don't trigger local display |

### 11.2 Integration Tests

| Test | What |
|------|------|
| **Relay routing** | Send `notification` message from Device A → verify Device B receives it |
| **Relay exclusion** | Device A sends notification → Device A does NOT receive it back |
| **Auth required** | Unauthenticated client sends `notification` → gets error |
| **Rate limiting** | >100 notifications in 1 minute → rate limit error |
| **Cross-list isolation** | Notification for list A doesn't reach devices only subscribed to list B |

### 11.3 E2E / Manual Tests

| Scenario | Steps | Expected |
|----------|-------|----------|
| **Add item → family notified** | Device A adds "Milk" to list → Device B receives notification | Notification drawer shows "Item Added — 'Milk' was added to Grocery List" |
| **Check item → family notified** | Device A checks off "Milk" → Device B receives notification | Notification drawer shows "Item Purchased — 'Milk' was checked off in Grocery List" |
| **Badge count** | 3 notifications received → app icon shows badge "3" | Badge visible on home screen and app icon |
| **Mark all read** | User opens notification panel → taps "Mark All Read" → badge clears | Badge goes to 0, all notifications marked read |
| **Notification tap → navigation** | User taps a notification → app navigates to the relevant list | Correct list opens |
| **Own action → no notification** | Device A adds item → Device A does NOT receive notification | No self-notification |
| **Offline → reconnect** | Device B is offline → Device A adds item → Device B comes online | Item appears via Yjs sync, no stale notification |
| **Multiple lists** | Notifications from different lists show correct list name | Each notification identifies the correct list |
| **Foreground display** | App is open → notification arrives → banner shown | Banner appears at top of screen |
| **Pruning** | >200 notifications accumulated → oldest pruned | DB stays bounded |

### 11.4 Relay Server Tests

```javascript
// Add to server test suite:

describe('notification message type', () => {
  test('relays to other family members', async () => {
    // Connect two clients in same family
    // Client A sends notification
    // Assert Client B receives notification message
  });

  test('does not relay back to sender', async () => {
    // Connect two clients
    // Client A sends notification
    // Assert Client A does NOT receive it
  });

  test('requires authentication', async () => {
    // Connect unauthenticated client
    // Send notification
    // Assert error response
  });

  test('respects rate limits', async () => {
    // Send 101 notifications in < 1 minute
    // Assert 101st gets rate limit error
  });
});
```

---

## 12. Security Considerations

1. **E2E encryption** — Notification payloads are encrypted with the same XChaCha20-Poly1305 key and scheme as Yjs updates. The relay server sees only ciphertext.

2. **AAD binding** — The `listId` is used as Additional Authenticated Data, preventing ciphertext replay across different lists (same as existing Yjs update encryption).

3. **No PII on server** — The relay server only sees encrypted blobs. It cannot read item names, list names, or any other payload content.

4. **Sender verification** — The relay server verifies `deviceId` against the enrolled token before routing, preventing impersonation.

5. **Rate limiting** — The existing per-device rate limit (100 messages/minute) applies to notifications too, preventing notification spam.

6. **No notification history on server** — Notifications are ephemeral on the wire. Only the receiving device persists them locally (encrypted WatermelonDB).

---

## 13. Performance Considerations

1. **Notification payload size** — Each notification is ~200-500 bytes encrypted. Negligible overhead on the WebSocket connection.

2. **Badge count queries** — The `is_read` column is indexed (WatermelonDB indexes). Querying unread count is O(1) amortized.

3. **Pruning** — Old notifications are pruned automatically (>200 limit). WatermelonDB handles cleanup efficiently.

4. **No polling** — Badge count is updated in real-time as notifications arrive. No periodic polling needed.

5. **Lazy imports** — `NotificationManager` uses dynamic imports for `NotificationRepository` to avoid circular dependencies and reduce initial bundle size.

---

## 14. Migration Path

### v1.02 → v1.03 (This Release)

1. Add `expo-notifications` dependency
2. Add `notifications` table to WatermelonDB schema (v3 → v4)
3. Add `notification` message type to relay server
4. Wire notification sending into `useGroceryStore` mutations
5. Wire notification receiving into `SyncManager`
6. Add badge count store and UI

### v1.04+ (Future)

1. FCM integration for background delivery
2. Notification preferences (per-list, per-event-type muting)
3. Notification grouping (batch "3 items added to Grocery List")
4. Rich notifications (item image, category icon)
5. Interactive notifications ("Mark as purchased" action button)

---

## 15. Dependency Summary

| Package | Version | Purpose |
|---------|---------|---------|
| `expo-notifications` | `~0.11.x` (SDK 56) | Local + push notifications, badge management |
| `expo-constants` | `^56.0.18` (already installed) | Project ID for Expo push tokens (Phase 2) |
| `expo-device` | `^56.0.4` (already installed) | Device info for push token registration |

No new native modules required. `expo-notifications` is a managed Expo module that works with both Expo Go (local notifications only) and development builds (full push notification support).
