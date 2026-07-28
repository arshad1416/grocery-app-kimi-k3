/**
 * DeleteConfirmationModal — "Are you sure?" dialog for list deletion.
 *
 * Shows the list name in the title with a warning about family-wide impact.
 * Cancel dismisses; Delete proceeds with the deletion.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface DeleteConfirmationModalProps {
  visible: boolean;
  listName: string;
  onCancel: () => void;
  onConfirm: () => void;
  theme: {
    cardBg: string;
    text: string;
    secondaryText: string;
    border: string;
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DeleteConfirmationModal({
  visible,
  listName,
  onCancel,
  onConfirm,
  theme,
}: DeleteConfirmationModalProps) {
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.dialog, { backgroundColor: theme.cardBg }]}>
              {/* Title */}
              <Text style={[styles.title, { color: theme.text }]}>
                Delete "{listName}"?
              </Text>

              {/* Body */}
              <Text style={[styles.body, { color: theme.secondaryText }]}>
                This will remove the list for all family members.
              </Text>

              {/* Buttons */}
              <View style={[styles.buttonRow, { borderTopColor: theme.border }]}>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton]}
                  onPress={onCancel}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.buttonText, { color: theme.text }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <View style={[styles.buttonDivider, { backgroundColor: theme.border }]} />

                <TouchableOpacity
                  style={[styles.button, styles.deleteButton]}
                  onPress={onConfirm}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.buttonText, styles.deleteButtonText]}>
                    Delete
                  </Text>
                </TouchableOpacity>
              </View>
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  dialog: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 15,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    paddingTop: 20,
    paddingHorizontal: 20,
    marginBottom: 6,
  },
  body: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    // No additional styles
  },
  deleteButton: {
    // No additional styles
  },
  buttonDivider: {
    width: StyleSheet.hairlineWidth,
  },
  buttonText: {
    fontSize: 17,
  },
  deleteButtonText: {
    color: '#EF4444',
    fontWeight: '600',
  },
});
