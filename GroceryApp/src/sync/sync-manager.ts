/**
 * Sync Manager — coordinates Yjs CRDT sync, WebSocket relay, and WatermelonDB persistence.
 *
 * On app start:
 *  1. Load from WatermelonDB
 *  2. Hydrate Yjs documents
 *  3. Connect to WebSocket relay
 *  4. Observe Yjs changes → encrypt → send via WebSocket
 *  5. Receive remote updates → decrypt → apply to Yjs → persist to WatermelonDB
 */

import * as Y from 'yjs';
import { YjsWebSocketClient, type WebSocketConfig, type ConnectionState } from './y-websocket';
import {
  getDoc,
  getActiveDocIds,
  hydrateList,
  extractItems,
  extractList,
  destroyDoc,
} from './yjs-adapter';
import {
  persistItem,
  persistList,
  loadItemsFromDB,
  loadListsFromDB,
} from '../storage/hydrate';
import type { GroceryItem, GroceryList } from '../types';
import type { EncryptedData } from '../types';

// ─── Callbacks ───────────────────────────────────────────────────────────────

export interface SyncCallbacks {
  onConnectionChange?: (state: ConnectionState) => void;
  onSyncError?: (error: Error) => void;
  onRemoteItemsUpdate?: (listId: string, items: GroceryItem[]) => void;
}

// ─── Sync Manager ────────────────────────────────────────────────────────────

export class SyncManager {
  private wsClient: YjsWebSocketClient | null = null;
  private config: WebSocketConfig | null = null;
  private callbacks: SyncCallbacks = {};
  private observedDocs = new Map<string, () => void>(); // cleanup functions
  private encryptionKey: Uint8Array | null = null;
  private ready = false;
  private isHydrating = false;

  /**
   * Initialise the sync manager.
   * Must be called after crypto initialisation and after master key is available.
   */
  async init(config: WebSocketConfig, callbacks?: SyncCallbacks): Promise<void> {
    this.config = config;
    this.callbacks = callbacks ?? {};
    this.encryptionKey = config.encryptionKey;

    this.wsClient = new YjsWebSocketClient(config);
    this.wsClient.onStateChange = (state) => {
      this.callbacks.onConnectionChange?.(state);
    };
    this.wsClient.onError = (err) => {
      this.callbacks.onSyncError?.(err);
    };
    this.wsClient.onRemoteUpdate = (listId, update) => {
      this.applyRemoteUpdate(listId, update);
    };
    this.wsClient.onNotification = (listId, payload, senderDeviceId) => {
      this.handleIncomingNotification(listId, payload, senderDeviceId);
    };

    await this.wsClient.init();
    this.ready = true;
  }

  /**
   * Register a list for sync — observe Yjs changes and send via WebSocket.
   */
  registerList(listId: string): void {
    if (this.observedDocs.has(listId)) return;

    const doc = getDoc(listId);
    const observer = (updates: Uint8Array, origin: any) => {
      // Ignore updates we applied locally (origin is non-null for remote)
      if (origin === 'remote') return;

      // Skip observer during hydration to prevent spurious DB writes
      if (this.isHydrating) return;

      // Send update via WebSocket
      if (this.wsClient) {
        this.wsClient.sendUpdate(listId, updates);
      }

      // Persist to WatermelonDB
      this.persistListToDB(listId).catch((err) => {
        console.warn('SyncManager: failed to persist after Yjs change', err);
      });
    };

    doc.on('update', observer);

    this.observedDocs.set(listId, () => {
      doc.off('update', observer);
    });
  }

  /**
   * Unregister a list from sync observation.
   */
  unregisterList(listId: string): void {
    const cleanup = this.observedDocs.get(listId);
    if (cleanup) {
      cleanup();
      this.observedDocs.delete(listId);
    }
    destroyDoc(listId);
  }

  /**
   * Disconnect the sync manager.
   */
  disconnect(): void {
    // Clean up all observers
    this.observedDocs.forEach((cleanup) => cleanup());
    this.observedDocs.clear();

    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
    }
    this.ready = false;
  }

  /**
   * Get the Yjs WebSocket client (for UI status display).
   */
  getClient(): YjsWebSocketClient | null {
    return this.wsClient;
  }

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

  // ─── Remote Update Handling ────────────────────────────────────────────

  /**
   * Handle an incoming notification from the relay server.
   * Decrypts and displays the notification locally.
   */
  private async handleIncomingNotification(
    listId: string,
    encryptedPayload: EncryptedData,
    _senderDeviceId: string,
  ): Promise<void> {
    try {
      if (!this.encryptionKey) return;
      const { handleIncomingNotification } = await import('../notifications/NotificationManager');
      await handleIncomingNotification(listId, encryptedPayload, this.encryptionKey);
    } catch (err) {
      console.warn('SyncManager: failed to handle incoming notification', err);
    }
  }

  /**
   * Apply a decrypted remote update to a Yjs document.
   */
  private applyRemoteUpdate(listId: string, update: Uint8Array): void {
    const doc = getDoc(listId);
    // Apply with origin 'remote' so local observers can distinguish
    Y.transact(doc, () => {
      Y.applyUpdate(doc, update);
    }, 'remote');

    // Notify callbacks
    const items = extractItems(listId);
    this.callbacks.onRemoteItemsUpdate?.(listId, items);

    // Persist updated state to WatermelonDB
    this.persistListToDB(listId).catch((err) => {
      console.warn('SyncManager: failed to persist remote update', err);
    });
  }

  // ─── WatermelonDB Persistence ──────────────────────────────────────────

  /**
   * Persist current Yjs state for a list to WatermelonDB.
   */
  private async persistListToDB(listId: string): Promise<void> {
    if (!this.encryptionKey) return;

    const list = extractList(listId);
    const items = extractItems(listId);

    if (list) {
      await persistList(list, this.encryptionKey);
    }

    for (const item of items) {
      await persistItem(item, this.encryptionKey);
    }
  }

  /**
   * Hydrate all lists from WatermelonDB into Yjs documents.
   * Called on app start.
   */
  async hydrateFromDB(encryptionKey: Uint8Array): Promise<void> {
    this.isHydrating = true;
    // Store the key so local WatermelonDB persistence works even before (or
    // without) a relay connection — init() sets the same field later.
    this.encryptionKey = encryptionKey;
    try {
      const lists = await loadListsFromDB(encryptionKey);
      const allItems = await loadItemsFromDB(encryptionKey);
      const indexDoc = getDoc('__lists_index__');
      for (const list of lists) {
        const listItems = allItems.filter((item) => item.listId === list.id);
        hydrateList(list.id, list, listItems);
        // Rebuild the in-memory lists index that useListStore.loadLists reads
        indexDoc.transact(() => {
          indexDoc.getMap('listIds').set(list.id, true);
        });
        this.registerList(list.id);
      }
    } finally {
      this.isHydrating = false;
    }
  }

  /**
   * Check if the sync manager is ready.
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Get the current encryption key (for notification encryption).
   * Returns null if not yet initialized.
   */
  getEncryptionKey(): Uint8Array | null {
    return this.encryptionKey;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const syncManager = new SyncManager();