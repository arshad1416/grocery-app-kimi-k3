/**
 * FlyerScanFlow — end-to-end flyer scanning UI.
 *
 * Ties together the pieces that already existed but were never wired:
 *   1. Store picker (flyer prices are per-store; the extractor can't know
 *      which store a photographed flyer belongs to)
 *   2. CameraScanner in `flyer` capture mode (multi-page capture)
 *   3. processFlyerImage() pipeline (EXIF strip → RelayExtractor → confidence
 *      gate → image discard)
 *   4. flyerScanAdapter.submitScannedPrices() so prices surface through the
 *      normal price registry
 *
 * PRIVACY: the flyer image is sent to the relay's extract endpoint in
 * plaintext over TLS (EXIF-stripped). This channel is NOT zero-knowledge —
 * see src/pricing/relay-extractor.ts. The disclosure below is shown in the
 * store-picker step every time.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';

import CameraScanner from './CameraScanner';
import { processFlyerImage } from '../pricing/flyer-pipeline';
import { relayExtractor } from '../pricing/relay-extractor';
import { flyerScanAdapter } from '../pricing/flyer-scan';
import type { ScannedFlyerPrice } from '../pricing/flyer-types';
import { themeColors } from './groceryTheme';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface FlyerScanFlowProps {
  visible: boolean;
  onClose: () => void;
  /** Stores the user can attribute the flyer to (from availableStores). */
  stores: { storeId: string; storeName: string }[];
  /** Called after prices were submitted so the caller can refresh price state. */
  onComplete: (priceCount: number, storeName: string) => void;
  theme: typeof themeColors.light;
}

type Step = 'store' | 'capture' | 'processing' | 'done' | 'error';

// ─── Component ──────────────────────────────────────────────────────────────

export default function FlyerScanFlow({
  visible,
  onClose,
  stores,
  onComplete,
  theme,
}: FlyerScanFlowProps) {
  const [step, setStep] = useState<Step>('store');
  const [store, setStore] = useState<{ storeId: string; storeName: string } | null>(null);
  const [resultCount, setResultCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('store');
    setStore(null);
    setResultCount(0);
    setErrorMessage(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const handleImages = useCallback(
    async (images: string[]) => {
      if (!store) return;
      setStep('processing');
      try {
        const allPrices: ScannedFlyerPrice[] = [];
        let pipelineError: string | null = null;

        for (const uri of images) {
          const result = await processFlyerImage(uri, relayExtractor);
          if (result.error) pipelineError = result.error;
          // Attribute every extracted price to the user-selected store
          for (const price of result.prices) {
            allPrices.push({
              ...price,
              storeId: store.storeId,
              storeName: store.storeName,
            });
          }
        }

        if (allPrices.length === 0) {
          if (pipelineError) {
            console.warn('[flyer-scan] extraction error:', pipelineError);
          }
          setErrorMessage(
            "We couldn't read any prices from that photo. Try a sharper, well-lit shot of the flyer — or add the price manually.",
          );
          setStep('error');
          return;
        }

        await flyerScanAdapter.submitScannedPrices(allPrices);
        setResultCount(allPrices.length);
        setStep('done');
        onComplete(allPrices.length, store.storeName);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStep('error');
      }
    },
    [store, onComplete],
  );

  const renderStorePicker = () => (
    <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
      <Text style={[styles.title, { color: theme.text }]}>Scan a Store Flyer</Text>
      <Text style={[styles.subtitle, { color: theme.secondaryText }]}>
        Which store is this flyer from? Extracted prices are stored on this
        device and used for trip planning.
      </Text>
      <ScrollView style={styles.storeList}>
        {stores.map((s) => (
          <TouchableOpacity
            key={s.storeId}
            style={[styles.storeRow, { borderColor: theme.border }]}
            onPress={() => {
              setStore(s);
              setStep('capture');
            }}
          >
            <Text style={[styles.storeName, { color: theme.text }]}>{s.storeName}</Text>
          </TouchableOpacity>
        ))}
        {stores.length === 0 && (
          <Text style={[styles.subtitle, { color: theme.secondaryText }]}>
            No stores configured yet — add stores in price settings first.
          </Text>
        )}
      </ScrollView>
      <Text style={[styles.privacyNote, { color: theme.secondaryText }]}>
        Privacy: the flyer photo (with location metadata removed) is sent to
        your relay server for AI extraction, then discarded. Unlike list sync,
        the relay can see the flyer image contents.
      </Text>
      <TouchableOpacity style={[styles.cancelBtn, { borderColor: theme.border }]} onPress={handleClose}>
        <Text style={[styles.cancelText, { color: theme.secondaryText }]}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  const renderBody = () => {
    switch (step) {
      case 'store':
        return renderStorePicker();
      case 'capture':
        return (
          <CameraScanner
            captureMode="flyer"
            onScan={() => {}}
            onCancel={handleClose}
            onFlyerCapture={handleImages}
          />
        );
      case 'processing':
        return (
          <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.title, { color: theme.text, marginTop: 16 }]}>
              Reading flyer prices…
            </Text>
            <Text style={[styles.subtitle, { color: theme.secondaryText }]}>
              The AI extractor is scanning your photos for items and prices.
            </Text>
          </View>
        );
      case 'done':
        return (
          <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            <Text style={[styles.title, { color: theme.text }]}>
              {resultCount} price{resultCount === 1 ? '' : 's'} captured
            </Text>
            <Text style={[styles.subtitle, { color: theme.secondaryText }]}>
              Prices from {store?.storeName} are now used for price badges and
              trip planning on this device.
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
              onPress={handleClose}
            >
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        );
      case 'error':
        return (
          <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            <Text style={[styles.title, { color: theme.text }]}>Nothing extracted</Text>
            <Text style={[styles.subtitle, { color: theme.secondaryText }]}>{errorMessage}</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
              onPress={() => setStep('capture')}
            >
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.cancelBtn, { borderColor: theme.border }]} onPress={handleClose}>
              <Text style={[styles.cancelText, { color: theme.secondaryText }]}>Close</Text>
            </TouchableOpacity>
          </View>
        );
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={[styles.container, { backgroundColor: theme.bg }]}>{renderBody()}</View>
    </Modal>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: 'stretch',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  storeList: {
    marginTop: 16,
    maxHeight: 320,
  },
  storeRow: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  storeName: {
    fontSize: 16,
    fontWeight: '600',
  },
  privacyNote: {
    fontSize: 12,
    marginTop: 16,
    lineHeight: 16,
    textAlign: 'center',
  },
  primaryBtn: {
    marginTop: 20,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelBtn: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
