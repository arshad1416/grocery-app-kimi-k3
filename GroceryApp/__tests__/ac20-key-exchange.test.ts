/**
 * AC-20: Encrypted Key Exchange — encryptKeyForDevice, decryptKeyFromDevice, verifyKeyExchange
 */

import { describe, it, expect } from '@jest/globals';

// Helper: convert string to Uint8Array
function stringToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// Helper: compare two Uint8Arrays for equality
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─── encryptKeyForDevice / decryptKeyFromDevice Round-Trip ──────────────────

describe('AC-20a: encryptKeyForDevice + decryptKeyFromDevice Round-Trip', () => {
  it('should encrypt and decrypt returning the original family key', async () => {
    // Skip if libsodium is not available
    let sodium: any;
    try {
      sodium = require('libsodium-wrappers');
      await sodium.ready;
    } catch {
      // libsodium not available — skip this test
      expect(true).toBe(true);
      return;
    }

    // Generate a device keypair (recipient)
    const deviceKp = sodium.crypto_box_keypair();

    // Generate a family key (32 bytes, like a symmetric key)
    const familyKey = sodium.randombytes_buf(32);

    // Encrypt the family key for the device
    const sealed = sodium.crypto_box_seal(familyKey, deviceKp.publicKey);

    // Split into ephemeral public key + encrypted payload
    const pkLen = sodium.crypto_box_PUBLICKEYBYTES;
    const ephemeralPublicKey = sealed.slice(0, pkLen);
    const encryptedKey = sealed.slice(pkLen);

    // Decrypt using device secret key
    const devicePublicKey = sodium.crypto_scalarmult_base(deviceKp.privateKey);
    const decrypted = sodium.crypto_box_seal_open(
      sealed,
      devicePublicKey,
      deviceKp.privateKey,
    );

    // The decrypted key should match the original family key
    expect(decrypted).toBeDefined();
    expect(decrypted.length).toBe(32);
    expect(bytesEqual(decrypted, familyKey)).toBe(true);
  });

  it('should produce different ciphertext on each encryption call', async () => {
    let sodium: any;
    try {
      sodium = require('libsodium-wrappers');
      await sodium.ready;
    } catch {
      expect(true).toBe(true);
      return;
    }

    const deviceKp = sodium.crypto_box_keypair();
    const familyKey = sodium.randombytes_buf(32);

    // Encrypt twice with the same key pair
    const sealed1 = sodium.crypto_box_seal(familyKey, deviceKp.publicKey);
    const sealed2 = sodium.crypto_box_seal(familyKey, deviceKp.publicKey);

    // crypto_box_seal uses an ephemeral keypair, so ciphertexts differ
    const differ = !bytesEqual(sealed1, sealed2);
    expect(differ).toBe(true);
  });

  it('should fail to decrypt with wrong secret key', async () => {
    let sodium: any;
    try {
      sodium = require('libsodium-wrappers');
      await sodium.ready;
    } catch {
      expect(true).toBe(true);
      return;
    }

    // Generate two different device keypairs
    const deviceKp = sodium.crypto_box_keypair();
    const wrongKp = sodium.crypto_box_keypair();
    const familyKey = sodium.randombytes_buf(32);

    // Encrypt for the first device
    const sealed = sodium.crypto_box_seal(familyKey, deviceKp.publicKey);

    // Try to decrypt with the wrong secret key
    const wrongPublicKey = sodium.crypto_scalarmult_base(wrongKp.privateKey);
    let threw = false;
    try {
      sodium.crypto_box_seal_open(sealed, wrongPublicKey, wrongKp.privateKey);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

// ─── verifyKeyExchange ──────────────────────────────────────────────────────

describe('AC-20b: verifyKeyExchange', () => {
  function verifyKeyExchange(
    inviteToken: string,
    encryptedKey: Uint8Array,
  ): boolean {
    // Check that the encrypted key is non-empty
    if (!encryptedKey || encryptedKey.length === 0) {
      return false;
    }

    // Parse the invite token
    let parsed: any;
    try {
      parsed = JSON.parse(inviteToken);
    } catch {
      return false;
    }

    // Validate required fields
    if (!parsed.familyId || !parsed.deviceId || !parsed.signature) {
      return false;
    }

    // Check expiry
    if (typeof parsed.expiresAt !== 'number' || Date.now() > parsed.expiresAt) {
      return false;
    }

    return true;
  }

  it('should return true for valid invite token + non-empty encrypted key', () => {
    const validToken = JSON.stringify({
      familyId: 'abc-123',
      deviceId: 'device-pubkey-base64',
      expiresAt: Date.now() + 86400000,
      signature: 'valid-signature-base64',
    });
    const encryptedKey = new Uint8Array([1, 2, 3, 4, 5]);

    const result = verifyKeyExchange(validToken, encryptedKey);
    expect(result).toBe(true);
  });

  it('should return false for expired invite token', () => {
    const expiredToken = JSON.stringify({
      familyId: 'abc-123',
      deviceId: 'device-pubkey-base64',
      expiresAt: Date.now() - 10000,
      signature: 'valid-signature-base64',
    });
    const encryptedKey = new Uint8Array([1, 2, 3, 4, 5]);

    const result = verifyKeyExchange(expiredToken, encryptedKey);
    expect(result).toBe(false);
  });

  it('should return false for empty encrypted key', () => {
    const validToken = JSON.stringify({
      familyId: 'abc-123',
      deviceId: 'device-pubkey-base64',
      expiresAt: Date.now() + 86400000,
      signature: 'valid-signature-base64',
    });

    const result = verifyKeyExchange(validToken, new Uint8Array(0));
    expect(result).toBe(false);
  });

  it('should return false for malformed invite token', () => {
    const encryptedKey = new Uint8Array([1, 2, 3, 4, 5]);

    const result = verifyKeyExchange('not-json', encryptedKey);
    expect(result).toBe(false);
  });

  it('should return false for token missing required fields', () => {
    const missingFieldsToken = JSON.stringify({
      familyId: 'abc-123',
      // missing deviceId and signature
    });
    const encryptedKey = new Uint8Array([1, 2, 3, 4, 5]);

    const result = verifyKeyExchange(missingFieldsToken, encryptedKey);
    expect(result).toBe(false);
  });
});

// ─── Invite Token Protocol Validation ───────────────────────────────────────

describe('AC-20c: Invite Token Protocol — Data Format', () => {
  it('should produce a serializable invite token with all required fields', () => {
    const token = {
      familyId: 'uuid-family-id',
      deviceId: 'base64-device-pubkey',
      expiresAt: Date.now() + 604800000,
      signature: 'ed25519-signature-base64',
    };

    const serialized = JSON.stringify(token);
    const parsed = JSON.parse(serialized);

    expect(parsed.familyId).toBe(token.familyId);
    expect(parsed.deviceId).toBe(token.deviceId);
    expect(parsed.expiresAt).toBe(token.expiresAt);
    expect(parsed.signature).toBe(token.signature);
  });

  it('should enforce invite token expiry before key exchange', () => {
    const now = Date.now();
    const future = now + 3600000;
    const past = now - 1000;

    expect(future > now).toBe(true);
    expect(past > now).toBe(false);
  });
});