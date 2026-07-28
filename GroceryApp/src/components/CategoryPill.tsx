/**
 * CategoryPill — Horizontal scrolling category filter pill.
 * Active: primary filled. Inactive: glass/tinted background.
 */

import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useActiveTheme } from '../state/useThemeStore';
import { themeColors } from './groceryTheme';

interface CategoryPillProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
}

export default function CategoryPill({ label, isActive, onPress }: CategoryPillProps) {
  const activeTheme = useActiveTheme();
  const isDark = activeTheme === 'dark';
  const theme = isDark ? themeColors.dark : themeColors.light;

  return (
    <TouchableOpacity
      style={[
        styles.pill,
        isActive
          ? {
              backgroundColor: isDark ? '#00E676' : '#7CB342',
            }
          : {
              backgroundColor: isDark ? 'rgba(0, 230, 118, 0.1)' : '#F5F0E8',
              borderWidth: 1,
              borderColor: isDark ? 'rgba(0, 230, 118, 0.15)' : 'rgba(0, 0, 0, 0.06)',
            },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.label,
          {
            color: isActive
              ? isDark
                ? '#0B0F12'
                : '#FFFFFF'
              : isDark
                ? '#00E676'
                : '#6B7B6F',
            fontWeight: isActive ? '600' : '400',
          },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
});
