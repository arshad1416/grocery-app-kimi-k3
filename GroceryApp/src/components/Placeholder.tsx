/**
 * Stub component: Placeholder.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface PlaceholderProps {
  text?: string;
}

export default function Placeholder({ text = 'Coming soon' }: PlaceholderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    alignItems: 'center',
  },
  text: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
});