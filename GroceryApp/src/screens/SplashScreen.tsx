/**
 * SplashScreen — Branded splash with grocery bag logo, "PantryRun" bold font,
 * "Your Intelligent Grocery Path" tagline.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

interface SplashScreenProps {
  onFinish: () => void;
}

export default function SplashScreen({ onFinish }: SplashScreenProps) {
  const fadeAnim = new Animated.Value(0);
  const scaleAnim = new Animated.Value(0.8);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // Just long enough for the 800ms intro animation to land — not a hard 2s
    // stall on top of app init.
    const timer = setTimeout(onFinish, 1100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.logoContainer,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Grocery bag illustration built with shapes */}
        <View style={styles.bagContainer}>
          {/* Bag body — orange */}
          <View style={styles.bagBody}>
            {/* Bag handles */}
            <View style={styles.handleLeft} />
            <View style={styles.handleRight} />
            {/* Items peeking out */}
            <View style={styles.itemsRow}>
              {/* Tomato */}
              <View style={styles.tomato}>
                <View style={styles.tomatoLeaf} />
              </View>
              {/* Carrot */}
              <View style={styles.carrot}>
                <View style={styles.carrotTop} />
              </View>
              {/* Leaf */}
              <View style={styles.leaf}>
                <View style={styles.leafStem} />
              </View>
            </View>
          </View>
          {/* Bag base shadow */}
          <View style={styles.bagShadow} />
        </View>
      </Animated.View>

      <Animated.View style={{ opacity: fadeAnim, alignItems: 'center' }}>
        <Text style={styles.title}>PantryRun</Text>
        <Text style={styles.subtitle}>Your Intelligent Grocery Path</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6F3', // Soft organic sage-white backdrop
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    marginBottom: 32,
  },
  bagContainer: {
    alignItems: 'center',
  },
  bagBody: {
    width: 100,
    height: 80,
    backgroundColor: '#C69C6D', // Organic kraft paper bag color
    borderRadius: 12,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'visible',
    alignItems: 'center',
    position: 'relative',
  },
  handleLeft: {
    position: 'absolute',
    top: -14,
    left: 20,
    width: 20,
    height: 20,
    borderWidth: 3,
    borderColor: '#A07C55', // Darker kraft paper handle
    borderBottomWidth: 0,
    borderRadius: 10,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  handleRight: {
    position: 'absolute',
    top: -14,
    right: 20,
    width: 20,
    height: 20,
    borderWidth: 3,
    borderColor: '#A07C55',
    borderBottomWidth: 0,
    borderRadius: 10,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  itemsRow: {
    flexDirection: 'row',
    marginTop: -8,
    gap: 6,
    alignItems: 'flex-end',
  },
  tomato: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#E53935',
    position: 'relative',
  },
  tomatoLeaf: {
    position: 'absolute',
    top: -4,
    left: 7,
    width: 8,
    height: 5,
    backgroundColor: '#7CB342',
    borderRadius: 3,
  },
  carrot: {
    width: 8,
    height: 24,
    backgroundColor: '#FF8F00',
    borderRadius: 4,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    position: 'relative',
  },
  carrotTop: {
    position: 'absolute',
    top: -6,
    left: 1,
    width: 6,
    height: 8,
    backgroundColor: '#7CB342',
    borderRadius: 3,
  },
  leaf: {
    width: 18,
    height: 24,
    backgroundColor: '#7CB342',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    position: 'relative',
  },
  leafStem: {
    position: 'absolute',
    bottom: 0,
    left: 8,
    width: 2,
    height: 8,
    backgroundColor: '#4A7C59',
  },
  bagShadow: {
    width: 90,
    height: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    borderRadius: 3,
    marginTop: 4,
  },
  title: {
    fontSize: 48,
    fontWeight: '800',
    color: '#1A1A1A',
    letterSpacing: -1,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '400',
    color: '#6B7B6F',
    textAlign: 'center',
    marginTop: 4,
  },
});
