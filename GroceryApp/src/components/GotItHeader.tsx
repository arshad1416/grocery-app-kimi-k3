/**
 * GotItHeader — Collapsible header for the "Got It" (checked items) section.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useActiveTheme } from '../state/useThemeStore';
import { themeColors } from './groceryTheme';

interface GotItHeaderProps {
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function GotItHeader({ count, isExpanded, onToggle }: GotItHeaderProps) {
  const activeTheme = useActiveTheme();
  const isDark = activeTheme === 'dark';
  const theme = isDark ? themeColors.dark : themeColors.light;

  return (
    <TouchableOpacity
      style={[
        styles.gotItHeader,
        {
          backgroundColor: isDark ? '#0B2518' : '#E8F5E9',
          borderLeftColor: '#10B981',
        },
      ]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <View style={styles.gotItHeaderLeft}>
        <Text style={styles.gotItIcon}>✓</Text>
        <Text style={[styles.gotItTitle, { color: isDark ? '#34D399' : '#2E7D32' }]}>Got It</Text>
      </View>
      <View style={styles.gotItHeaderRight}>
        <Text style={[styles.gotItCount, { color: isDark ? '#a7f3d0' : '#558B2F' }]}>
          {count} {count === 1 ? 'item' : 'items'}
        </Text>
        <Text style={[styles.gotItChevron, { color: isDark ? '#a7f3d0' : '#558B2F' }]}>{isExpanded ? '▼' : '▶'}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  gotItHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
    marginHorizontal: 12,
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  gotItHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gotItIcon: {
    fontSize: 16,
    color: '#4CAF50',
    fontWeight: 'bold',
  },
  gotItTitle: {
    fontSize: 15,
    color: '#2E7D32',
    fontWeight: '700',
  },
  gotItHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gotItCount: {
    fontSize: 13,
    color: '#558B2F',
    fontWeight: '600',
  },
  gotItChevron: {
    fontSize: 12,
    color: '#558B2F',
  },
});
