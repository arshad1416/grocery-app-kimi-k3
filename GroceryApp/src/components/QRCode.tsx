import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import QRCodeSVG from 'react-native-qrcode-svg';

interface QRCodeProps {
  data: string;
  size?: number;
  testID?: string;
}

export default function QRCode({ data, size = 200, testID }: QRCodeProps) {
  if (!data) {
    return (
      <View style={styles.fallback} testID={testID}>
        <Text style={styles.fallbackText}>No data</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { width: size, height: size }]} testID={testID}>
      <QRCodeSVG value={data} size={size} backgroundColor="white" color="black" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
    overflow: 'hidden',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  fallbackText: {
    color: '#999',
    fontSize: 14,
  },
});