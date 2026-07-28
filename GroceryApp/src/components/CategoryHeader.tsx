/**
 * CategoryHeader — Renders a category name, item count, and optional subtotal.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useActiveTheme } from '../state/useThemeStore';
import { themeColors, getCategoryColor } from './groceryTheme';

interface CategoryHeaderProps {
  category: string;
  count: number;
  subtotal?: number;
}

export default function CategoryHeader({ category, count, subtotal }: CategoryHeaderProps) {
  const activeTheme = useActiveTheme();
  const theme = activeTheme === 'dark' ? themeColors.dark : themeColors.light;
  const color = getCategoryColor(category);

  return (
    <View style={[styles.categoryHeader, { borderLeftColor: color, backgroundColor: theme.cardBg }]}>
      <Text style={[styles.categoryTitle, { color }]}>
        {category.charAt(0).toUpperCase() + category.slice(1)}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {subtotal !== undefined && (
          <Text style={{ fontSize: 13, fontWeight: '600', color: theme.primary, marginRight: 10 }}>
            Subtotal: ${subtotal.toFixed(2)}
          </Text>
        )}
        <Text style={[styles.categoryCount, { color: theme.secondaryText }]}>{count}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 4,
    borderLeftWidth: 3,
    marginLeft: 12,
    backgroundColor: '#fff',
    borderRadius: 4,
    marginRight: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  categoryTitle: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  categoryCount: {
    fontSize: 12,
    color: '#999',
    fontWeight: '600',
  },
});
