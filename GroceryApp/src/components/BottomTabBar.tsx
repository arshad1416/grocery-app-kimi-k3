/**
 * BottomTabBar — Custom bottom navigation bar.
 * Dark mode: 5 tabs with glassmorphism effect.
 * Light mode: 5 tabs with white background.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useActiveTheme } from '../state/useThemeStore';
import { themeColors } from './groceryTheme';

export type TabName = 'home' | 'lists' | 'scan' | 'deals' | 'account';

/**
 * The Deals tab is Turso-backed (flyer deals queried from a Turso database).
 * v1 ships with the Turso surface gated off entirely — no client credential
 * path exists (Option B — see GOAL_PROMPT_NOTES.md), so the tab would only
 * ever show an unconfigurable empty state. Re-enable when deals return via
 * a relay-side endpoint post-v1.
 */
export const DEALS_TAB_ENABLED = false;

interface TabConfig {
  name: TabName;
  label: string;
  icon: string;
  iconFocused: string;
}

const TABS: TabConfig[] = [
  { name: 'home', label: 'Home', icon: 'home-outline', iconFocused: 'home' },
  { name: 'lists', label: 'Lists', icon: 'list-outline', iconFocused: 'list' },
  { name: 'scan', label: 'Scan', icon: 'scan-outline', iconFocused: 'scan' },
  ...(DEALS_TAB_ENABLED
    ? [{ name: 'deals', label: 'Deals', icon: 'pricetag-outline', iconFocused: 'pricetag' } as TabConfig]
    : []),
  { name: 'account', label: 'Account', icon: 'person-outline', iconFocused: 'person' },
];

interface BottomTabBarProps {
  activeTab: TabName;
  onTabPress: (tab: TabName) => void;
}

export default function BottomTabBar({ activeTab, onTabPress }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const activeTheme = useActiveTheme();
  const isDark = activeTheme === 'dark';
  const theme = isDark ? themeColors.dark : themeColors.light;

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, 48),
          backgroundColor: isDark ? 'rgba(17, 28, 21, 0.95)' : '#FFFFFF',
          borderTopColor: theme.border,
        },
      ]}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.name;
        const iconName = isActive ? tab.iconFocused : tab.icon;
        const iconColor = isActive ? theme.primary : theme.tabInactiveText;

        return (
          <TouchableOpacity
            key={tab.name}
            style={styles.tab}
            onPress={() => onTabPress(tab.name)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
          >
            <View style={styles.tabContent}>
              {isActive && isDark && (
                <View style={[styles.glowDot, { backgroundColor: theme.primary + '4d' }]} />
              )}
              <Ionicons name={iconName as any} size={22} color={iconColor} />
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: iconColor,
                    fontWeight: isActive ? '600' : '400',
                  },
                ]}
              >
                {tab.label}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabContent: {
    alignItems: 'center',
    gap: 2,
  },
  tabLabel: {
    fontSize: 11,
  },
  glowDot: {
    position: 'absolute',
    top: -4,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
