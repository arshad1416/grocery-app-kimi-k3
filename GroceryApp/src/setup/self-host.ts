/**
 * Self-Hosted Setup — pairing code generation and parsing.
 *
 * Design:
 *  - Pairing codes are signed JSON blobs containing { version, deviceId, familyId, relayUrl }
 *  - Signed with the device's Ed25519 key for authenticity
 *  - Parsed and verified on the receiving device
 *  - Used during self-hosted pairing workflow (QR code scanning)
 *
 * The pairing code is the mechanism by which a self-hosted relay server
 * communicates its connection details to the app, and the app authenticates
 * itself to the server.
 */

import { initCrypto } from '../crypto/index';
import { getDeviceKeypair } from '../identity/device';
import type { DeviceKeypair, PairingCode } from '../types';

// ─── Constants ───────────────────────────────────────────────────────────────

export const PAIRING_CODE_VERSION = 1;
/**
 * Pairing codes live as long as family invites (7 days): the combined join QR
 * is persisted in Settings and re-displayed, and its Generate alert promises
 * 7-day validity. One-time-use and expiry of the JOIN itself are enforced by
 * the invite half (server-side); the pairing code only carries the relay
 * address. (Was 5 minutes, which made every re-displayed QR dead on arrival.)
 */
export const PAIRING_CODE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Internal Helpers ────────────────────────────────────────────────────────

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const sodium = require('react-native-libsodium');
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const sodium = require('react-native-libsodium');
  return sodium.from_base64(b64, sodium.base64_variants.ORIGINAL);
}

function serializePairingCodePayload(
  code: Omit<PairingCode, 'signature'>,
): string {
  return JSON.stringify({
    version: code.version,
    deviceId: code.deviceId,
    familyId: code.familyId,
    relayUrl: code.relayUrl,
    signerKey: code.signerKey,
    createdAt: code.createdAt,
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a signed pairing code for self-hosted setup.
 *
 * The pairing code is a JSON object containing connection details,
 * signed with the device's Ed25519 key for authenticity.
 *
 * @param deviceId - The device's public key as a base64 string.
 * @param familyId - The family ID (UUID).
 * @param relayUrl - The WebSocket URL of the relay server.
 * @returns A PairingCode object with signature.
 */
export async function generatePairingCode(
  deviceId: string,
  familyId: string,
  relayUrl: string,
): Promise<PairingCode> {
  await initCrypto();
  const sodium = require('react-native-libsodium');
  await sodium.ready;

  // Sign with an Ed25519 keypair derived from the device's SECRET key (same
  // scheme as family invites). The old code derived the signing keypair from
  // the PUBLIC deviceId, which anyone could reproduce — forgeable signatures.
  const deviceKeypair = getDeviceKeypair();
  const signKp = sodium.crypto_sign_seed_keypair(
    deviceKeypair.privateKey.slice(0, 32),
  );

  const codePayload = {
    version: PAIRING_CODE_VERSION,
    deviceId,
    familyId,
    relayUrl,
    signerKey: uint8ArrayToBase64(signKp.publicKey),
    createdAt: Date.now(),
  };

  const serialized = serializePairingCodePayload(codePayload);

  const signature = sodium.crypto_sign_detached(
    new TextEncoder().encode(serialized),
    signKp.privateKey,
  );

  return {
    ...codePayload,
    signature: uint8ArrayToBase64(signature),
  };
}

/**
 * Parse and verify a pairing code.
 *
 * Verifies the Ed25519 signature and checks that the code hasn't expired.
 *
 * @param code - The PairingCode object to verify.
 * @returns The verified PairingCode.
 * @throws If the signature is invalid or the code has expired.
 */
export async function parsePairingCode(
  code: PairingCode,
): Promise<PairingCode> {
  await initCrypto();
  const sodium = require('react-native-libsodium');
  await sodium.ready;

  // Check version
  if (code.version !== PAIRING_CODE_VERSION) {
    throw new Error(
      `Unsupported pairing code version: ${code.version}. Expected: ${PAIRING_CODE_VERSION}`,
    );
  }

  // Check expiry
  if (Date.now() - code.createdAt > PAIRING_CODE_MAX_AGE_MS) {
    throw new Error('Pairing code has expired');
  }

  const { signature, ...payload } = code;
  const serialized = serializePairingCodePayload(payload);
  const messageBytes = new TextEncoder().encode(serialized);
  const signatureBytes = base64ToUint8Array(signature);

  // Verify against the embedded signer key (Ed25519 public key). Like family
  // invites, the code is self-certifying: authenticity comes from the
  // out-of-band QR handoff, and the signature proves the payload wasn't
  // modified after the signer created it.
  if (!code.signerKey) {
    throw new Error('Pairing code missing signerKey (unsupported legacy format)');
  }
  const signPk = base64ToUint8Array(code.signerKey);

  const valid = sodium.crypto_sign_verify_detached(
    signatureBytes,
    messageBytes,
    signPk,
  );

  if (!valid) {
    throw new Error('Pairing code signature is invalid');
  }

  return code;
}

/**
 * Parse a pairing code from a JSON string (e.g., QR code content).
 *
 * @param json - JSON string representation of a PairingCode.
 * @returns The verified PairingCode.
 */
export async function parsePairingCodeString(json: string): Promise<PairingCode> {
  let code: PairingCode;
  try {
    code = JSON.parse(json) as PairingCode;
  } catch {
    throw new Error('Invalid pairing code format: not valid JSON');
  }

  return parsePairingCode(code);
}

/**
 * Serialize a pairing code to a JSON string (for QR code generation).
 */
export function pairingCodeToString(code: PairingCode): string {
  return JSON.stringify(code);
}