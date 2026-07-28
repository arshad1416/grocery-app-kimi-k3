/**
 * SearchBar — Prominent search bar at top of list screen.
 * Glass background in dark mode, warm tinted in light mode.
 */

import React from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useActiveTheme } from '../state/useThemeStore';
import { themeColors } from './groceryTheme';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export default function SearchBar({ value, onChangeText, placeholder }: SearchBarProps) {
  const activeTheme = useActiveTheme();
  const isDark = activeTheme === 'dark';
  const theme = isDark ? themeColors.dark : themeColors.light;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#F5F0E8',
          borderColor: isDark ? 'rgba(0, 230, 118, 0.1)' : 'rgba(0, 0, 0, 0.06)',
        },
      ]}
    >
      <Ionicons
        name="search"
        size={18}
        color={isDark ? '#5A6B78' : '#9CA89E'}
        style={styles.searchIcon}
      />
      <TextInput
        style={[styles.input, { color: theme.text }]}
        placeholder={placeholder ?? 'Search groceries...'}
        placeholderTextColor={isDark ? '#5A6B78' : '#9CA89E'}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
      />
      {value.length > 0 && (
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={() => onChangeText('')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close-circle" size={18} color={isDark ? '#5A6B78' : '#9CA89E'} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
  },
  clearBtn: {
    marginLeft: 8,
    padding: 4,
  },
});
