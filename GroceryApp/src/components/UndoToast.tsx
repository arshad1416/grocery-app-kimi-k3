/**
 * UndoToast — Slide-up toast with Undo button and auto-dismiss.
 *
 * Props:
 *  - message: display text (e.g. "Milk ✓ checked off")
 *  - onUndo: called when user taps Undo
 *  - duration: auto-dismiss timeout in ms (default 5000)
 *  - onDismiss: called when toast disappears (auto or manual)
 *
 * Fixes applied:
 * - Stale closure: PanResponder uses refs for dismiss/onUndo callbacks
 * - Toast properly animates in/out with dark theme support
 */

import React, { useEffect, useRef, useCallback } from 'react';
import {
  Animated,
  Text,
  TouchableOpacity,
  StyleSheet,
  PanResponder,
} from 'react-native';

interface UndoToastProps {
  message: string;
  /** Omit for a plain confirmation toast with no Undo action. */
  onUndo?: () => void;
  duration?: number;
  onDismiss: () => void;
}

export default function UndoToast({
  message,
  onUndo,
  duration = 5000,
  onDismiss,
}: UndoToastProps) {
  const slideAnim = useRef(new Animated.Value(100)).current; // off-screen bottom
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panY = useRef(new Animated.Value(0)).current;

  // Refs for callbacks to avoid stale closures in PanResponder
  const onDismissRef = useRef(onDismiss);
  const onUndoRef = useRef(onUndo);

  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => { onUndoRef.current = onUndo; }, [onUndo]);

  const dismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 100,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismissRef.current();
    });
  }, [slideAnim, opacityAnim]);

  const handleUndo = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    onUndoRef.current?.();
    // Animate out immediately
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 100,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismissRef.current();
    });
  }, [slideAnim, opacityAnim]);

  // Slide in on mount + auto-dismiss timer
  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        damping: 15,
        stiffness: 200,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto-dismiss timer
    dismissTimer.current = setTimeout(() => {
      dismiss();
    }, duration);

    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swipe to dismiss — uses refs for stale closure safety
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy < 0) {
          panY.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy < -40) {
          // Use dismiss via a timeout to avoid stale closure;
          // we call dismissRef pattern indirectly through the timer
          if (dismissTimer.current) clearTimeout(dismissTimer.current);
          Animated.parallel([
            Animated.timing(slideAnim, {
              toValue: 100,
              duration: 250,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start(() => {
            onDismissRef.current();
          });
        } else {
          Animated.spring(panY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [
            { translateY: slideAnim },
            { translateY: panY },
          ],
          opacity: opacityAnim,
        },
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        style={styles.toastTouchable}
        onPress={dismiss}
        activeOpacity={0.9}
      >
        <Text style={styles.message} numberOfLines={1}>
          {message}
        </Text>
        {onUndo ? (
          <TouchableOpacity
            style={styles.undoButton}
            onPress={handleUndo}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Undo"
          >
            <Text style={styles.undoText}>Undo</Text>
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 90, // above FAB
    left: 16,
    right: 16,
    zIndex: 1000,
    elevation: 10,
  },
  toastTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#323232',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  message: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    marginRight: 12,
  },
  undoButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  undoText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
