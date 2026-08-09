/**
 * SyncIndicator — Shows sync state (syncing/error/offline/synced) in the header.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { SyncState } from '../types';
import { useSyncStore, syncIndicatorStatus } from '../state/useSyncStore';
import { useActiveTheme } from '../state/useThemeStore';
import { themeColors } from './groceryTheme';

export default function SyncIndicator() {
  const syncState: SyncState = useSyncStore((s) => s.syncState);
  const lastSyncedAt: number | null = useSyncStore((s) => s.lastSyncedAt);
  const errorMessage: string | null = useSyncStore((s) => s.error);
  const decryptFailures: number = useSyncStore((s) => s.decryptFailures);
  const activeTheme = useActiveTheme();
  const theme = activeTheme === 'dark' ? themeColors.dark : themeColors.light;

  const { label, color } = syncIndicatorStatus({
    syncState,
    error: errorMessage,
    decryptFailures,
  });

  // Don't show a "last synced" time when nothing has ever synced — nor when
  // the data cannot be read, where a fresh timestamp reads as reassurance.
  const timeLabel =
    lastSyncedAt && syncState !== 'not_configured' && decryptFailures === 0
      ? new Date(lastSyncedAt).toLocaleTimeString()
      : '';

  return (
    <View style={styles.syncIndicator}>
      <View style={[styles.syncDot, { backgroundColor: color }]} />
      <Text style={[styles.syncText, { color: theme.secondaryText }]}>
        {label}
        {timeLabel ? ` · ${timeLabel}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  syncIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  syncDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  syncText: {
    fontSize: 11,
    color: '#999',
  },
});
