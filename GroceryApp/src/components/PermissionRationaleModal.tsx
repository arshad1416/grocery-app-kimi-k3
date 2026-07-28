/**
 * PermissionRationaleModal — Reusable dialog for explaining why PantryRun
 * needs a device permission BEFORE showing the OS permission dialog.
 *
 * Usage:
 *   <PermissionRationaleModal
 *     visible={showModal}
 *     permission="camera"
 *     onAllow={async () => { await requestCameraPermission(); }}
 *     onDeny={() => setShowModal(false)}
 *   />
 *
 * Follows the existing privacy-note pattern from SettingsScreen.tsx.
 * Matches PantryRun's light/dark theme system.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Linking,
} from 'react-native';

import { useActiveTheme } from '../state/useThemeStore';

// ─── Permission Definitions ──────────────────────────────────────────────────

export type PermissionType = 'camera' | 'microphone' | 'notifications';

interface PermissionInfo {
  icon: string;
  title: string;
  reason: string;
  details: string[];
  privacyNote: string;
}

const PERMISSION_INFO: Record<PermissionType, PermissionInfo> = {
  camera: {
    icon: '📷',
    title: 'Camera Access',
    reason:
      'PantryRun needs camera access to scan barcodes and quickly add items to your grocery list.',
    details: [
      'Camera frames are processed in real-time for barcode detection',
      'No images are captured, saved, or transmitted',
      'Camera is only active while the scanner screen is open',
    ],
    privacyNote:
      'PantryRun never stores or shares camera images. All processing happens on your device.',
  },
  microphone: {
    icon: '🎤',
    title: 'Microphone Access',
    reason:
      'PantryRun needs microphone access so you can add grocery items using voice commands.',
    details: [
      'Voice is converted to text using your device\'s speech recognition',
      'No audio is recorded or stored by PantryRun',
      'Microphone is only active while the voice input button is pressed',
    ],
    privacyNote:
      'Voice processing happens on-device. No audio data leaves your phone.',
  },
  notifications: {
    icon: '🔔',
    title: 'Notification Permission',
    reason:
      'PantryRun uses notifications to remind you about shopping trips and list updates from family members.',
    details: [
      'Notifications are local — sent from the app on your device',
      'No remote push notifications through third-party services',
      'You can disable notifications at any time in system settings',
    ],
    privacyNote:
      'Notification data stays on your device. We do not use push notification services.',
  },
};

// ─── Theme Colors ────────────────────────────────────────────────────────────

import { themeColors } from './groceryTheme';

// ─── Component ───────────────────────────────────────────────────────────────

interface PermissionRationaleModalProps {
  visible: boolean;
  permission: PermissionType;
  onAllow: () => void;
  onDeny: () => void;
}

export default function PermissionRationaleModal({
  visible,
  permission,
  onAllow,
  onDeny,
}: PermissionRationaleModalProps) {
  const activeTheme = useActiveTheme();
  const isDark = activeTheme === 'dark';
  const theme = isDark ? themeColors.dark : themeColors.light;
  const info = PERMISSION_INFO[permission];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDeny}
    >
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {/* Icon */}
          <Text style={styles.icon}>{info.icon}</Text>

          {/* Title */}
          <Text style={[styles.title, { color: theme.text }]}>{info.title}</Text>

          {/* Reason */}
          <Text style={[styles.reason, { color: theme.secondaryText }]}>
            {info.reason}
          </Text>

          {/* Details */}
          <View style={styles.detailsList}>
            {info.details.map((detail, index) => (
              <View key={index} style={styles.detailRow}>
                <Text style={[styles.detailBullet, { color: theme.primary }]}>✓</Text>
                <Text style={[styles.detailText, { color: theme.secondaryText }]}>
                  {detail}
                </Text>
              </View>
            ))}
          </View>

          {/* Privacy Note (matches SettingsScreen privacyNote pattern) */}
          <View
            style={[
              styles.privacyNote,
              {
                backgroundColor: theme.noteBg,
                borderColor: theme.noteBorder,
              },
            ]}
          >
            <Text style={[styles.privacyNoteText, { color: theme.secondaryText }]}>
              🔒 {info.privacyNote}
            </Text>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.denyButton, { borderColor: theme.border }]}
              onPress={onDeny}
            >
              <Text style={[styles.buttonText, { color: theme.secondaryText }]}>
                Not Now
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.allowButton, { backgroundColor: theme.primary }]}
              onPress={onAllow}
            >
              <Text style={[styles.buttonText, { color: theme.primaryText }]}>
                Allow Access
              </Text>
            </TouchableOpacity>
          </View>

          {/* Settings link */}
          <TouchableOpacity
            style={styles.settingsLink}
            onPress={() => {
              onDeny();
              Linking.openSettings();
            }}
          >
            <Text style={[styles.settingsLinkText, { color: theme.secondaryText }]}>
              Manage in System Settings
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
  },
  icon: {
    fontSize: 48,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  reason: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  detailsList: {
    width: '100%',
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  detailBullet: {
    fontSize: 14,
    fontWeight: '700',
    marginRight: 8,
    marginTop: 1,
  },
  detailText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  privacyNote: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 20,
  },
  privacyNoteText: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  denyButton: {
    borderWidth: 1,
  },
  allowButton: {},
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  settingsLink: {
    marginTop: 12,
    paddingVertical: 4,
  },
  settingsLinkText: {
    fontSize: 12,
    textDecorationLine: 'underline',
  },
});
