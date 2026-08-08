/**
 * Passkey / WebAuthn Support.
 *
 * Provides passkey registration and authentication for device re-auth.
 * Falls back to device-key enrollment if passkeys are not available on the platform.
 *
 * Design:
 *  - Uses WebAuthn API (via expo-passkeys or react-native-passkey)
 *  - Registers a passkey associated with the device identity
 *  - Stores passkey credential ID locally mapped to device ID
 *  - Falls back to device-key challenge-response if passkeys unavailable
 *
 * Note: On native platforms (iOS/Android), the native passkey APIs are used.
 * In test environments, we mock the native module.
 */

import { getDeviceId } from './device';
// expo-secure-store loaded lazily to avoid Hermes crash (chains to expo-asset at eval time)
let SecureStore: any = null;
async function getSecureStore(): Promise<any> {
  if (!SecureStore) {
    const mod = await import('expo-secure-store');
    SecureStore = mod;
  }
  return SecureStore;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PASSKEY_CREDENTIAL_ALIAS_PREFIX = 'groceryapp.passkey.credential.';
const PASSKEY_SUPPORT_ALIAS = 'groceryapp.passkey.supported';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PasskeyCredential {
  id: string;
  deviceId: string;
  rawId: string;
  createdAt: number;
}

// ─── Platform Detection ──────────────────────────────────────────────────────

/**
 * Check if the current platform supports passkeys (WebAuthn).
 * Returns false in test/Node.js environments.
 */
export async function isPasskeySupported(): Promise<boolean> {
  // In React Native / Expo, we check for platform support
  // For Node.js / test environments, return false
  try {
    const stored = await (await getSecureStore()).getItemAsync(PASSKEY_SUPPORT_ALIAS);
    if (stored === 'true') return true;
    if (stored === 'false') return false;

    // Check if we're in a browser-like environment with WebAuthn
    if (
      typeof window !== 'undefined' &&
      typeof window.PublicKeyCredential !== 'undefined'
    ) {
      const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      const supported = available === true;
      await (await getSecureStore()).setItemAsync(
        PASSKEY_SUPPORT_ALIAS,
        supported ? 'true' : 'false',
      );
      return supported;
    }

    // Native platforms: try to detect passkey module
    // In real app, check Platform.OS and available native modules
    await (await getSecureStore()).setItemAsync(PASSKEY_SUPPORT_ALIAS, 'false');
    return false;
  } catch {
    await (await getSecureStore()).setItemAsync(PASSKEY_SUPPORT_ALIAS, 'false');
    return false;
  }
}

/**
 * Generate a credential ID for the passkey.
 * In a real implementation, this would be returned by the native passkey API.
 */
function generateCredentialId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const array = new Uint8Array(32);
  // CSPRNG only — a guessable credential id would undermine the whole point.
  // No Math.random fallback: fail loudly instead of degrading silently.
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('No CSPRNG available for passkey credential generation');
  }
  crypto.getRandomValues(array);
  for (let i = 0; i < array.length; i++) {
    result += chars.charAt(array[i] % chars.length);
  }
  return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a passkey for the current device.
 *
 * In production, this would call the native passkey API
 * (e.g., expo-passkeys or react-native-passkey).
 * In test/mock environments, we simulate the registration.
 *
 * @returns The registered PasskeyCredential, or null if passkeys are not supported.
 */
export async function registerPasskey(): Promise<PasskeyCredential | null> {
  const supported = await isPasskeySupported();

  if (!supported) {
    // Fall back: return null — caller should use device-key enrollment
    return null;
  }

  // In a real implementation, this would call:
  //   const credential = await PasskeyModule.create(...);
  // For now, simulate passkey registration
  const deviceId = getDeviceId();
  const credentialId = generateCredentialId();

  const credential: PasskeyCredential = {
    id: credentialId,
    deviceId,
    rawId: credentialId,
    createdAt: Date.now(),
  };

  // Store credential mapping
  await (await getSecureStore()).setItemAsync(
    `${PASSKEY_CREDENTIAL_ALIAS_PREFIX}${deviceId}`,
    JSON.stringify(credential),
  );

  return credential;
}

/**
 * Authenticate using a passkey.
 *
 * In production, this would invoke the native passkey authentication flow.
 * In test environments, we verify the stored credential exists.
 *
 * @returns The credential ID if authentication succeeds, or null if passkeys aren't available.
 */
export async function authenticateWithPasskey(): Promise<string | null> {
  const supported = await isPasskeySupported();

  if (!supported) {
    return null;
  }

  const deviceId = getDeviceId();

  // In production, this would call:
  //   const assertion = await PasskeyModule.get({ ... });
  // For now, verify we have a stored credential
  try {
    const stored = await (await getSecureStore()).getItemAsync(
      `${PASSKEY_CREDENTIAL_ALIAS_PREFIX}${deviceId}`,
    );
    if (!stored) return null;

    const credential = JSON.parse(stored) as PasskeyCredential;
    return credential.id;
  } catch {
    return null;
  }
}

/**
 * Check if the current device has a registered passkey.
 */
export async function hasPasskey(): Promise<boolean> {
  const deviceId = getDeviceId();
  try {
    const stored = await (await getSecureStore()).getItemAsync(
      `${PASSKEY_CREDENTIAL_ALIAS_PREFIX}${deviceId}`,
    );
    return stored !== null;
  } catch {
    return false;
  }
}

/**
 * Remove passkey credential for the current device.
 */
export async function removePasskey(): Promise<void> {
  const deviceId = getDeviceId();
  await (await getSecureStore()).deleteItemAsync(
    `${PASSKEY_CREDENTIAL_ALIAS_PREFIX}${deviceId}`,
  );
}

/**
 * Clear passkey data: the support flag and the CURRENT device's credential.
 *
 * Credentials stored under other/former device ids are unreachable by name —
 * expo-secure-store has no key-enumeration API. The data-wipe path
 * (src/services/dataWipe.ts) documents this and destroys the device keypair,
 * so any such residue is unusable.
 */
export async function clearPasskeyData(): Promise<void> {
  const ss = await getSecureStore();
  await ss.deleteItemAsync(PASSKEY_SUPPORT_ALIAS);
  try {
    const deviceId = getDeviceId();
    await ss.deleteItemAsync(`${PASSKEY_CREDENTIAL_ALIAS_PREFIX}${deviceId}`);
  } catch {
    // Device identity not initialized — no addressable credential.
  }
}