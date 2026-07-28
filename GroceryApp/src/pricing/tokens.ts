/**
 * Contribution Tokens — RFC 9474 Blind RSA Token System (v2)
 *
 * Replaces the broken HMAC-based v1 scheme with proper Blind RSA signatures
 * using @cloudflare/blindrsa-ts (RSABSSA-SHA384-PSS-Randomized).
 *
 * Key differences from v1:
 *   - Uses Blind RSA (RFC 9474) instead of HMAC
 *   - Tokens come through the authenticated relay (not a separate issuer)
 *   - Pool verifies with a PUBLIC key only
 *   - Token format: "v2.<base64(signature + nonce)>"
 *
 * Flow:
 *   1. Fetch issuer public key from relay (GET /relay/public-key)
 *   2. Generate random 32-byte nonce
 *   3. Blind: blind(publicKey, nonce) → { blindedMsg, inv }
 *   4. Send to authenticated relay: POST /relay/request-token { blindedMsg }
 *   5. Receive: { blindSignature }
 *   6. Finalize: finalize(publicKey, nonce, blindSignature, inv) → token
 *   7. Wire format: "v2.<base64(token || nonce)>" (256-byte sig + 32-byte nonce)
 *
 * NOTE: This module uses Node.js crypto for the BlindRSA operations (via dynamic
 * import), but in React Native/Expo the @cloudflare/blindrsa-ts package uses
 * the built-in SubtleCrypto API which is available on both platforms.
 */

import { getSettings } from '../config/settings';
// expo-secure-store loaded lazily to avoid Hermes crash (chains to expo-asset at eval time)
let SecureStore: any = null;
async function getSecureStore(): Promise<any> {
  if (!SecureStore) {
    const mod = await import('expo-secure-store');
    SecureStore = mod;
  }
  return SecureStore;
}

const TOKEN_VERSION = 'v2';
const TOKEN_SEPARATOR = '.';
const REQUEST_TIMEOUT_MS = 10_000; // 10 seconds

// ─── In-Memory Cache ────────────────────────────────────────────────────────

interface CachedToken {
  token: string;      // Full wire token string
  cachedAt: number;   // When we cached it
}

let tokenCache: CachedToken | null = null;

/** Max cache age before forcing a refresh (22 hours). Tokens don't expire server-side. */
const MAX_CACHE_AGE_MS = 79_200_000; // 22 hours

/** SecureStore key for the relay token */
const RELAY_TOKEN_KEY = 'groceryapp.relay_token';

// ─── Public Key Cache ───────────────────────────────────────────────────────

let _cachedPublicKey: CryptoKey | null = null;
let _relayUrl: string | null = null;

/**
 * Get the relay HTTP URL from settings.
 */
function getRelayHttpUrl(): string | null {
  const { relayUrl, relayPort, poolUrl } = getSettings();

  // If poolUrl is set, the relay runs on the relay URL (pool is separate)
  const baseUrl = relayUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:');

  try {
    const parsed = new URL(baseUrl);
    if (parsed.port) {
      return baseUrl.replace(/\/+$/, '');
    }
    return `${baseUrl.replace(/\/+$/, '')}:${relayPort}`;
  } catch {
    return `${baseUrl}:${relayPort}`;
  }
}

/**
 * Get the relay token from SecureStore (same auth as WebSocket).
 * Returns null if not enrolled.
 */
async function getRelayToken(): Promise<string | null> {
  try {
    // The relay token is the device's relayToken from enrollment
    // It's stored as part of the relay state by the relay connection module.
    // For now, we use SecureStore to retrieve it.
    const stored = await (await getSecureStore()).getItemAsync(RELAY_TOKEN_KEY);
    return stored || null;
  } catch {
    return null;
  }
}

// ─── Cryptography ───────────────────────────────────────────────────────────

/**
 * Dynamically import the BlindRSA library (ESM module).
 */
async function getBlindRSA(): Promise<any> {
  // In Node.js test environment, use dynamic import
  try {
    const mod = await import('@cloudflare/blindrsa-ts');
    return mod;
  } catch {
    // In React Native, require should work
    // @ts-ignore
    const mod = require('@cloudflare/blindrsa-ts');
    return mod;
  }
}

// ─── Public Key ─────────────────────────────────────────────────────────────

/**
 * Fetch the issuer's public key from the relay server.
 * Caches in a module-level variable.
 */
async function fetchPublicKey(): Promise<CryptoKey> {
  if (_cachedPublicKey) return _cachedPublicKey;

  const relayUrl = getRelayHttpUrl();
  if (!relayUrl) {
    throw new Error('Relay URL not configured');
  }

  const response = await fetch(`${relayUrl}/relay/public-key`, {
    method: 'GET',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch public key: ${response.status}`);
  }

  const pemData = await response.text();

  // Parse PEM to DER (raw binary)
  const base64 = pemData
    .replace(/-----BEGIN [\w ]+-----/g, '')
    .replace(/-----END [\w ]+-----/g, '')
    .replace(/\s/g, '');
  const binaryStr = atob(base64);
  const derBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    derBytes[i] = binaryStr.charCodeAt(i);
  }

  // Import as CryptoKey for RSA-PSS verification
  const publicKey = await crypto.subtle.importKey(
    'spki',
    derBytes.buffer,
    { name: 'RSA-PSS', hash: 'SHA-384' },
    true,
    ['verify']
  );

  _cachedPublicKey = publicKey;
  return publicKey;
}

/**
 * Clear the cached public key (e.g. on relay URL change).
 */
export function clearPublicKeyCache(): void {
  _cachedPublicKey = null;
}

// ─── Blind RSA Token Protocol ───────────────────────────────────────────────

/**
 * Request a fresh contribution token from the relay server.
 *
 * Flow:
 *   1. Generate random 32-byte nonce
 *   2. Blind the nonce: { blindedMsg, inv } = blind(publicKey, nonce)
 *   3. POST to relay with Authorization: Bearer <relayToken>
 *   4. Receive blind signature
 *   5. Finalize: token = finalize(publicKey, nonce, blindSignature, inv)
 *   6. Return "v2.<base64(signature + nonce)>"
 *
 * Returns the full wire token string, or null if the relay is not configured
 * or authentication fails.
 */
export async function requestContributionToken(): Promise<string | null> {
  const relayUrl = getRelayHttpUrl();
  if (!relayUrl) {
    console.warn('[tokens] Relay URL not configured, skipping token request');
    return null;
  }

  const relayToken = await getRelayToken();
  if (!relayToken) {
    console.warn('[tokens] No relay token available (not enrolled?)');
    return null;
  }

  try {
    // 1. Fetch (or use cached) public key
    const publicKey = await fetchPublicKey();

    // 2. Import the BlindRSA module
    const { BlindRSA, Params } = await getBlindRSA();
    const suite = new BlindRSA(Params.RSABSSA_SHA384_PSS_Randomized);

    // 3. Generate random 32-byte nonce
    const nonce = new Uint8Array(32);
    crypto.getRandomValues(nonce);

    // 4. Blind the nonce
    const { blindedMsg, inv } = await suite.blind(publicKey, nonce);

    // 5. Send blinded message to relay
    const blindedBase64 = arrayBufferToBase64(blindedMsg);
    const response = await fetch(`${relayUrl}/relay/request-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${relayToken}`,
      },
      body: JSON.stringify({ blindedMsg: blindedBase64 }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        // Token rejected — clear cached token and public key
        console.warn('[tokens] Relay rejected token request:', response.status);
        clearContributionTokenCache();
        clearPublicKeyCache();
        return null;
      }
      console.warn('[tokens] Failed to request token:', response.status);
      return null;
    }

    const data = (await response.json()) as { blindSignature: string };

    // 6. Decode the blind signature
    const blindSignature = base64ToArrayBuffer(data.blindSignature);

    // 7. Finalize: produce the final token
    const finalTokenBytes = await suite.finalize(publicKey, nonce, blindSignature, inv);

    // 8. Wire format: "v2.<base64(signature + nonce)>"
    // The finalize output is the signature (256 bytes for 2048-bit RSA)
    // We concatenate it with the 32-byte nonce for the pool to verify
    const combined = new Uint8Array(finalTokenBytes.length + 32);
    combined.set(finalTokenBytes, 0);
    combined.set(nonce, finalTokenBytes.length);
    const token = TOKEN_VERSION + TOKEN_SEPARATOR + arrayBufferToBase64(combined);

    // Cache the token
    tokenCache = {
      token,
      cachedAt: Date.now(),
    };

    return token;
  } catch (err) {
    console.warn('[tokens] Error requesting contribution token:', err);
    return null;
  }
}

/**
 * Get a cached contribution token, or request a new one.
 *
 * Returns the full wire token string, or null if the relay is not configured.
 */
export async function getContributionToken(): Promise<string | null> {
  const relayUrl = getRelayHttpUrl();
  if (!relayUrl) {
    return null;
  }

  // Check cache
  if (tokenCache) {
    const age = Date.now() - tokenCache.cachedAt;
    if (age < MAX_CACHE_AGE_MS) {
      return tokenCache.token;
    }
    // Cache expired — clear it
    tokenCache = null;
  }

  return requestContributionToken();
}

/**
 * Clear the cached token (e.g. on 403 rejection).
 */
export function clearContributionTokenCache(): void {
  tokenCache = null;
}

// ─── Utility Functions ─────────────────────────────────────────────────────

function arrayBufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
