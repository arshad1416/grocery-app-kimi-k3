/**
 * ContextMenu — Long-press context menu overlay for list actions.
 *
 * Shows a positioned popup menu near the long-pressed card with:
 *  - "Delete List" (destructive, red)
 *  - "Share" (normal)
 *
 * Uses React Native's Modal with transparent background.
 * Tap outside dismisses.
 *
 * Fix: Uses Dimensions.get('window') for screen-relative clamping
 * instead of hardcoded pixel values (Bug 4).
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  TouchableWithoutFeedback,
  Dimensions,
} from 'react-native';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ContextMenuProps {
  visible: boolean;
  listName: string;
  onDelete: () => void;
  onShare: () => void;
  onRename?: () => void;
  onClose: () => void;
  theme: {
    cardBg: string;
    text: string;
    secondaryText: string;
    border: string;
  };
  /** Touch coordinates for positioning (optional — centers if not provided) */
  position?: { x: number; y: number };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MENU_WIDTH = 180;
const MENU_HEIGHT_ESTIMATE = 150; // Approximate menu height for clamping

// ─── Component ──────────────────────────────────────────────────────────────

export default function ContextMenu({
  visible,
  listName,
  onDelete,
  onShare,
  onRename,
  onClose,
  theme,
  position,
}: ContextMenuProps) {
  if (!visible) return null;

  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

  // Clamp position to stay within screen bounds (Bug 4 fix)
  const clampedPosition = position
    ? {
        top: Math.min(position.y, screenHeight - MENU_HEIGHT_ESTIMATE - 20),
        left: Math.min(position.x, screenWidth - MENU_WIDTH - 16),
      }
    : styles.menuCentered;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View
              style={[
                styles.menu,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.border,
                },
                clampedPosition,
              ]}
            >
              {/* Header — List name */}
              <View style={[styles.menuHeader, { borderBottomColor: theme.border }]}>
                <Text
                  style={[styles.menuHeaderText, { color: theme.text }]}
                  numberOfLines={1}
                >
                  {listName}
                </Text>
              </View>

              {/* Rename option */}
              {onRename ? (
                <>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => {
                      onClose();
                      setTimeout(onRename, 200);
                    }}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${listName}`}
                  >
                    <Text style={[styles.menuItemText, { color: theme.text }]}>
                      Rename
                    </Text>
                  </TouchableOpacity>
                  <View style={[styles.divider, { backgroundColor: theme.border }]} />
                </>
              ) : null}

              {/* Share option */}
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  onClose();
                  // Small delay so modal closes first
                  setTimeout(onShare, 200);
                }}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel={`Share ${listName}`}
              >
                <Text style={[styles.menuItemText, { color: theme.text }]}>
                  Share
                </Text>
              </TouchableOpacity>

              {/* Divider */}
              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              {/* Delete option */}
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  onClose();
                  // Small delay so modal closes first
                  setTimeout(onDelete, 200);
                }}
                activeOpacity={0.6}
              >
                <Text style={[styles.menuItemText, styles.destructiveText]}>
                  Delete List
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menu: {
    position: 'absolute',
    minWidth: MENU_WIDTH,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
    overflow: 'hidden',
  },
  menuCentered: {
    top: '40%',
    left: '25%',
  },
  menuHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuHeaderText: {
    fontSize: 14,
    fontWeight: '600',
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemText: {
    fontSize: 16,
  },
  destructiveText: {
    color: '#EF4444',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
