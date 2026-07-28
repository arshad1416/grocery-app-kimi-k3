/**
 * useShareInvite — React Native Share API hook for sharing invite links.
 *
 * Provides a simple hook that wraps the RN Share API to share invite URLs
 * via the system share sheet (messages, email, AirDrop, etc.).
 *
 * Usage:
 *   const { shareInvite, isSharing } = useShareInvite();
 *   await shareInvite('grocceryapp://invite?token=...');
 */

import { useCallback, useState } from 'react';
import { Share, Platform, Alert } from 'react-native';

export interface UseShareInviteReturn {
  /** Share an invite URL via the system share sheet. */
  shareInvite: (inviteUrl: string) => Promise<void>;
  /** Whether a share operation is currently in progress. */
  isSharing: boolean;
}

/**
 * Hook that returns a `shareInvite` function wrapping React Native's Share API.
 *
 * @param options.title - Optional share title (default: 'Join my grocery list!').
 * @param options.onError - Optional error handler callback.
 */
export function useShareInvite(options?: {
  title?: string;
  onError?: (error: Error) => void;
}): UseShareInviteReturn {
  const [isSharing, setIsSharing] = useState(false);

  const shareInvite = useCallback(
    async (inviteUrl: string) => {
      setIsSharing(true);
      try {
        await Share.share(
          {
            message: inviteUrl,
            title: options?.title ?? 'Join my grocery list!',
            // On iOS, the URL can be passed separately from the message
            ...(Platform.OS === 'ios' ? { url: inviteUrl } : {}),
          },
          {
            // Android: dialog title
            dialogTitle: options?.title ?? 'Share Invite',
          },
        );
      } catch (error: unknown) {
        const err =
          error instanceof Error ? error : new Error(String(error));
        // Only report non-cancellation errors
        if (
          err.message !== 'User did not share' &&
          err.message !== 'ShareSheet dismissed' &&
          !err.message.includes('cancelled') &&
          !err.message.includes('canceled')
        ) {
          options?.onError?.(err);
          Alert.alert('Share Failed', err.message);
        }
      } finally {
        setIsSharing(false);
      }
    },
    [options?.title, options?.onError],
  );

  return { shareInvite, isSharing };
}