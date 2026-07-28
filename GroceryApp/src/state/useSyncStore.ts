/**
 * Zustand store: Sync Status.
 *
 * Tracks the current synchronization state — connected, syncing, offline, etc.
 * In Phase 2, this connects to the actual Yjs WebSocket relay.
 */

import { create } from 'zustand';
import type { SyncState } from '../types';
import type { ConnectionState } from '../sync/y-websocket';
import { syncManager } from '../sync/sync-manager';

// ─── State Shape ────────────────────────────────────────────────────────────

export interface SyncStateShape {
  syncState: SyncState;
  connectionState: ConnectionState;
  lastSyncedAt: number | null;
  pendingUploads: number;
  pendingDownloads: number;
  error: string | null;

  // Actions
  setSyncState: (state: SyncState) => void;
  setConnectionState: (state: ConnectionState) => void;
  triggerSync: () => Promise<void>;
  markSynced: () => void;
  clearError: () => void;
  refreshPendingCount: () => void;
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useSyncStore = create<SyncStateShape>((set) => ({
  // Start as not_configured: a fresh device has no relay/family, so it must not
  // display "Synced". bootstrapSync() promotes this once a relay connects.
  syncState: 'not_configured',
  connectionState: 'disconnected',
  lastSyncedAt: null,
  pendingUploads: 0,
  pendingDownloads: 0,
  error: null,

  setSyncState: (syncState) => {
    set({ syncState });
  },

  setConnectionState: (connectionState) => {
    const syncState = connectionState === 'connected' ? 'idle' :
      connectionState === 'connecting' ? 'syncing' :
      connectionState === 'error' ? 'error' : 'offline';
    set({ connectionState, syncState });
  },

  triggerSync: async () => {
    set({ syncState: 'syncing', error: null });
    try {
      // If the sync manager is ready and connected, flush any pending offline queue
      const client = syncManager.getClient();
      if (client) {
        const pending = client.getPendingCount();
        set({ pendingUploads: pending });

        // Wait a brief moment for queued messages to flush
        await new Promise((resolve) => setTimeout(resolve, 500));

        const remaining = client.getPendingCount();
        set({
          syncState: remaining > 0 ? 'syncing' : 'idle',
          lastSyncedAt: Date.now(),
          pendingUploads: remaining,
          pendingDownloads: 0,
        });
      } else {
        set({
          syncState: 'idle',
          lastSyncedAt: Date.now(),
          pendingUploads: 0,
          pendingDownloads: 0,
        });
      }
    } catch (err) {
      set({
        syncState: 'error',
        error: err instanceof Error ? err.message : 'Sync failed',
      });
    }
  },

  markSynced: () => {
    set({
      syncState: 'idle',
      lastSyncedAt: Date.now(),
      pendingUploads: 0,
      pendingDownloads: 0,
    });
  },

  refreshPendingCount: () => {
    const client = syncManager.getClient();
    if (client) {
      const pending = client.getPendingCount();
      set({ pendingUploads: pending });
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));