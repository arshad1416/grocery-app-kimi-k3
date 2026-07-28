/**
 * CameraScanner — QR code scanner using expo-camera with fallback.
 *
 * Design:
 *  - Attempts to dynamically require expo-camera for barcode scanning
 *  - Graceful fallback if expo-camera is not installed
 *  - Scans for QR codes containing `grocceryapp://invite?token=`
 *  - Parses the token from scanned URL and calls onScan
 *
 * Props:
 *  - onScan(token: string) — called when a valid QR code is scanned
 *  - onCancel() — called when the user taps cancel/back
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Image,
  ScrollView,
  Alert,
} from 'react-native';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface CameraScannerProps {
  /** Called when a valid QR code containing an invite URL is scanned. */
  onScan: (token: string) => void;
  /** Called when the user cancels scanning. */
  onCancel: () => void;
  /** Capture mode: 'qr' (default) for QR scanning, 'flyer' for flyer photo capture. */
  captureMode?: 'qr' | 'flyer';
  /** Called in flyer mode when the user finishes capturing flyer pages. */
  onFlyerCapture?: (images: string[]) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

import { parseInviteUrl } from '../setup/invite-url';
export { parseInviteUrl };

// ─── Helper ─────────────────────────────────────────────────────────────────

// parseInviteUrl lives in src/setup/invite-url.ts (pure module, testable
// without the react-native runtime) and is re-exported above for callers
// that import it from here.

// ─── Camera Module Detection ────────────────────────────────────────────────

interface ExpoCameraModule {
  CameraView?: any;
  Camera?: {
    requestCameraPermissionsAsync: () => Promise<{ status: string }>;
  };
}

/**
 * Try to load the expo-camera module via require.
 * Returns null if the module is not available.
 */
function tryLoadExpoCamera(): ExpoCameraModule | null {
  try {
    // @ts-ignore — expo-camera may not be installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-camera');
    return mod;
  } catch {
    return null;
  }
}

// ─── CameraScanner Component ────────────────────────────────────────────────

/**
 * QR code camera scanner with expo-camera fallback.
 *
 * If expo-camera is installed, it renders a live camera preview
 * with barcode scanning. If not, it shows a manual input fallback.
 */
export default function CameraScanner({
  onScan,
  onCancel,
  captureMode = 'qr',
  onFlyerCapture,
}: CameraScannerProps) {
  const [cameraType, setCameraType] = useState<'front' | 'back'>('back');
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  // ─── Flyer-mode state ────────────────────────────────────────────────────
  const [capturedImages, setCapturedImages] = useState<string[]>([]);

  const isFlyerMode = captureMode === 'flyer';

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const expoCamera = tryLoadExpoCamera();
        if (!mounted) return;

        if (!expoCamera) {
          setHasCamera(false);
          return;
        }

        // Check if CameraView is available and permissions
        if (expoCamera.CameraView && expoCamera.Camera?.requestCameraPermissionsAsync) {
          const { status } = await expoCamera.Camera.requestCameraPermissionsAsync();
          if (!mounted) return;

          if (status === 'granted') {
            setHasCamera(true);
          } else {
            setHasCamera(false);
            setError('Camera permission denied');
          }
        } else {
          setHasCamera(false);
        }
      } catch {
        // expo-camera is not installed
        if (mounted) {
          setHasCamera(false);
          setError('Camera module not available. Enter pairing code manually.');
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Handle barcode scanning from expo-camera
  const handleBarCodeScanned = useCallback(
    (scanningResult: any) => {
      const data: string = scanningResult?.data ?? '';
      if (!data) return;

      const token = parseInviteUrl(data);
      if (token) {
        onScan(token);
      }
      // Silently ignore non-invite QR codes
    },
    [onScan],
  );

  // Handle manual token submission
  const handleManualSubmit = useCallback(() => {
    const trimmed = manualToken.trim();
    if (!trimmed) return;

    // If user pasted a full URL, extract the token
    const parsed = parseInviteUrl(trimmed);
    if (parsed) {
      onScan(parsed);
    } else {
      // Treat the input as a raw token
      onScan(trimmed);
    }
  }, [manualToken, onScan]);

  // ─── Flyer Capture Handlers ────────────────────────────────────────────────

  // A real photo was captured by the CameraView (via its ref, in the wrapper).
  const handleImageCaptured = useCallback((uri: string) => {
    setCapturedImages((prev) => [...prev, uri]);
  }, []);

  // Fallback: pick flyer photos from the library. Used when the live camera
  // capture fails or is unavailable. Best-effort — expo-image-picker is an
  // optional dependency; if it isn't installed we tell the user honestly
  // instead of silently pushing a placeholder that always fails extraction.
  const pickFromLibrary = useCallback(async () => {
    let ImagePicker: any;
    try {
      // @ts-ignore — expo-image-picker may not be installed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ImagePicker = require('expo-image-picker');
    } catch {
      Alert.alert(
        'Camera unavailable',
        "Couldn't capture the flyer, and the photo library picker isn't available on this build. Try again, or add the item price manually.",
      );
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync?.();
      if (perm && perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo access to pick a flyer image.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.length) {
        setCapturedImages((prev) => [...prev, ...result.assets.map((a: any) => a.uri)]);
      }
    } catch (err) {
      Alert.alert(
        'Could not add photo',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  }, []);

  // Called by the wrapper when live capture throws — auto-fall back to library.
  const handleCaptureError = useCallback(() => {
    pickFromLibrary();
  }, [pickFromLibrary]);

  const handleFlyerDone = useCallback(() => {
    if (onFlyerCapture && capturedImages.length > 0) {
      onFlyerCapture(capturedImages);
    }
  }, [capturedImages, onFlyerCapture]);

  const handleFlyerCancel = useCallback(() => {
    setCapturedImages([]);
    onCancel();
  }, [onCancel]);

  const handleRemoveCaptured = useCallback(
    (index: number) => {
      setCapturedImages((prev) => prev.filter((_, i) => i !== index));
    },
    [],
  );

  // Show loading while checking camera availability
  if (hasCamera === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Initializing camera...</Text>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Camera available — show live preview with barcode scanning or flyer capture
  if (hasCamera) {
    if (isFlyerMode) {
      return (
        <View style={styles.container}>
          <CameraViewWrapper
            cameraType={cameraType}
            onBarCodeScanned={undefined}
            onCancel={handleFlyerCancel}
            onToggleCamera={() =>
              setCameraType((prev) => (prev === 'back' ? 'front' : 'back'))
            }
            flyerMode
            onImageCaptured={handleImageCaptured}
            onCaptureError={handleCaptureError}
            onPickFromLibrary={pickFromLibrary}
          />
          {/* Thumbnail strip */}
          {capturedImages.length > 0 && (
            <View style={styles.thumbnailStripContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.thumbnailStrip}
              >
                {capturedImages.map((uri, index) => (
                  <View key={index} style={styles.thumbnailWrapper}>
                    <Image source={{ uri }} style={styles.thumbnail} />
                    <TouchableOpacity
                      style={styles.thumbnailRemove}
                      onPress={() => handleRemoveCaptured(index)}
                    >
                      <Text style={styles.thumbnailRemoveText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.flyerActions}>
                <TouchableOpacity
                  style={styles.flyerActionBtn}
                  onPress={handleFlyerCancel}
                >
                  <Text style={styles.flyerActionBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.flyerActionBtn, styles.flyerActionBtnPrimary]}
                  onPress={handleFlyerDone}
                >
                  <Text style={[styles.flyerActionBtnText, styles.flyerActionBtnTextPrimary]}>
                    Done ({capturedImages.length})
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      );
    }

    return (
      <View style={styles.container}>
        <CameraViewWrapper
          cameraType={cameraType}
          onBarCodeScanned={handleBarCodeScanned}
          onCancel={onCancel}
          onToggleCamera={() =>
            setCameraType((prev) => (prev === 'back' ? 'front' : 'back'))
          }
        />
      </View>
    );
  }

  // Fallback: camera not available — show manual input or photo picker
  if (isFlyerMode) {
    return (
      <View style={styles.container}>
        <View style={styles.fallbackBox}>
          <Text style={styles.fallbackTitle}>Capture Flyer Pages</Text>
          <Text style={styles.fallbackDescription}>
            {error || 'Camera not available. Select flyer images from your photo library.'}
          </Text>

          <TouchableOpacity
            style={styles.submitBtn}
            onPress={pickFromLibrary}
            accessibilityRole="button"
            accessibilityLabel="Select flyer images from library"
          >
            <Text style={styles.submitBtnText}>Select Images</Text>
          </TouchableOpacity>

          {/* Thumbnail strip for selected images */}
          {capturedImages.length > 0 && (
            <View style={styles.fallbackThumbnailContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.thumbnailStrip}
              >
                {capturedImages.map((uri, index) => (
                  <View key={index} style={styles.thumbnailWrapper}>
                    <Image source={{ uri }} style={styles.thumbnail} />
                    <TouchableOpacity
                      style={styles.thumbnailRemove}
                      onPress={() => handleRemoveCaptured(index)}
                    >
                      <Text style={styles.thumbnailRemoveText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.flyerActions}>
                <TouchableOpacity
                  style={styles.flyerActionBtn}
                  onPress={handleFlyerCancel}
                >
                  <Text style={styles.flyerActionBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.flyerActionBtn, styles.flyerActionBtnPrimary]}
                  onPress={handleFlyerDone}
                >
                  <Text style={[styles.flyerActionBtnText, styles.flyerActionBtnTextPrimary]}>
                    Done ({capturedImages.length})
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.cancelBtn} onPress={handleFlyerCancel}>
          <Text style={styles.cancelBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.fallbackBox}>
        <Text style={styles.fallbackTitle}>Camera Not Available</Text>
        <Text style={styles.fallbackDescription}>
          {error || 'Camera module not available. Enter pairing code manually.'}
        </Text>

        <TextInput
          style={styles.manualInput}
          value={manualToken}
          onChangeText={setManualToken}
          placeholder="Paste invite URL or token"
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity
          style={styles.submitBtn}
          onPress={handleManualSubmit}
        >
          <Text style={styles.submitBtnText}>Submit</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
        <Text style={styles.cancelBtnText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── CameraView Wrapper ─────────────────────────────────────────────────────

/**
 * Separate component that renders expo-camera's CameraView.
 * This is extracted so the require only happens in this component,
 * keeping the main component tree clean.
 */
function CameraViewWrapper({
  cameraType,
  onBarCodeScanned,
  onCancel,
  onToggleCamera,
  flyerMode,
  onImageCaptured,
  onCaptureError,
  onPickFromLibrary,
}: {
  cameraType: 'front' | 'back';
  onBarCodeScanned: ((result: any) => void) | undefined;
  onCancel: () => void;
  onToggleCamera: () => void;
  flyerMode?: boolean;
  onImageCaptured?: (uri: string) => void;
  onCaptureError?: () => void;
  onPickFromLibrary?: () => void;
}) {
  const [CameraView, setCameraView] = useState<any>(null);
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    (async () => {
      try {
        // @ts-ignore — expo-camera may not be installed
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const expoCamera = require('expo-camera');
        setCameraView(() => expoCamera.CameraView);
      } catch {
        // Should not reach here since hasCamera was already checked
      }
    })();
  }, []);

  // Take a real photo via the CameraView ref (expo-camera SDK 56
  // takePictureAsync). On failure, hand off to the library-picker fallback.
  const handleCapture = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync?.({
        quality: 0.7,
        skipProcessing: true,
      });
      if (photo?.uri) {
        onImageCaptured?.(photo.uri);
      } else {
        onCaptureError?.();
      }
    } catch {
      onCaptureError?.();
    } finally {
      setCapturing(false);
    }
  }, [capturing, onImageCaptured, onCaptureError]);

  if (!CameraView) {
    return (
      <View style={styles.cameraPlaceholder}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Starting camera...</Text>
      </View>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        ref={cameraRef}
        style={styles.cameraPreview}
        facing={cameraType}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={!flyerMode ? onBarCodeScanned : undefined}
      >
        <View style={styles.overlay}>
          {flyerMode ? (
            <Text style={styles.flyerHintText}>Capture flyer pages</Text>
          ) : (
            <View style={styles.scanFrame} />
          )}
        </View>
      </CameraView>

      <View style={styles.cameraControls}>
        <TouchableOpacity style={styles.controlBtn} onPress={onCancel}>
          <Text style={styles.controlBtnText}>{flyerMode ? 'Cancel' : 'Cancel'}</Text>
        </TouchableOpacity>
        {flyerMode ? (
          <TouchableOpacity
            style={[styles.captureBtn, capturing && styles.captureBtnDisabled]}
            onPress={handleCapture}
            disabled={capturing}
            accessibilityRole="button"
            accessibilityLabel="Capture flyer photo"
          >
            {capturing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <View style={styles.captureCircle} />
            )}
          </TouchableOpacity>
        ) : null}
        {flyerMode ? (
          <TouchableOpacity
            style={styles.controlBtn}
            onPress={onPickFromLibrary}
            accessibilityRole="button"
            accessibilityLabel="Choose flyer photo from library"
          >
            <Text style={styles.controlBtnText}>Library</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.controlBtn} onPress={onToggleCamera}>
            <Text style={styles.controlBtnText}>Flip</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  loadingText: {
    color: '#fff',
    fontSize: 14,
    marginTop: 12,
  },
  cameraContainer: {
    flex: 1,
    width: '100%',
  },
  cameraPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    width: '100%',
  },
  cameraPreview: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#4CAF50',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  cameraControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    backgroundColor: '#1a1a1a',
  },
  controlBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  controlBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  fallbackBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    margin: 24,
    width: '85%',
    alignItems: 'center',
  },
  fallbackTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  fallbackDescription: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  manualInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#fafafa',
    width: '100%',
    marginBottom: 12,
  },
  submitBtn: {
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 16,
  },
  cancelBtnText: {
    color: '#f44336',
    fontSize: 16,
    fontWeight: '600',
  },
  // ─── Flyer Mode Styles ────────────────────────────────────────────────────
  captureBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#4CAF50',
  },
  captureBtnDisabled: {
    opacity: 0.5,
  },
  captureCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  flyerHintText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  thumbnailStripContainer: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    paddingHorizontal: 8,
  },
  thumbnailStrip: {
    maxHeight: 80,
  },
  thumbnailWrapper: {
    position: 'relative',
    marginRight: 8,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fff',
  },
  thumbnailRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#f44336',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailRemoveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  fallbackThumbnailContainer: {
    marginTop: 16,
    width: '100%',
  },
  flyerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  flyerActionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 6,
    backgroundColor: '#eee',
  },
  flyerActionBtnPrimary: {
    backgroundColor: '#4CAF50',
  },
  flyerActionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  flyerActionBtnTextPrimary: {
    color: '#fff',
  },
});