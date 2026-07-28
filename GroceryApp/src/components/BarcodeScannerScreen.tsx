/**
 * BarcodeScannerScreen — full-screen barcode scanner using expo-camera.
 *
 * Follows the same dynamic-require pattern as CameraScanner.tsx for
 * graceful fallback when expo-camera is not installed.
 *
 * Scans EAN-13, EAN-8, UPC-A, and UPC-E barcodes (the standard
 * formats for retail grocery items).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Props ───────────────────────────────────────────────────────────────────

interface BarcodeScannerScreenProps {
  onScan: (barcode: string) => void;
  onCancel: () => void;
}

// ─── Barcode Formats ─────────────────────────────────────────────────────────

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'qr'];

// ─── Component ───────────────────────────────────────────────────────────────

export default function BarcodeScannerScreen({
  onScan,
  onCancel,
}: BarcodeScannerScreenProps) {
  const insets = useSafeAreaInsets();

  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const scannedRef = useRef(false); // synchronous guard — prevents double-fires between renders
  const [scanned, setScanned] = useState(false); // UI-only state for displaying feedback

  // Check camera availability on mount
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const expoCamera = require('expo-camera');
        if (!mounted) return;

        // Newer expo-camera exposes permissions on CameraView; older versions on Camera
        const requestPermissions =
          expoCamera.CameraView?.requestCameraPermissionsAsync ??
          expoCamera.Camera?.requestCameraPermissionsAsync;

        if (expoCamera.CameraView && requestPermissions) {
          const { status } = await requestPermissions();
          if (!mounted) return;

          if (status === 'granted') {
            setHasCamera(true);
          } else {
            setHasCamera(false);
            setCameraError('Camera permission denied');
          }
        } else {
          setHasCamera(false);
        }
      } catch {
        if (mounted) {
          setHasCamera(false);
          setCameraError('Camera module not available');
        }
      }
    })();

    return () => { mounted = false; };
  }, []);

  // Handle barcode detection
  const handleBarCodeScanned = useCallback((scanResult: any) => {
    if (scannedRef.current) return;
    const data: string = scanResult?.data ?? '';
    if (data && /^\d{8,14}$/.test(data.trim())) {
      scannedRef.current = true;
      setScanned(true);
      onScan(data.trim());
    }
    // Silently ignore non-barcode data
  }, [onScan]);

  // Manual barcode entry
  const handleManualSubmit = useCallback(() => {
    const code = manualBarcode.replace(/\D/g, '').trim();
    if (code.length >= 8 && code.length <= 14) {
      onScan(code);
    }
  }, [manualBarcode, onScan]);

  // Handle manual text input change — strip non-digits
  const handleManualChange = useCallback((text: string) => {
    setManualBarcode(text.replace(/\D/g, ''));
  }, []);

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (hasCamera === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={styles.loadingText}>Starting camera...</Text>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Camera Available ────────────────────────────────────────────────────────

  if (hasCamera) {
    // Dynamic require so this doesn't crash if expo-camera isn't installed
    // Note: require() caches the module, so repeated calls are cheap, but we
    // cache the reference locally for clarity.
    let CameraView: any = null;
    try {
      const expoCamera = require('expo-camera');
      CameraView = expoCamera.CameraView;
    } catch {
      // Fall through to manual entry below
      return renderManualEntry();
    }

    return (
      <View style={styles.container}>
        <CameraView
          style={styles.cameraPreview}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
          onBarcodeScanned={handleBarCodeScanned}
        >
          <View style={styles.overlay}>
            {/* Scan frame */}
            <View style={styles.scanFrame}>
              <View style={styles.scanCornerTL} />
              <View style={styles.scanCornerTR} />
              <View style={styles.scanCornerBL} />
              <View style={styles.scanCornerBR} />
            </View>
            {scanned && (
              <Text style={styles.scannedText}>Barcode captured!</Text>
            )}
            {!scanned && (
              <Text style={styles.hintText}>
                Point camera at product barcode
              </Text>
            )}
          </View>
        </CameraView>

        {/* Controls */}
        <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity style={styles.controlBtn} onPress={onCancel}>
            <Text style={styles.controlBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.controlBtn, styles.manualBtn]}
            onPress={() => setHasCamera(false)}
          >
            <Text style={styles.manualBtnText}>Enter Code</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Camera Not Available — Manual Entry ──────────────────────────────────────

  function renderManualEntry() {
    return (
      <View style={styles.container}>
        <View style={styles.manualContainer}>
          <Text style={styles.manualTitle}>Enter Barcode</Text>
          <Text style={styles.manualDesc}>
            {cameraError
              ? cameraError
              : 'Camera not available. Enter the barcode number manually.'}
          </Text>

          <TextInput
            style={styles.manualInput}
            value={manualBarcode}
            onChangeText={handleManualChange}
            placeholder="e.g. 057123456789"
            placeholderTextColor="#94A3B8"
            keyboardType="number-pad"
            maxLength={14}
            autoFocus
          />

          <TouchableOpacity
            style={[
              styles.submitBtn,
              (manualBarcode.length < 8) && styles.submitBtnDisabled,
            ]}
            onPress={handleManualSubmit}
            disabled={manualBarcode.length < 8}
          >
            <Text style={styles.submitBtnText}>Look Up</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return renderManualEntry();
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraPreview: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  scanFrame: {
    width: 250,
    height: 160,
    position: 'relative',
  },
  scanCornerTL: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 30,
    height: 30,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: '#10B981',
  },
  scanCornerTR: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 30,
    height: 30,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: '#10B981',
  },
  scanCornerBL: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 30,
    height: 30,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: '#10B981',
  },
  scanCornerBR: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: '#10B981',
  },
  scannedText: {
    color: '#10B981',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 20,
  },
  hintText: {
    color: '#fff',
    fontSize: 14,
    marginTop: 20,
    opacity: 0.8,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: '#1a1a2e',
  },
  controlBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  controlBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  manualBtn: {
    backgroundColor: '#334155',
  },
  manualBtnText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '500',
  },
  // Manual entry fallback
  manualContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0B0F19',
  },
  manualTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 8,
  },
  manualDesc: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 20,
  },
  manualInput: {
    width: '100%',
    height: 56,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 24,
    fontWeight: '600',
    color: '#F8FAFC',
    textAlign: 'center',
    letterSpacing: 4,
    marginBottom: 16,
  },
  submitBtn: {
    width: '100%',
    height: 52,
    backgroundColor: '#10B981',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  submitBtnDisabled: {
    backgroundColor: '#334155',
    opacity: 0.5,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  cancelBtn: {
    padding: 12,
  },
  cancelBtnText: {
    color: '#94A3B8',
    fontSize: 16,
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 14,
    marginTop: 16,
  },
});
