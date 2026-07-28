/**
 * Encryption layer using react-native-libsodium (XChaCha20-Poly1305 AEAD + Argon2id KDF).
 *
 * Design:
 *  - Master key derived from family passphrase via libsodium crypto_pwhash (Argon2id,
 *    OPSLIMIT_MODERATE / MEMLIMIT_MODERATE), replacing the previous PBKDF2-HMAC-SHA256.
 *  - Master key stored in expo-secure-store (passphrase NEVER stored)
 *  - Each encryption uses XChaCha20-Poly1305 with a fresh random nonce
 *  - Ciphertext, nonce, and auth tag stored together via EncryptedData envelope
 *  - AAD (Additional Authenticated Data) binds each ciphertext to its field context,
 *    supported natively by libsodium's AEAD interface
 *  - UUID v4 generated via libsodium's randombytes_buf for crypto-safe randomness
 *  - Constant-time passphrase verification via sodium_memcmp
 */

import type { EncryptedData } from '../types';

// ─── Lazy SecureStore import ─────────────────────────────────────────────────
// IMPORTANT: must NOT be imported at the top level - Expo modules chain to
// expo-asset which triggers Hermes 0.85.3 crash during module evaluation.
let SecureStore: any = null;

async function getSecureStore(): Promise<any> {
  if (!SecureStore) {
    const mod = await import('expo-secure-store');
    SecureStore = mod;
  }
  return SecureStore;
}

// Helper to wrap SecureStore in a proxy that lazily initializes
const secureStoreProxy = new Proxy({}, {
  get(_target, prop: string) {
    return async (...args: any[]) => {
      const store = await getSecureStore();
      return (store as any)[prop](...args);
    };
  },
}) as any;

// ─── Lazy sodium import ──────────────────────────────────────────────────────
// IMPORTANT: react-native-libsodium MUST NOT be imported at the top level.
// Its native JSI install (Libsodium.install()) runs synchronously during
// module evaluation and can SIGSEGV if the Hermes JSI runtime is not fully
// ready. Deferring the import to first use (inside async initCrypto()) ensures
// React has loaded and the error handler is in place.
let sodium: any = null;

async function getSodium(): Promise<any> {
  if (!sodium) {
    const mod = await import('react-native-libsodium');
    sodium = mod.default;
  }
  return sodium;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KEY_LENGTH_BYTES = 32; // sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES
const NONCE_LENGTH_BYTES = 24; // sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
const ABYTES = 16; // sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES
const SALT_LENGTH_BYTES = 16; // Argon2id salt

const SECURE_STORE_KEY_ALIAS = 'groceryapp.master_key';

// Argon2id parameters (moderate — ~1s on mobile)
const OPSLIMIT = 3; // sodium.crypto_pwhash_OPSLIMIT_MODERATE
const MEMLIMIT = 268435456; // sodium.crypto_pwhash_MEMLIMIT_MODERATE

// ─── Ready / Init ─────────────────────────────────────────────────────────────

let ready = false;

/**
 * Ensure libsodium is initialised before any operation.
 * Must be called once at app startup.
 */
export async function initCrypto(): Promise<void> {
  if (!ready) {
    console.log('[crypto] Importing react-native-libsodium…');
    const s = await getSodium();
    console.log('[crypto] Module loaded, waiting for ready…');
    await s.ready;
    // Verify JSI functions are actually installed
    if (typeof (globalThis as any).jsi_randombytes_buf !== 'function') {
      console.warn('[crypto] WARNING: jsi_randombytes_buf not installed — Libsodium.install() may have failed');
    } else {
      console.log('[crypto] JSI functions verified (jsi_randombytes_buf present)');
    }
    ready = true;
    console.log('[crypto] initCrypto complete');
  }
}

async function ensureReady(): Promise<void> {
  if (!ready) {
    const s = await getSodium();
    await s.ready;
    ready = true;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uint8ArrayToBase64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

function base64ToUint8Array(b64: string): Uint8Array {
  return sodium.from_base64(b64, sodium.base64_variants.ORIGINAL);
}

/** Constant-time comparison. Replaces sodium.memcmp which react-native-libsodium doesn't export. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ─── Key Derivation (Argon2id via libsodium crypto_pwhash) ────────────────────

/**
 * Derive a 256-bit encryption key from a passphrase + salt using Argon2id.
 *
 * Uses libsodium's recommended memory-hard KDF:
 *   crypto_pwhash(keyLen, passwd, salt, opsLimit, memLimit, algo)
 *
 * Argon2id resists both side-channel and GPU/ASIC parallel attacks.
 * OPSLIMIT_MODERATE / MEMLIMIT_MODERATE target ~1 second on mobile devices.
 */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  await ensureReady();
  const normalized = passphrase.normalize('NFKC');
  const key = sodium.crypto_pwhash(
    KEY_LENGTH_BYTES,
    normalized,
    salt,
    OPSLIMIT,
    MEMLIMIT,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return key;
}

/**
 * Generate a cryptographically random salt (16 bytes).
 */
export async function generateSalt(): Promise<Uint8Array> {
  await ensureReady();
  return sodium.randombytes_buf(SALT_LENGTH_BYTES);
}

/**
 * Generate a cryptographically random nonce (24 bytes for XChaCha20-Poly1305).
 */
export async function generateNonce(): Promise<Uint8Array> {
  await ensureReady();
  return sodium.randombytes_buf(NONCE_LENGTH_BYTES);
}

/**
 * Generate a cryptographically random UUID v4 string using libsodium.
 */
export async function generateUUID(): Promise<string> {
  await ensureReady();
  // 16 random bytes → format as UUID v4
  const bytes = sodium.randombytes_buf(16) as Uint8Array;
  // Set version (4) and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ─── Encryption / Decryption (XChaCha20-Poly1305) ────────────────────────────

/**
 * Encrypt plaintext using XChaCha20-Poly1305 with AAD.
 *
 * AAD binds the ciphertext to a specific field context (e.g., 'grocery_item.name'),
 * preventing an attacker from moving ciphertext between fields.
 *
 * @param plaintext  - The text to encrypt (UTF-8).
 * @param key        - 256-bit encryption key as Uint8Array.
 * @param context    - AAD context string identifying the field being encrypted.
 * @returns EncryptedData containing ciphertext, nonce, and auth tag (all base64).
 */
export async function encrypt(
  plaintext: string,
  key: Uint8Array,
  context?: string,
): Promise<EncryptedData> {
  await ensureReady();
  const nonce = await generateNonce();
  const additionalData = context || null;

  // libsodium: crypto_aead_xchacha20poly1305_ietf_encrypt (react-native-libsodium takes string AAD)
  // Returns ciphertext + tag concatenated
  const cipherWithTag = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    additionalData,
    null, // no secret nonce
    nonce,
    key,
  );

  // Split ciphertext and auth tag
  const ciphertext = cipherWithTag.slice(0, cipherWithTag.length - ABYTES);
  const tag = cipherWithTag.slice(cipherWithTag.length - ABYTES);

  return {
    ciphertext: uint8ArrayToBase64(ciphertext),
    iv: uint8ArrayToBase64(nonce),
    tag: uint8ArrayToBase64(tag),
  };
}

/**
 * Decrypt ciphertext previously encrypted with `encrypt`.
 *
 * Uses the same context string as AAD to verify ciphertext integrity.
 *
 * @param data    - EncryptedData envelope.
 * @param key     - 256-bit encryption key as Uint8Array.
 * @param context - AAD context string (must match what was used during encryption).
 * @returns The original plaintext string.
 */
export async function decrypt(
  data: EncryptedData,
  key: Uint8Array,
  context?: string,
): Promise<string> {
  await ensureReady();
  const nonce = base64ToUint8Array(data.iv);
  const tag = base64ToUint8Array(data.tag);
  const ciphertext = base64ToUint8Array(data.ciphertext);
  const additionalData = context || null;

  // Recombine ciphertext + tag for libsodium
  const cipherWithTag = new Uint8Array(ciphertext.length + tag.length);
  cipherWithTag.set(ciphertext);
  cipherWithTag.set(tag, ciphertext.length);

  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null, // no secret nonce
    cipherWithTag,
    additionalData,
    nonce,
    key,
  );

  return new TextDecoder().decode(plaintext);
}

// ─── Master Key Management ───────────────────────────────────────────────────

/**
 * Derive and persist the master key from a family passphrase.
 * The passphrase is NEVER stored on device — only the derived key.
 */
export async function setupMasterKey(passphrase: string): Promise<void> {
  await ensureReady();
  const salt = await generateSalt();
  const derivedKey = await deriveKeyFromPassphrase(passphrase, salt);
  const keyBase64 = uint8ArrayToBase64(derivedKey);
  const saltBase64 = uint8ArrayToBase64(salt);
  await secureStoreProxy.setItemAsync(
    SECURE_STORE_KEY_ALIAS,
    JSON.stringify({ key: keyBase64, salt: saltBase64, type: 'passphrase' }),
  );
}

/**
 * Retrieve the stored master key. Returns null if not yet set up.
 */
export async function getMasterKey(): Promise<Uint8Array | null> {
  await ensureReady();
  try {
    const stored = await secureStoreProxy.getItemAsync(SECURE_STORE_KEY_ALIAS);
    if (!stored) return null;
    const { key: keyBase64 } = JSON.parse(stored);
    return base64ToUint8Array(keyBase64);
  } catch {
    return null;
  }
}

/**
 * Derive master key from passphrase and verify against stored key.
 * Uses libsodium's sodium_memcmp for constant-time comparison.
 *
 * @returns The derived key if passphrase is correct, null otherwise.
 */
export async function verifyAndGetMasterKey(
  passphrase: string,
): Promise<Uint8Array | null> {
  await ensureReady();
  const stored = await secureStoreProxy.getItemAsync(SECURE_STORE_KEY_ALIAS);
  if (!stored) return null;
  const parsed = JSON.parse(stored);

  // If the stored key was created via recovery (not passphrase), return it directly
  if (parsed.type === 'recovery') {
    return base64ToUint8Array(parsed.key);
  }

  // Legacy format (no type field) or passphrase-derived: re-derive and verify
  const saltBase64 = parsed.salt;
  if (!saltBase64) return null; // Missing salt — can't verify
  const salt = base64ToUint8Array(saltBase64);
  const derivedKey = await deriveKeyFromPassphrase(passphrase, salt);
  const storedKey = base64ToUint8Array(parsed.key);

  // Constant-time comparison
  const match = constantTimeEqual(derivedKey, storedKey);
  if (!match) {
    return null; // Wrong passphrase
  }
  return derivedKey;
}

/**
 * Check if a master key has been set up.
 */
export async function hasMasterKey(): Promise<boolean> {
  return (await getMasterKey()) !== null;
}

/**
 * Derive a sub-key for Yjs sync updates from the master key using libsodium's KDF.
 *
 * This ensures key separation: the master key is used for encrypting stored data,
 * while a derived sub-key is used for encrypting Yjs sync updates over the wire.
 * Compromise of one does not compromise the other.
 *
 * Uses crypto_kdf_derive_from_key with a fixed context string 'yjs-sync '.
 *
 * @param masterKey - The 256-bit master encryption key.
 * @param subKeyIndex - Optional sub-key index (default: 0). Use different indices
 *                      for different sub-keys if needed.
 * @returns A 256-bit derived sub-key.
 */
export async function deriveSyncKey(
  masterKey: Uint8Array,
  subKeyIndex: number = 0,
): Promise<Uint8Array> {
  await ensureReady();
  // crypto_kdf_derive_from_key(subKeyLen, subKeyId, ctx, masterKey)
  // ctx must be exactly 8 bytes
  return sodium.crypto_kdf_derive_from_key(
    KEY_LENGTH_BYTES,
    subKeyIndex,
    'yjs-sync',
    masterKey,
  );
}

/**
 * Derive a sub-key for local database encryption from the master key.
 *
 * Uses a distinct context string ('db-encr') to ensure domain separation:
 * the DB encryption key is cryptographically independent from the sync key
 * and the master key. Compromise of one key does not compromise the others.
 *
 * This key is intended for use with SQLCipher / encrypted SQLite adapters.
 * Currently, WatermelonDB's community SQLiteAdapter does not support
 * native encryption. Sensitive fields are encrypted at the application layer
 * (see src/storage/hydrate.ts). This function is provided so that when a
 * SQLCipher-capable native adapter is integrated, the key derivation is
 * already in place and tested.
 *
 * @param masterKey - The 256-bit master encryption key.
 * @returns A 256-bit derived sub-key for database encryption.
 */
export async function deriveDBKey(
  masterKey: Uint8Array,
): Promise<Uint8Array> {
  await ensureReady();
  return sodium.crypto_kdf_derive_from_key(
    KEY_LENGTH_BYTES,
    2, // distinct subkey ID from sync key (0) and future keys
    'db-encr',
    masterKey,
  );
}

/**
 * Store a new master key directly (e.g. from recovery phrase).
 * Overwrites any existing master key.
 */
export async function setMasterKey(key: Uint8Array): Promise<void> {
  await ensureReady();
  const keyBase64 = uint8ArrayToBase64(key);
  await secureStoreProxy.setItemAsync(
    SECURE_STORE_KEY_ALIAS,
    JSON.stringify({ key: keyBase64, type: 'recovery' }),
  );
}

/**
 * How the stored master key came to exist.
 *
 *   'passphrase' — derived from a family passphrase (setupMasterKey)
 *   'recovery'   — restored from, or minted alongside, a family recovery phrase
 *   'device'     — provisioned by this device on first launch, before it knew
 *                  about any family. It encrypts only this device's own data.
 *
 * The join flow needs the distinction: a 'device' key is NOT the family's key,
 * so an invitee holding one still has to enter the family's recovery phrase.
 *
 * @returns The provenance tag, or null if no key is stored.
 */
export async function getMasterKeyType(): Promise<string | null> {
  await ensureReady();
  try {
    const stored = await secureStoreProxy.getItemAsync(SECURE_STORE_KEY_ALIAS);
    if (!stored) return null;
    const { type } = JSON.parse(stored);
    return type ?? null;
  } catch {
    return null;
  }
}

/**
 * Re-tag the stored master key's provenance without changing the key itself.
 * Used by first-run provisioning, which mints its key through the recovery
 * path (so it is backed up) but must not masquerade as a family key.
 */
export async function setMasterKeyType(type: string): Promise<void> {
  await ensureReady();
  const stored = await secureStoreProxy.getItemAsync(SECURE_STORE_KEY_ALIAS);
  if (!stored) return;
  const envelope = JSON.parse(stored);
  envelope.type = type;
  await secureStoreProxy.setItemAsync(
    SECURE_STORE_KEY_ALIAS,
    JSON.stringify(envelope),
  );
}

/**
 * Clear the master key from secure storage (e.g. on family reset).
 */
export async function clearMasterKey(): Promise<void> {
  await secureStoreProxy.deleteItemAsync(SECURE_STORE_KEY_ALIAS);
}

/**
 * Encrypt the family master key with the voice assistant's RSA public key.
 */
export async function encryptMasterKeyWithAssistantPublicKey(
  masterKey: Uint8Array,
  publicKeyPem: string,
): Promise<string> {
  const webcrypto = require('isomorphic-webcrypto');
  await ensureReady();
  
  // 1. Strip headers and base64 decode SPKI DER bytes
  const base64 = publicKeyPem
    .replace(/-----BEGIN [\w ]+-----/g, '')
    .replace(/-----END [\w ]+-----/g, '')
    .replace(/\s/g, '');
  
  const derBytes = base64ToUint8Array(base64);

  // 2. Import SPKI public key
  const importedKey = await webcrypto.subtle.importKey(
    'spki',
    derBytes.buffer.slice(derBytes.byteOffset, derBytes.byteOffset + derBytes.byteLength),
    {
      name: 'RSA-OAEP',
      hash: { name: 'SHA-256' },
    },
    true,
    ['encrypt']
  );

  // 3. Encrypt the master key
  const ciphertextBuffer = await webcrypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    importedKey,
    masterKey
  );

  // 4. Return as base64 string
  return uint8ArrayToBase64(new Uint8Array(ciphertextBuffer));
}