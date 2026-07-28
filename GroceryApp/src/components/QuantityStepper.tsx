/**
 * QuantityStepper — Inline [−] [qty] [+] buttons for item quantity.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useActiveTheme } from '../state/useThemeStore';
import { themeColors } from './groceryTheme';

interface QuantityStepperProps {
  quantity: number;
  unit: string;
  onIncrement: () => void;
  onDecrement: () => void;
}

export default function QuantityStepper({
  quantity,
  unit,
  onIncrement,
  onDecrement,
}: QuantityStepperProps) {
  const activeTheme = useActiveTheme();
  const isDark = activeTheme === 'dark';
  const theme = isDark ? themeColors.dark : themeColors.light;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[
          styles.btn,
          {
            backgroundColor: theme.btnBg,
            borderColor: theme.border,
          },
        ]}
        onPress={onDecrement}
        activeOpacity={0.6}
      >
        <Ionicons name="remove" size={16} color={theme.btnText} />
      </TouchableOpacity>
      <Text style={[styles.qtyText, { color: theme.text }]}>
        {quantity} {unit}
      </Text>
      <TouchableOpacity
        style={[
          styles.btn,
          {
            backgroundColor: theme.btnBg,
            borderColor: theme.border,
          },
        ]}
        onPress={onIncrement}
        activeOpacity={0.6}
      >
        <Ionicons name="add" size={16} color={theme.btnText} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  qtyText: {
    fontSize: 13,
    fontWeight: '600',
    minWidth: 36,
    textAlign: 'center',
  },
});
