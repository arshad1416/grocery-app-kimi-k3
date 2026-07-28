/**
 * Foreground notification behavior configuration.
 *
 * Configures expo-notifications to display notifications even when the app
 * is in the foreground. Call this once at app startup (before any
 * notifications arrive).
 */

import * as Notifications from 'expo-notifications';

/**
 * Configure how notifications are displayed when the app is in the foreground.
 * Shows banner, list entry, plays sound, and sets badge.
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
