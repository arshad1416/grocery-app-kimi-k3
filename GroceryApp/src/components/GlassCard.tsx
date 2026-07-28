/**
 * GlassCard — Reusable glassmorphism card wrapper.
 * Dark mode: frosted glass with neon green glow border.
 * Light mode: white card with subtle shadow.
 */

import React from 'react';
import { View, StyleSheet, ViewStyle, Platform } from 'react-native';
import { useActiveTheme } from '../state/useThemeStore';
import { themeColors } from './groceryTheme';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  glowColor?: string;
  noPadding?: boolean;
}

export default function GlassCard({ children, style, glowColor, noPadding }: GlassCardProps) {
  const activeTheme = useActiveTheme();
  const isDark = activeTheme === 'dark';
  const theme = isDark ? themeColors.dark : themeColors.light;

  return (
    <View
      style={[
        styles.card,
        isDark ? styles.darkCard : styles.lightCard,
        isDark && {
          borderColor: glowColor ?? 'rgba(0, 230, 118, 0.15)',
          shadowColor: glowColor ?? '#00E676',
        },
        !isDark && {
          borderColor: 'rgba(0, 0, 0, 0.06)',
        },
        noPadding && { padding: 0 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    overflow: 'hidden',
  },
  darkCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.15)',
    shadowColor: '#00E676',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    ...(Platform.OS === 'android' ? { elevation: 4 } : {}),
  },
  lightCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
});
