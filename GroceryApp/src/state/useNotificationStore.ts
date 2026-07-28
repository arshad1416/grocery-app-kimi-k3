/**
 * Zustand store: Notification badge count + recent list.
 *
 * Manages the unread notification count and recent notification list
 * for the UI. Initializes from WatermelonDB on app start, updates
 * in real-time as notifications arrive, and supports mark-all-read.
 */

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

export const useNotificationStore = create<NotificationState>((set, _get) => ({
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
