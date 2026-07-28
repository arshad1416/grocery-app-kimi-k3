/**
 * Privacy Screen — In-app privacy controls and data transparency.
 *
 * Accessible from Settings → Privacy.
 * Provides:
 *  - Summary of data practices
 *  - Crash reporting opt-out toggle
 *  - Price lookup opt-in with disclosure
 *  - Link to full privacy policy
 *  - Data deletion instructions
 *  - Links to Terms of Service
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  ScrollView,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';

import { getSettings, updateSettings } from '../config/settings';
import { useThemeStore, useActiveTheme } from '../state/useThemeStore';
import type { AppSettings } from '../types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/deepLinks';

import { themeColors } from '../components/groceryTheme';

// ─── Section Component ───────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  children: React.ReactNode;
  theme: typeof themeColors.light;
}

function Section({ title, children, theme }: SectionProps) {
  return (
    <View style={[styles.section, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
      {children}
    </View>
  );
}

// ─── Info Row ────────────────────────────────────────────────────────────────

interface InfoRowProps {
  icon: string;
  label: string;
  description: string;
  theme: typeof themeColors.light;
}

function InfoRow({ icon, label, description, theme }: InfoRowProps) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoIcon}>{icon}</Text>
      <View style={styles.infoContent}>
        <Text style={[styles.infoLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.infoDescription, { color: theme.secondaryText }]}>
          {description}
        </Text>
      </View>
    </View>
  );
}

// ─── Toggle Row ──────────────────────────────────────────────────────────────

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  theme: typeof themeColors.light;
}

function ToggleRow({ label, description, value, onValueChange, theme }: ToggleRowProps) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleTextContainer}>
        <Text style={[styles.toggleLabel, { color: theme.text }]}>{label}</Text>
        {description && (
          <Text style={[styles.toggleDescription, { color: theme.secondaryText }]}>
            {description}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.border, true: '#10B981' }}
        thumbColor={value ? '#fff' : '#f4f3f4'}
      />
    </View>
  );
}

// ─── Link Row ────────────────────────────────────────────────────────────────

interface LinkRowProps {
  icon: string;
  label: string;
  onPress: () => void;
  theme: typeof themeColors.light;
  danger?: boolean;
}

function LinkRow({ icon, label, onPress, theme, danger }: LinkRowProps) {
  return (
    <TouchableOpacity style={styles.linkRow} onPress={onPress}>
      <Text style={styles.infoIcon}>{icon}</Text>
      <Text style={[styles.linkLabel, { color: danger ? theme.danger : theme.text }]}>
        {label}
      </Text>
      <Text style={[styles.linkArrow, { color: theme.secondaryText }]}>›</Text>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<RootStackParamList, 'Privacy'>;

const PRIVACY_URL = 'https://groceryapp.app/privacy';
const TERMS_URL = 'https://groceryapp.app/privacy#terms';

export default function PrivacyScreen({ navigation }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loaded, setLoaded] = useState(false);

  const activeTheme = useActiveTheme();
  const isDark = activeTheme === 'dark';
  const theme = isDark ? themeColors.dark : themeColors.light;

  useEffect(() => {
    const s = getSettings();
    setSettings(s);
    setLoaded(true);
  }, []);

  const handleUpdate = async (partial: Partial<AppSettings>) => {
    const updated = await updateSettings(partial);
    setSettings(updated);
  };

  if (!loaded || !settings) {
    return (
      <View style={[styles.container, { backgroundColor: theme.bg }]}>
        <Text style={[styles.loadingText, { color: theme.secondaryText }]}>Loading...</Text>
      </View>
    );
  }

  // Sentry is enabled unless explicitly disabled
  const sentryEnabled = settings.sentryEnabled !== false;

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: theme.primary }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>Privacy</Text>
      </View>

      <Text style={[styles.tagline, { color: theme.secondaryText }]}>
        StopHop is privacy-first. Your data stays on your device.
      </Text>

      {/* ── Data Practices Summary ──────────────────────────────────── */}
      <Section title="How Your Data Is Handled" theme={theme}>
        <InfoRow
          icon="🔒"
          label="Encrypted Storage"
          description="All grocery data is encrypted with XChaCha20-Poly1305 and stored locally on your device."
          theme={theme}
        />
        <InfoRow
          icon="👨‍👩‍👧‍👦"
          label="Family Sync"
          description="Syncs through your self-hosted or managed relay. List data is end-to-end encrypted — the relay can't read it. The relay briefly stores the encrypted updates (auto-deleted after 30 days) so offline devices can catch up."
          theme={theme}
        />
        <InfoRow
          icon="🗞️"
          label="Flyer Scanning"
          description="Optional. Flyer photos you take are sent to your relay for AI price extraction (location metadata removed, image discarded after). Unlike list sync, the relay can see flyer photo contents — self-host to keep them in your network."
          theme={theme}
        />
        <InfoRow
          icon="🚫"
          label="No Central Servers"
          description="StopHop doesn't collect or store your grocery data on our servers."
          theme={theme}
        />
        <InfoRow
          icon="🔑"
          label="Secure Keys"
          description="Encryption keys and pairing codes are stored in your device's secure enclave."
          theme={theme}
        />
      </Section>

      {/* ── Permissions ─────────────────────────────────────────────── */}
      <Section title="Device Permissions" theme={theme}>
        <InfoRow
          icon="📷"
          label="Camera"
          description="Used for barcode scanning, QR pairing, and optional flyer photos. Barcode/QR frames are processed in real-time and discarded; flyer photos are sent to your relay for extraction, then discarded."
          theme={theme}
        />
        <InfoRow
          icon="🎤"
          label="Microphone"
          description="Used only for voice input (when enabled). Audio is processed on-device."
          theme={theme}
        />
        <InfoRow
          icon="🔔"
          label="Notifications"
          description="Used for local shopping reminders only. No remote push notifications."
          theme={theme}
        />
      </Section>

      {/* ── Opt-In Controls ─────────────────────────────────────────── */}
      <Section title="Privacy Controls" theme={theme}>
        <ToggleRow
          label="Crash Reporting"
          description="Anonymous crash data sent to Sentry. No personal or grocery data included."
          value={sentryEnabled}
          onValueChange={async (v) => {
            if (!v) {
              Alert.alert(
                'Disable Crash Reporting?',
                'Anonymous crash reports help us fix bugs. No personal data is included. You can re-enable this anytime.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Disable',
                    onPress: () => handleUpdate({ sentryEnabled: false }),
                  },
                ],
              );
            } else {
              await handleUpdate({ sentryEnabled: true });
            }
          }}
          theme={theme}
        />

        <ToggleRow
          label="Price Lookups"
          description="Sends hashed item names to price sources. Your actual item names are never sent."
          value={settings.pricingOptedIn ?? false}
          onValueChange={async (v) => {
            if (v) {
              Alert.alert(
                'Enable Price Lookups?',
                'Normalized, hashed item names will be sent to price sources to fetch approximate prices. Your shopping habits are not tracked. You can disable this anytime.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Enable',
                    onPress: () => handleUpdate({ pricingOptedIn: true }),
                  },
                ],
              );
            } else {
              await handleUpdate({ pricingOptedIn: false });
            }
          }}
          theme={theme}
        />
      </Section>

      {/* ── Data Deletion ───────────────────────────────────────────── */}
      <Section title="Data Deletion" theme={theme}>
        <Text style={[styles.bodyText, { color: theme.secondaryText }]}>
          Since StopHop stores data locally on your device:
        </Text>
        <View style={styles.bulletList}>
          <Text style={[styles.bulletItem, { color: theme.secondaryText }]}>
            • <Text style={{ fontWeight: '600', color: theme.text }}>Delete all data:</Text> Uninstall the app
          </Text>
          <Text style={[styles.bulletItem, { color: theme.secondaryText }]}>
            • <Text style={{ fontWeight: '600', color: theme.text }}>Clear price data:</Text> Settings → Pricing → Clear Local Prices
          </Text>
          <Text style={[styles.bulletItem, { color: theme.secondaryText }]}>
            • <Text style={{ fontWeight: '600', color: theme.text }}>Leave family:</Text> Unpair your device to remove synced data from relay
          </Text>
          <Text style={[styles.bulletItem, { color: theme.secondaryText }]}>
            • <Text style={{ fontWeight: '600', color: theme.text }}>Managed relay deletion:</Text> Email{' '}
            <Text
              style={{ color: theme.primary }}
              onPress={() => Linking.openURL('mailto:privacy@groceryapp.app')}
            >
              privacy@groceryapp.app
            </Text>
          </Text>
        </View>
      </Section>

      {/* ── Links ───────────────────────────────────────────────────── */}
      <Section title="Legal" theme={theme}>
        <LinkRow
          icon="📄"
          label="Full Privacy Policy"
          onPress={() => Linking.openURL(PRIVACY_URL)}
          theme={theme}
        />
        <LinkRow
          icon="📜"
          label="Terms of Service"
          onPress={() => Linking.openURL(TERMS_URL)}
          theme={theme}
        />
        <LinkRow
          icon="✉️"
          label="Contact: privacy@groceryapp.app"
          onPress={() => Linking.openURL('mailto:privacy@groceryapp.app')}
          theme={theme}
        />
      </Section>

      {/* ── Version Info ────────────────────────────────────────────── */}
      <View style={styles.versionContainer}>
        <Text style={[styles.versionText, { color: theme.secondaryText }]}>
          StopHop v1.03 · Privacy-first grocery lists
        </Text>
      </View>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  backBtn: {
    paddingRight: 8,
    paddingVertical: 4,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  tagline: {
    fontSize: 14,
    paddingHorizontal: 20,
    paddingBottom: 12,
    lineHeight: 20,
  },
  section: {
    margin: 12,
    marginTop: 4,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  infoIcon: {
    fontSize: 20,
    marginRight: 12,
    marginTop: 1,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  infoDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  toggleTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  toggleDescription: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
  },
  linkLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  linkArrow: {
    fontSize: 20,
    fontWeight: '300',
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  bulletList: {
    paddingLeft: 4,
  },
  bulletItem: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 6,
  },
  versionContainer: {
    alignItems: 'center',
    paddingTop: 16,
  },
  versionText: {
    fontSize: 12,
  },
  bottomSpacer: {
    height: 40,
  },
});
