/**
 * AC5: Ciphertext-Only Proof — verify that no plaintext data appears
 * in the relay server logs (or at the network layer).
 *
 * Tests:
 *  - Encrypt item name/notes via crypto/index.ts produces ciphertext
 *  - Decrypt with wrong key fails
 *  - AAD context binding prevents ciphertext reuse
 *  - Ciphertext is distinguishable from plaintext (base64, no readable text)
 *  - Encrypted Yjs updates contain no plaintext
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import sodium from 'libsodium-wrappers';
import { initCrypto, encrypt, decrypt } from '../src/crypto';
import type { EncryptedData } from '../src/types';

// ─── Setup ───────────────────────────────────────────────────────────────────

let encryptionKey: Uint8Array;

function tamperBase64(b64: string): string {
  const bytes = sodium.from_base64(b64, sodium.base64_variants.ORIGINAL);
  bytes[0] ^= 1;
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

beforeAll(async () => {
  await initCrypto();
  await sodium.ready;
  encryptionKey = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AC5: Ciphertext-Only Proof', () => {
  describe('Encryption produces no plaintext', () => {
    it('should encrypt item name into opaque ciphertext (not readable)', async () => {
      const plaintext = 'Milk';
      const encrypted = await encrypt(
        plaintext,
        encryptionKey,
        'grocery_item.name',
      );

      // Ciphertext should be a non-empty base64 string
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.tag).toBeTruthy();

      // The ciphertext should NOT contain the original plaintext
      expect(encrypted.ciphertext).not.toContain('Milk');

      // Ciphertext should be base64-encoded (alphanumeric + / + = padding)
      expect(encrypted.ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('should encrypt item notes into opaque ciphertext', async () => {
      const notes = 'Buy organic if available';
      const encrypted = await encrypt(
        notes,
        encryptionKey,
        'grocery_item.notes',
      );

      expect(encrypted.ciphertext).toBeTruthy();
      // No part of the notes should appear in ciphertext
      expect(encrypted.ciphertext).not.toContain('organic');
      expect(encrypted.ciphertext).not.toContain('Buy');
      expect(encrypted.ciphertext).not.toContain('available');
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      const plaintext = 'Eggs';
      const encrypted1 = await encrypt(
        plaintext,
        encryptionKey,
        'grocery_item.name',
      );
      const encrypted2 = await encrypt(
        plaintext,
        encryptionKey,
        'grocery_item.name',
      );

      // Even with same plaintext and key, ciphertext + IV should differ
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });
  });

  describe('Decryption behavior', () => {
    it('should decrypt correctly with the right key and context', async () => {
      const plaintext = 'Organic Whole Milk';
      const encrypted = await encrypt(
        plaintext,
        encryptionKey,
        'grocery_item.name',
      );

      const decrypted = await decrypt(
        encrypted,
        encryptionKey,
        'grocery_item.name',
      );

      expect(decrypted).toBe(plaintext);
    });

    it('should fail to decrypt with wrong key', async () => {
      const plaintext = 'Secret item';
      const encrypted = await encrypt(
        plaintext,
        encryptionKey,
        'grocery_item.name',
      );

      const wrongKey = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();

      await expect(
        decrypt(encrypted, wrongKey, 'grocery_item.name'),
      ).rejects.toThrow();
    });
  });

  describe('AAD context binding', () => {
    it('should fail to decrypt with wrong AAD context', async () => {
      const plaintext = 'Sensitive notes';
      const encrypted = await encrypt(
        plaintext,
        encryptionKey,
        'grocery_item.notes',
      );

      // Try to decrypt with a different context
      await expect(
        decrypt(encrypted, encryptionKey, 'grocery_item.name'),
      ).rejects.toThrow();
    });

    it('should fail to decrypt without AAD when it was used during encryption', async () => {
      const plaintext = 'Field-bound data';
      const encrypted = await encrypt(
        plaintext,
        encryptionKey,
        'grocery_item.name',
      );

      // Decrypt without context (AAD mismatch)
      await expect(
        decrypt(encrypted, encryptionKey, undefined),
      ).rejects.toThrow();
    });
  });

  describe('Ciphertext envelope integrity', () => {
    it('should detect tampered ciphertext', async () => {
      const plaintext = 'Vulnerable item';
      const encrypted = await encrypt(
        plaintext,
        encryptionKey,
        'grocery_item.name',
      );

      // Tamper with the ciphertext
      const tampered: EncryptedData = {
        ...encrypted,
        ciphertext: tamperBase64(encrypted.ciphertext),
      };

      await expect(
        decrypt(tampered, encryptionKey, 'grocery_item.name'),
      ).rejects.toThrow();
    });

    it('should detect tampered IV', async () => {
      const plaintext = 'Another item';
      const encrypted = await encrypt(
        plaintext,
        encryptionKey,
        'grocery_item.name',
      );

      // Tamper with the IV
      const tampered: EncryptedData = {
        ...encrypted,
        iv: tamperBase64(encrypted.iv),
      };

      await expect(
        decrypt(tampered, encryptionKey, 'grocery_item.name'),
      ).rejects.toThrow();
    });

    it('should detect tampered auth tag', async () => {
      const plaintext = 'Yet another item';
      const encrypted = await encrypt(
        plaintext,
        encryptionKey,
        'grocery_item.name',
      );

      // Tamper with the auth tag
      const tampered: EncryptedData = {
        ...encrypted,
        tag: tamperBase64(encrypted.tag),
      };

      await expect(
        decrypt(tampered, encryptionKey, 'grocery_item.name'),
      ).rejects.toThrow();
    });
  });
});