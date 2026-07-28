/**
 * IFTTT Webhook Client.
 *
 * Provides:
 *  - signRequest(payload, secret): HMAC-SHA256 signature generation
 *  - buildWebhookUrl(baseUrl, item): Constructs a signed webhook URL
 *  - verifySignature(payload, signature, secret): Verifies HMAC-SHA256 signatures
 *
 * The relay server exposes a POST endpoint at /api/webhook/ifttt that
 * accepts signed JSON payloads from IFTTT Applets or Google Assistant routines.
 *
 * Security model:
 *  - Every payload is HMAC-SHA256 signed with a shared secret.
 *  - The signature is passed as a query parameter ?sig=<hex>.
 *  - The relay verifies the signature before processing.
 *  - Replay protection: payload includes a timestamp field.
 */

import type { ParsedItem } from './types';

// ─── HMAC-SHA256 Signing ─────────────────────────────────────────────────────

/**
 * Generates an HMAC-SHA256 signature for a JSON payload.
 *
 * Uses the Web Crypto API (available in modern JS runtimes and React Native).
 * The payload is sorted by keys and JSON-stringified before signing to ensure
 * canonical representation.
 *
 * @param payload - The object to sign (will be JSON-stringified canonically).
 * @param secret  - The shared HMAC secret key.
 * @returns Hex-encoded HMAC-SHA256 digest.
 */
export async function signRequest(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(canonical);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hex;
}

// ─── Webhook URL Construction ─────────────────────────────────────────────────

/**
 * Builds a signed webhook URL for the IFTTT / Google Assistant relay endpoint.
 *
 * The URL includes the item details as query parameters, plus an HMAC
 * signature for verification.
 *
 * @param baseUrl - Base URL of the relay server (e.g. "https://relay.example.com").
 * @param item    - The parsed grocery item to add.
 * @returns Full signed webhook URL.
 */
export async function buildWebhookUrl(
  baseUrl: string,
  item: ParsedItem,
): Promise<string> {
  const payload: Record<string, unknown> = {
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    timestamp: Date.now(),
    ...(item.notes ? { notes: item.notes } : {}),
  };

  const secret = await getWebhookSecret();
  const sig = await signRequest(payload, secret);

  const params = new URLSearchParams();
  params.set('name', item.name);
  params.set('quantity', String(item.quantity));
  params.set('unit', item.unit);
  params.set('timestamp', String(payload.timestamp));
  params.set('sig', sig);
  if (item.notes) params.set('notes', item.notes);

  return `${baseUrl.replace(/\/+$/, '')}/api/webhook/ifttt?${params.toString()}`;
}

// ─── Signature Verification ───────────────────────────────────────────────────

/**
 * Verifies an HMAC-SHA256 signature against a payload.
 *
 * Used by the relay server endpoint to validate incoming webhook requests.
 *
 * @param payload   - The original object that was signed.
 * @param signature - The hex-encoded HMAC digest to verify.
 * @param secret    - The shared HMAC secret key.
 * @returns True if the signature matches, false otherwise.
 */
export async function verifySignature(
  payload: Record<string, unknown>,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (typeof signature !== 'string') return false;
  const expected = await signRequest(payload, secret);

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signature.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Secret Retrieval ─────────────────────────────────────────────────────────

/**
 * Retrieve the webhook shared secret.
 *
 * In production, this should come from environment variables or secure storage.
 * For Phase 2, if no env var is set, returns an empty string (which will cause
 * signature verification to fail — safe default).
 */
async function getWebhookSecret(): Promise<string> {
  // Try environment variable first (expo-constants / process.env)
  try {
    const envSecret = process.env.IFTTT_WEBHOOK_SECRET;
    if (envSecret && envSecret.length > 0) {
      return envSecret;
    }
  } catch {
    // process.env may not be available in all RN environments
  }
  // No default secret — force users to configure one explicitly
  return '';
}