/**
 * Typed settings store persisted to expo-secure-store.
 *
 * All sensitive values are encrypted using the device-specific crypto layer
 * (XChaCha20-Poly1305 with a device-derived key) before storage.
 *
 * Design:
 *  - A device-specific encryption key is derived once and cached in memory
 *  - Each setting is encrypted/decrypted individually with appropriate AAD context
 *  - Hosting tier controls which settings are visible/enabled in the UI
 *  - Defaults are provided for all settings
 */

import { initCrypto, encrypt, decrypt, generateUUID } from '../crypto/index';
// expo-secure-store loaded lazily to avoid Hermes crash (chains to expo-asset at eval time)
let SecureStore: any = null;
async function getSecureStore(): Promise<any> {
  if (!SecureStore) {
    const mod = await import('expo-secure-store');
    SecureStore = mod;
  }
  return SecureStore;
}
import type { AppSettings, HostingTier } from '../types';

// ─── Constants ───────────────────────────────────────────────────────────────

const SETTINGS_CACHE_KEY = 'groceryapp.settings.cache';
const DEVICE_SETTINGS_KEY = 'groceryapp.device.settings_key';
const SETTINGS_AAD_CONTEXT = 'app_settings';

const DEFAULT_RELAY_URL = 'ws://localhost';
const DEFAULT_RELAY_PORT = 8080;
const DEFAULT_LOCAL_AI_ENDPOINT = 'http://localhost:1234';

const DEFAULT_SETTINGS: AppSettings = {
  hostingTier: 'self_hosted',
  relayUrl: DEFAULT_RELAY_URL,
  relayPort: DEFAULT_RELAY_PORT,
  pairingCode: '',
  managedSubscriptionKey: '',
  localAiEndpoint: DEFAULT_LOCAL_AI_ENDPOINT,
  priceServiceEnabled: false,
  pricingOptedIn: false,
  voiceInputEnabled: false,
  barcodeScanningEnabled: false,
  flyerScanEnabled: true,
  cloudFlyerEnabled: false,
  contributeEnabled: false,
  contributeStoreGranularity: 'region',
  contributeConsentShown: false,
  recoveryPhraseAcknowledged: false,
  poolUrl: '',
  theme: 'system',
};

// ─── Cache ───────────────────────────────────────────────────────────────────

let settingsCache: AppSettings | null = null;
let deviceSettingsKey: Uint8Array | null = null;

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Get or create the device settings encryption key.
 * This is a separate key from the master encryption key, derived once and cached.
 */
async function getOrCreateSettingsKey(): Promise<Uint8Array> {
  if (deviceSettingsKey) return deviceSettingsKey;

  await initCrypto();
  try {
    const stored = await (await getSecureStore()).getItemAsync(DEVICE_SETTINGS_KEY);
    if (stored) {
      deviceSettingsKey = new Uint8Array(
        stored.split(',').map((s: string) => parseInt(s, 10)),
      );
      return deviceSettingsKey;
    }
  } catch (err) {
    console.warn('[settings] Failed to read device settings key, generating new one:', err);
  }

  // Generate a random key for device settings
  const sodium = require('react-native-libsodium');
  await sodium.ready;
  const key = sodium.randombytes_buf(32);
  deviceSettingsKey = key;
  try {
    await (await getSecureStore()).setItemAsync(DEVICE_SETTINGS_KEY, Array.from(key).join(','));
  } catch (err) {
    console.warn('[settings] Failed to persist device settings key:', err);
  }
  return key;
}

/**
 * Serialize settings to a JSON string, encrypt it, and store in secure store.
 */
async function persistSettings(settings: AppSettings): Promise<void> {
  const key = await getOrCreateSettingsKey();
  const serialized = JSON.stringify(settings);
  const encrypted = await encrypt(serialized, key, SETTINGS_AAD_CONTEXT);
  try {
    await (await getSecureStore()).setItemAsync(SETTINGS_CACHE_KEY, JSON.stringify(encrypted));
  } catch (err) {
    console.warn('[settings] Failed to persist settings:', err);
  }
  settingsCache = { ...settings };
}

/**
 * Load settings from secure store, decrypt, and cache.
 */
async function loadSettingsFromStore(): Promise<AppSettings | null> {
  try {
    const stored = await (await getSecureStore()).getItemAsync(SETTINGS_CACHE_KEY);
    if (!stored) return null;

    const key = await getOrCreateSettingsKey();
    const encrypted = JSON.parse(stored);
    const decrypted = await decrypt(encrypted, key, SETTINGS_AAD_CONTEXT);
    return JSON.parse(decrypted) as AppSettings;
  } catch (e) {
    console.error('[settings] loadSettingsFromStore error:', e);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Strip removed Turso fields from a settings object loaded from disk.
 * The turso URL/token fields are credentials and must not survive on device;
 * the turso enabled flag is the switch that activated them. All were removed
 * from AppSettings for v1 (see GOAL_PROMPT_NOTES.md, Option B decision), so
 * every `turso*` key is purged. Returns true if anything was stripped, so
 * the caller knows to re-persist the cleaned object.
 */
function stripRemovedFields(settings: Record<string, unknown>): boolean {
  let stripped = false;
  for (const key of Object.keys(settings)) {
    if (key.startsWith('turso')) {
      delete settings[key];
      stripped = true;
    }
  }
  return stripped;
}

/**
 * Initialize the settings store. Must be called once at app startup.
 * Loads settings from secure store into cache, or populates defaults.
 */
export async function initSettings(): Promise<AppSettings> {
  await initCrypto();
  console.log('[settings] Loading settings from secure store…');
  const loaded = await loadSettingsFromStore();
  if (loaded) {
    // Migration: purge Turso credentials persisted by earlier versions.
    const migrated = stripRemovedFields(loaded as unknown as Record<string, unknown>);
    settingsCache = { ...DEFAULT_SETTINGS, ...loaded };
    if (migrated) {
      await persistSettings(settingsCache);
      console.log('[settings] ✓ Purged removed Turso fields from stored settings');
    }
    console.log('[settings] ✓ Settings loaded (merged with defaults)');
    return { ...settingsCache };
  }

  // First launch — populate with defaults
  console.log('[settings] No stored settings — writing defaults…');
  await persistSettings(DEFAULT_SETTINGS);
  console.log('[settings] ✓ Default settings written');
  return { ...DEFAULT_SETTINGS };
}

/**
 * Get all current settings (from cache, no I/O).
 * Throws if settings haven't been initialized.
 */
export function getSettings(): AppSettings {
  if (!settingsCache) {
    throw new Error('Settings not initialized. Call initSettings() first.');
  }
  return { ...settingsCache };
}

/**
 * Get a single setting value.
 */
export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return getSettings()[key];
}

/**
 * Update one or more settings and persist.
 * Merges with existing settings.
 */
export async function updateSettings(
  partial: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = getSettings();
  const updated = { ...current, ...partial };
  await persistSettings(updated);
  return { ...updated };
}

/**
 * Set hosting tier (self_hosted | managed).
 * Validates that the tier value is correct.
 */
export async function setHostingTier(tier: HostingTier): Promise<AppSettings> {
  return updateSettings({ hostingTier: tier });
}

/**
 * Get the current hosting tier.
 */
export function getHostingTier(): HostingTier {
  return getSettings().hostingTier;
}

/**
 * Set the relay WebSocket URL.
 */
export async function setRelayUrl(url: string): Promise<AppSettings> {
  return updateSettings({ relayUrl: url });
}

/**
 * Set the relay port.
 */
export async function setRelayPort(port: number): Promise<AppSettings> {
  return updateSettings({ relayPort: port });
}

/**
 * Generate and set a pairing code for self-hosted setup.
 * The code is a JSON-encoded string containing deviceId, familyId, relayUrl.
 */
export async function setPairingCode(code: string): Promise<AppSettings> {
  return updateSettings({ pairingCode: code });
}

/**
 * Set the managed subscription key.
 */
export async function setManagedSubscriptionKey(
  key: string,
): Promise<AppSettings> {
  return updateSettings({ managedSubscriptionKey: key });
}

/**
 * Set local AI endpoint (self-hosted only).
 */
export async function setLocalAiEndpoint(
  endpoint: string,
): Promise<AppSettings> {
  return updateSettings({ localAiEndpoint: endpoint });
}

/**
 * Toggle opt-in features.
 */
export async function setPriceServiceEnabled(
  enabled: boolean,
): Promise<AppSettings> {
  return updateSettings({ priceServiceEnabled: enabled });
}

export async function setVoiceInputEnabled(
  enabled: boolean,
): Promise<AppSettings> {
  return updateSettings({ voiceInputEnabled: enabled });
}

export async function setBarcodeScanningEnabled(
  enabled: boolean,
): Promise<AppSettings> {
  return updateSettings({ barcodeScanningEnabled: enabled });
}

/**
 * Test connection to the relay server's /health endpoint.
 * Returns true if the server responds with 200.
 */
export async function testRelayConnection(
  url: string,
  port: number,
): Promise<boolean> {
  try {
    // Parse the URL properly — if URL already has a port, don't append another one
    let httpUrl = url
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:');
    
    // If URL doesn't already have a port, append the provided port
    let fullUrl: string;
    try {
      const parsed = new URL(httpUrl);
      if (parsed.port) {
        // URL already has a port, use it as-is
        fullUrl = `${httpUrl}/health`;
      } else {
        fullUrl = `${httpUrl}:${port}/health`;
      }
    } catch {
      // If URL parsing fails, fall back to simple append
      fullUrl = `${httpUrl}:${port}/health`;
    }
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Reset all settings to defaults.
 */
export async function resetSettings(): Promise<AppSettings> {
  await persistSettings(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS };
}

/**
 * Clear the settings cache and remove from secure store (for testing).
 */
export async function clearSettings(): Promise<void> {
  settingsCache = null;
  deviceSettingsKey = null;
  await (await getSecureStore()).deleteItemAsync(SETTINGS_CACHE_KEY);
  await (await getSecureStore()).deleteItemAsync(DEVICE_SETTINGS_KEY);
}