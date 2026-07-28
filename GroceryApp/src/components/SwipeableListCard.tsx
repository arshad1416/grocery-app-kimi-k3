/**
 * SwipeableListCard — List card with swipe-to-delete (iOS Mail style).
 *
 * Uses React Native's built-in PanResponder + Animated for horizontal
 * swipe animations without additional dependencies.
 *
 * Features:
 * - Swiping left reveals a red "Delete" action panel.
 * - Releasing past threshold (80px) triggers onDelete callback.
 * - Releasing before threshold springs back to rest position.
 * - Long-press triggers onLongPress for context menu.
 * - Fades out Share button during swipe to prevent overlap.
 *
 * Bug fix history:
 * - v1.26: Restructured to use flex row layout instead of absolute positioning
 *   so the delete panel is never visible behind the card at rest.
 */

import React, { useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  PanResponder,
  StyleSheet,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type LayoutChangeEvent,
} from 'react-native';
import { useActiveTheme } from '../state/useThemeStore';
import { themeColors } from './groceryTheme';

// ─── Constants ──────────────────────────────────────────────────────────────

const SWIPE_THRESHOLD = 80;
const DELETE_PANEL_WIDTH = 130;
const LONG_PRESS_MS = 500;

// ─── Props ──────────────────────────────────────────────────────────────────

interface SwipeableListCardProps {
  list: { id: string; name: string; description?: string; storePreference?: string };
  onPress: () => void;
  onDelete: () => void;
  onShare: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  deleteLabel?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function SwipeableListCard({
  list,
  onPress,
  onDelete,
  onShare,
  onLongPress,
  deleteLabel = 'Delete',
}: SwipeableListCardProps) {
  const theme = themeColors[useActiveTheme()];

  const translateX = useRef(new Animated.Value(0)).current;
  const isSwiping = useRef(false);
  const isLongPress = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs for callbacks to avoid stale closures in PanResponder
  const onDeleteRef = useRef(onDelete);
  const onPressRef = useRef(onPress);
  const onLongPressRef = useRef(onLongPress);
  onDeleteRef.current = onDelete;
  onPressRef.current = onPress;
  onLongPressRef.current = onLongPress;

  // Reset card to rest position
  const resetPosition = useCallback(() => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 200,
      friction: 20,
    }).start();
  }, [translateX]);

  // PanResponder for horizontal swipe — uses refs to avoid stale closures
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (
        _: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) => {
        return Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 10;
      },
      onPanResponderGrant: () => {
        isSwiping.current = false;
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      },
      onPanResponderMove: (
        _: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) => {
        if (gesture.dx < 0) {
          isSwiping.current = true;
          const value = Math.max(gesture.dx, -DELETE_PANEL_WIDTH - 20);
          translateX.setValue(value);
        }
      },
      onPanResponderRelease: (
        _: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) => {
        if (gesture.dx < -SWIPE_THRESHOLD) {
          Animated.spring(translateX, {
            toValue: -DELETE_PANEL_WIDTH,
            useNativeDriver: true,
            tension: 100,
            friction: 15,
          }).start();
        } else {
          resetPosition();
        }
      },
    }),
  ).current;

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    event.persist?.();
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      onLongPressRef.current?.(event);
    }, LONG_PRESS_MS);
  }, []);

  const handlePressOut = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePress = useCallback(() => {
    if (!isLongPress.current && !isSwiping.current) {
      onPressRef.current();
    }
    isLongPress.current = false;
  }, []);

  return (
    <View style={[styles.swipeContainer, { backgroundColor: theme.cardBg }]}>
      <Animated.View
        style={[
          styles.swipeRow,
          { transform: [{ translateX }] },
        ]}
        {...panResponder.panHandlers}
      >
        {/* Card content */}
        <TouchableOpacity
          style={[styles.cardTouchable, { backgroundColor: theme.cardBg }]}
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={0.8}
        >
          <View style={styles.cardInfo}>
            <Text style={[styles.cardName, { color: theme.text }]}>{list.name}</Text>
            {list.description ? (
              <Text style={[styles.cardDesc, { color: theme.secondaryText }]} numberOfLines={1}>
                {list.description}
              </Text>
            ) : null}
            {list.storePreference ? (
              <Text style={[styles.cardStore, { color: theme.secondaryText }]}>
                🏪 {list.storePreference}
              </Text>
            ) : null}
          </View>
          <Animated.View
            style={[
              styles.cardActions,
              {
                opacity: translateX.interpolate({
                  inputRange: [-80, 0],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            <TouchableOpacity
              style={[styles.shareBtn, { backgroundColor: theme.primary }]}
              onPress={onShare}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.shareBtnText}>Share</Text>
            </TouchableOpacity>
            <Text style={[styles.cardArrow, { color: theme.secondaryText }]}>›</Text>
          </Animated.View>
        </TouchableOpacity>

        {/* Delete action panel */}
        <TouchableOpacity
          style={[styles.deletePanel, { width: DELETE_PANEL_WIDTH }]}
          onPress={() => {
            onDeleteRef.current();
            resetPosition();
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.deletePanelText}>{deleteLabel}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  swipeContainer: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
  },
  swipeRow: {
    flexDirection: 'row',
    width: '100%',
  },
  deletePanel: {
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  deletePanelText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  cardTouchable: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  cardInfo: {
    flex: 1,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardDesc: {
    fontSize: 13,
    marginTop: 2,
  },
  cardStore: {
    fontSize: 12,
    marginTop: 2,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  shareBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  cardArrow: {
    fontSize: 20,
    fontWeight: '300',
  },
});
