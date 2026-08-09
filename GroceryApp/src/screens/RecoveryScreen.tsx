/**
 * Recovery Screen — BIP39 recovery phrase display and recovery.
 *
 * Two modes:
 *  - 'show': Displays the 12-word recovery phrase for the family creator
 *  - 'recover': Allows entering a recovery phrase to restore the master key
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Clipboard,
} from 'react-native';

import {
  generateRecoveryPhrase,
  recoverFromPhrase,
  verifyRecoveryPhrase,
  hasRecoveryPhrase,
  getStoredRecoveryPhrase,
  RecoveryOverwriteError,
} from '../identity/recovery';
import { setupMasterKey, getMasterKey } from '../crypto/index';
import { updateSettings } from '../config/settings';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/deepLinks';

// ─── Props ──────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<RootStackParamList, 'Recovery'>;

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function RecoveryScreen({ navigation, route }: Props) {
  // Determine mode from route params
  const mode = (route.params as any)?.mode ?? 'show';

  const [phrase, setPhrase] = useState('');
  const [phraseInput, setPhraseInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [validationError, setValidationError] = useState('');

  /**
   * Run recovery, surfacing the one failure that is NOT safe to retry blindly.
   *
   * A wrong phrase whose 4-bit checksum happens to pass decodes to wrong
   * entropy and a wrong key, and writing that key orphans everything already
   * encrypted under the real one — while showing "Recovery Successful".
   * recoverFromPhrase refuses that overwrite; here we ask, once, explicitly.
   *
   * Returns null when the user declines, which is a cancellation rather than
   * a failure and must not be reported as one.
   */
  const runRecovery = useCallback(
    async (trimmed: string, allowOverwrite: boolean): Promise<Uint8Array | null> => {
      try {
        return await recoverFromPhrase(trimmed, { allowOverwrite });
      } catch (err) {
        if (err instanceof RecoveryOverwriteError && !allowOverwrite) {
          const confirmed = await new Promise<boolean>((resolve) => {
            Alert.alert('Replace this device\u2019s key?', err.message, [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              {
                text: 'Replace',
                style: 'destructive',
                onPress: () => resolve(true),
              },
            ]);
          });
          if (!confirmed) return null;
          return await recoverFromPhrase(trimmed, { allowOverwrite: true });
        }
        throw err;
      }
    },
    [],
  );

  // Load phrase on mount (show mode)
  useEffect(() => {
    (async () => {
      try {
        if (mode === 'show') {
          // Check if we already have a stored phrase
          const existing = await getStoredRecoveryPhrase();
          if (existing) {
            setPhrase(existing);
          } else if (!(await getMasterKey())) {
            // No key yet (initial setup) — mint the phrase and key together.
            const newPhrase = await generateRecoveryPhrase();
            setPhrase(newPhrase);
          } else {
            // A master key exists but no phrase is stored on this device.
            // recoverFromPhrase() now persists the phrase on join, so this is
            // only reachable on devices that joined before that fix. Raise an
            // actionable error instead of letting generateRecoveryPhrase()
            // throw its opaque "after data has been encrypted" guard.
            throw new Error(
              'No recovery phrase is stored on this device. Re-enter your ' +
              "family's 12-word phrase via Recover from Backup to store it here.",
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load recovery phrase';
        Alert.alert('Error', message);
      } finally {
        setLoading(false);
      }
    })();
  }, [mode]);

  // Handle paste from clipboard
  const handlePaste = useCallback(async () => {
    try {
      const text = await Clipboard.getString();
      if (text) {
        setPhraseInput(text);
        // Auto-validate
        setValidationError('');
      }
    } catch {
      Alert.alert('Paste Failed', 'Could not read from clipboard.');
    }
  }, []);

  // Handle phrase input change with validation
  const handlePhraseChange = useCallback((text: string) => {
    setPhraseInput(text);
    setValidationError('');

    const words = text.trim().toLowerCase().split(/\s+/);
    if (words.length === 12 && text.trim().length > 0) {
      const valid = verifyRecoveryPhrase(text);
      if (!valid) {
        setValidationError('Invalid phrase — check word spelling or recovery phrase');
      }
    }
  }, []);

  // Handle recovery
  const handleRecover = useCallback(async () => {
    const trimmed = phraseInput.trim().toLowerCase();
    if (!trimmed) {
      Alert.alert('Missing Phrase', 'Please enter your 12-word recovery phrase.');
      return;
    }

    setRecovering(true);
    setValidationError('');

    try {
      const masterKey = await runRecovery(trimmed, false);
      if (!masterKey) {
        // Cancelled at the overwrite confirmation — not an error, not a success.
        return;
      }

      // Now that the key exists, hydrate/connect sync immediately (also runs
      // on every app start; fire-and-forget here so recovery UX isn't blocked)
      import('../sync/bootstrap')
        .then(({ bootstrapSync }) => bootstrapSync())
        .catch(() => {});

      // Success — the master key has been recovered
      Alert.alert(
        'Recovery Successful',
        'Your family key has been recovered. You can now access your shared lists.',
        [
          {
            text: 'Continue',
            onPress: () => navigation.navigate('Home'),
          },
        ],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Recovery failed';
      setValidationError(message);
      Alert.alert('Recovery Failed', message);
    } finally {
      setRecovering(false);
    }
  }, [phraseInput, navigation]);

  // Handle confirmed safe storage — the ONLY place the first-run backup
  // acknowledgement is persisted. Dismissing this screen (back button,
  // backgrounding) must NOT set it, so the Home banner re-surfaces until the
  // user explicitly confirms.
  const handleConfirmed = useCallback(() => {
    setConfirmed(true);
    updateSettings({ recoveryPhraseAcknowledged: true }).catch(() => {
      // Persistence failure just means the banner shows again next launch.
    });
    Alert.alert(
      'Recovery Phrase Stored',
      'Great! Your recovery phrase has been saved. Keep it in a safe place — you will need it if you ever lose access to all your devices.',
      [
        {
          text: 'OK',
          onPress: () => navigation.goBack(),
        },
      ],
    );
  }, [navigation]);

  // Handle copy to clipboard (with warning)
  const handleCopy = useCallback(async () => {
    Alert.alert(
      'Security Warning',
      'Copying your recovery phrase to the clipboard may expose it to other apps. Only do this in a secure environment.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy Anyway',
          style: 'destructive',
          onPress: async () => {
            try {
              await Clipboard.setString(phrase);
              Alert.alert('Copied', 'Recovery phrase copied to clipboard.');
            } catch {
              Alert.alert('Error', 'Failed to copy to clipboard.');
            }
          },
        },
      ],
    );
  }, [phrase]);

  // Loading state
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <Text style={styles.loadingText}>
            {mode === 'show' ? 'Generating recovery phrase...' : 'Loading...'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>
          {mode === 'show' ? 'Recovery Phrase' : 'Recover from Backup'}
        </Text>
      </View>

      {mode === 'show' ? (
        <ShowMode
          phrase={phrase}
          onConfirmed={handleConfirmed}
          onCopy={handleCopy}
          confirmed={confirmed}
        />
      ) : (
        <RecoverMode
          phraseInput={phraseInput}
          onPhraseChange={handlePhraseChange}
          onPaste={handlePaste}
          onRecover={handleRecover}
          validationError={validationError}
          recovering={recovering}
        />
      )}

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

// ─── Show Mode Sub-Component ─────────────────────────────────────────────────

interface ShowModeProps {
  phrase: string;
  onConfirmed: () => void;
  onCopy: () => void;
  confirmed: boolean;
}

function ShowMode({ phrase, onConfirmed, onCopy, confirmed }: ShowModeProps) {
  const words = phrase.split(/\s+/);

  return (
    <>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Recovery Phrase</Text>
        <Text style={styles.warningText}>
          Write these 12 words down and store them safely. Your lists are
          end-to-end encrypted and there is no account or password reset: if
          you lose all your devices and this phrase, your data is gone for
          good. Anyone with this phrase can access your family data!
        </Text>

        <View style={styles.phraseBox}>
          <View style={styles.phraseGrid}>
            {words.map((word, i) => (
              <View key={i} style={styles.wordRow}>
                <Text style={styles.wordNumber}>{i + 1}.</Text>
                <Text style={styles.wordText}>{word}</Text>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.copyButton} onPress={onCopy}>
          <Text style={styles.copyButtonText}>📋 Copy to Clipboard</Text>
        </TouchableOpacity>

        <Text style={styles.warningText}>
          Treat this like your house key — never share it unnecessarily, never
          store it in plain text on your device, and never enter it into any
          website or app claiming to be from us. If this device later joins a
          different family, it gets that family's key and phrase instead — the
          phrase that matters is always your current family's.
        </Text>

        {!confirmed ? (
          <TouchableOpacity style={styles.confirmButton} onPress={onConfirmed}>
            <Text style={styles.confirmButtonText}>
              ✓ I've Stored It Safely
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.confirmedContainer}>
            <Text style={styles.confirmedText}>
              ✓ Recovery phrase confirmed as stored safely.
            </Text>
          </View>
        )}
      </View>

      {!confirmed && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What Now?</Text>
          <Text style={styles.helpText}>
            1. Write the 12 words down on paper{'\n'}
            2. Store the paper in a safe place (e.g., a safe){'\n'}
            3. Do NOT store it digitally (screenshots, notes, etc.){'\n'}
            4. Tap "I've Stored It Safely" when done
          </Text>
        </View>
      )}
    </>
  );
}

// ─── Recover Mode Sub-Component ──────────────────────────────────────────────

interface RecoverModeProps {
  phraseInput: string;
  onPhraseChange: (text: string) => void;
  onPaste: () => void;
  onRecover: () => void;
  validationError: string;
  recovering: boolean;
}

function RecoverMode({
  phraseInput,
  onPhraseChange,
  onPaste,
  onRecover,
  validationError,
  recovering,
}: RecoverModeProps) {
  return (
    <>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Enter Recovery Phrase</Text>
        <Text style={styles.sectionDescription}>
          Enter your 12-word recovery phrase to restore your family key. This is
          the phrase you were given when you first set up the family.
        </Text>

        <TextInput
          style={[
            styles.phraseInput,
            validationError ? styles.phraseInputError : null,
          ]}
          value={phraseInput}
          onChangeText={onPhraseChange}
          placeholder="Enter your 12-word recovery phrase..."
          placeholderTextColor="#999"
          multiline
          numberOfLines={4}
          autoCapitalize="none"
          autoCorrect={false}
          textAlignVertical="top"
        />

        {validationError ? (
          <Text style={styles.errorText}>{validationError}</Text>
        ) : null}

        <TouchableOpacity style={styles.pasteButton} onPress={onPaste}>
          <Text style={styles.pasteButtonText}>📋 Paste Recovery Phrase</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recover</Text>
        <Text style={styles.sectionDescription}>
          Once you enter a valid recovery phrase, your family key will be
          restored and you will regain access to your shared lists.
        </Text>

        <TouchableOpacity
          style={[
            styles.recoverButton,
            (recovering || !phraseInput.trim()) && styles.recoverButtonDisabled,
          ]}
          onPress={onRecover}
          disabled={recovering || !phraseInput.trim()}
        >
          {recovering ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.recoverButtonText}>🔑 Recover Family Key</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Need Help?</Text>
        <Text style={styles.helpText}>
          If you don't have your recovery phrase, you will need to ask an existing
          family member to generate a new invite for you.
        </Text>
      </View>
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    padding: 20,
    paddingBottom: 8,
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
    color: '#4CAF50',
    fontWeight: '600',
  },
  section: {
    margin: 12,
    marginTop: 4,
    backgroundColor: '#fff',
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
    color: '#333',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 13,
    color: '#666',
    marginBottom: 12,
    lineHeight: 18,
  },
  warningText: {
    fontSize: 13,
    color: '#f44336',
    lineHeight: 18,
    marginBottom: 12,
  },
  phraseBox: {
    backgroundColor: '#fff8e1',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#FF9800',
    marginBottom: 12,
  },
  phraseGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
    marginBottom: 6,
  },
  wordNumber: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF9800',
    width: 24,
  },
  wordText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    fontFamily: 'monospace',
  },
  copyButton: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 12,
  },
  copyButtonText: {
    fontSize: 14,
    color: '#555',
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  confirmedContainer: {
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  confirmedText: {
    fontSize: 14,
    color: '#2E7D32',
    fontWeight: '600',
  },
  helpText: {
    fontSize: 13,
    color: '#666',
    lineHeight: 20,
  },
  phraseInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#333',
    backgroundColor: '#fafafa',
    minHeight: 100,
    fontFamily: 'monospace',
    lineHeight: 22,
  },
  phraseInputError: {
    borderColor: '#f44336',
    backgroundColor: '#fff5f5',
  },
  errorText: {
    fontSize: 12,
    color: '#f44336',
    marginTop: 6,
    lineHeight: 16,
  },
  pasteButton: {
    backgroundColor: '#2196F3',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  pasteButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  recoverButton: {
    backgroundColor: '#FF9800',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  recoverButtonDisabled: {
    opacity: 0.5,
  },
  recoverButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  bottomSpacer: {
    height: 40,
  },
});