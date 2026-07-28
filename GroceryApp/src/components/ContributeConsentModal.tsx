/**
 * ContributeConsentModal — Privacy consent dialog for anonymous contributions.
 *
 * Phase F (Stage 3): Informed consent before enabling the contribution pipeline.
 *
 * This modal displays:
 *   - Exactly what data IS sent (§3-allowed fields)
 *   - What data is NEVER sent (deviceId, location, IP, name)
 *   - A choice of store granularity (chain+region vs exact branch)
 *
 * Design: plain-language, honest copy. No dark patterns. The user must
 * explicitly choose one of three options before dismissing the modal.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
} from 'react-native';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ContributeConsentModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** User confirmed with the given store granularity */
  onConfirm: (granularity: 'region' | 'branch') => void;
  /** User declined contribution entirely */
  onCancel: () => void;
  /** User declined but might want to revisit later (alternative to cancel) */
  onSkip: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Consent modal for the anonymous contribution feature.
 *
 * Displays exactly what is and isn't sent with the contributed price data,
 * and lets the user choose their preferred store granularity.
 */
export default function ContributeConsentModal({
  visible,
  onConfirm,
  onCancel,
  onSkip,
}: ContributeConsentModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
          >
            <Text style={styles.title}>Help Improve Prices for Everyone</Text>

            <Text style={styles.body}>
              When you scan a flyer, you can optionally share anonymized
              price information to a shared pool. Other users who search for
              the same items will benefit from prices you've seen.
            </Text>

            {/* ── What's Sent ──────────────────────────────────── */}
            <View style={styles.dataBox}>
              <Text style={styles.dataBoxTitle}>✓ What's sent:</Text>
              <Text style={styles.dataBoxText}>
                • Item name and normalized name{'\n'}
                • Price and unit price{'\n'}
                • Unit of measurement and size{'\n'}
                • Optional brand name{'\n'}
                • Optional regular price (if on sale){'\n'}
                • Sale end date (ISO week){'\n'}
                • Flyer week identifier{'\n'}
                • Store chain and region (see below)
              </Text>
            </View>

            {/* ── What's NEVER Sent ─────────────────────────────── */}
            <View style={[styles.dataBox, styles.dataBoxNever]}>
              <Text style={[styles.dataBoxTitle, styles.dataBoxTitleNever]}>
                ✗ NEVER sent:
              </Text>
              <Text style={styles.dataBoxTextNever}>
                • Your device ID{'\n'}
                • Your family ID{'\n'}
                • Your GPS location{'\n'}
                • Your IP address{'\n'}
                • Your name or account info{'\n'}
                • Exact scan time (coarsened to week){'\n'}
                • Exact store branch (unless you choose below)
              </Text>
            </View>

            <Text style={styles.body}>
              All timestamps are coarsened to ISO week granularity (e.g.
              "2026-W22") so that your precise scan time cannot be used
              for fingerprinting.
            </Text>

            {/* ── Granularity Choice ─────────────────────────────── */}
            <Text style={styles.choiceLabel}>
              How specific should the store information be?
            </Text>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => onConfirm('region')}
              accessibilityRole="button"
              accessibilityLabel="Share chain and region only"
            >
              <Text style={styles.primaryButtonText}>
                🌍 Chain + Region only (recommended)
              </Text>
              <Text style={styles.primaryButtonSubtext}>
                e.g. "Walmart — Toronto" — protects your exact branch
                location
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => onConfirm('branch')}
              accessibilityRole="button"
              accessibilityLabel="Include exact branch"
            >
              <Text style={styles.secondaryButtonText}>
                🏪 Include exact branch
              </Text>
              <Text style={styles.secondaryButtonSubtext}>
                e.g. "Walmart — 123 Main St." — more precise, but reveals
                your specific store
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.skipButton}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Scan for yourself only"
            >
              <Text style={styles.skipButtonText}>
                🔒 Scan for yourself only
              </Text>
              <Text style={styles.skipButtonSubtext}>
                No data shared. You can enable this later in Settings.
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    maxHeight: '90%',
    width: '100%',
    maxWidth: 440,
    overflow: 'hidden',
  },
  scrollArea: {
    flexGrow: 0,
  },
  scrollContent: {
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#222',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
    marginBottom: 12,
  },
  dataBox: {
    backgroundColor: '#e8f5e9',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  dataBoxTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2e7d32',
    marginBottom: 6,
  },
  dataBoxText: {
    fontSize: 13,
    color: '#2e7d32',
    lineHeight: 20,
  },
  dataBoxNever: {
    backgroundColor: '#fbe9e7',
  },
  dataBoxTitleNever: {
    color: '#c62828',
  },
  dataBoxTextNever: {
    fontSize: 13,
    color: '#c62828',
    lineHeight: 20,
  },
  choiceLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  primaryButtonSubtext: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 16,
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: '#4CAF50',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4CAF50',
    marginBottom: 4,
  },
  secondaryButtonSubtext: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    lineHeight: 16,
  },
  skipButton: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginBottom: 4,
  },
  skipButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  skipButtonSubtext: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    lineHeight: 16,
  },
});
