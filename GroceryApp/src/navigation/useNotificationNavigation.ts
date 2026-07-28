/**
 * Notification-tap → navigation.
 *
 * When a user taps a family notification (from background/killed or
 * foreground), navigate to the relevant grocery list.
 */

import * as Notifications from 'expo-notifications';

/** Minimal surface we need from the navigation container ref. */
export interface Navigator {
  isReady?: () => boolean;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
}

/**
 * Register notification-tap handlers. Call once, after the navigation
 * container is ready (e.g. from NavigationContainer onReady). Returns an
 * unsubscribe function.
 *
 * Previously this was a hook (useNotificationNavigation) that was never
 * mounted anywhere, so tapping a family notification did nothing.
 */
export function registerNotificationNavigation(navigation: Navigator): () => void {
  const go = (notification: Notifications.Notification | undefined) => {
    const data = notification?.request?.content?.data as { listId?: string } | undefined;
    if (data?.listId && (navigation.isReady?.() ?? true)) {
      navigation.navigate('GroceryList', { listId: data.listId });
    }
  };

  // Cold start / background: app opened by tapping a notification
  Notifications.getLastNotificationResponseAsync()
    .then((r) => go(r?.notification ?? undefined))
    .catch(() => {});

  // Foreground / warm: tap while running
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    go(response.notification);
  });

  return () => subscription.remove();
}
