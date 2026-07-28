/**
 * AC1: Family Invite Flow — create family, generate QR code,
 * parse invite token, verify Ed25519 signature.
 *
 * Tests:
 *  - createFamilyInvite() returns a signed token
 *  - verifyFamilyInvite() validates the signature
 *  - verifyFamilyInvite() rejects expired tokens
 *  - verifyFamilyInvite() rejects tampered signatures
 *  - Pairing code generation and parsing round-trip
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import sodium from 'libsodium-wrappers';
import { initCrypto } from '../src/crypto';
import { initDeviceIdentity, getDeviceKeypair, clearDeviceIdentity } from '../src/identity/device';
import { createFamilyInvite, verifyFamilyInvite, acceptFamilyInvite } from '../src/identity/family';
import { generatePairingCode, parsePairingCode, parsePairingCodeString, pairingCodeToString } from '../src/setup/self-host';
import type { FamilyInviteToken, PairingCode } from '../src/types';

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initCrypto();
  await sodium.ready;
  // Initialise device identity (generates keypair)
  await initDeviceIdentity();
});

afterAll(async () => {
  await clearDeviceIdentity();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AC1: Family Invite Flow', () => {
  describe('Family Invite Token', () => {
    it('should create a signed invite token', async () => {
      const kp = getDeviceKeypair();
      const invite = await createFamilyInvite(kp);

      expect(invite).toBeDefined();
      expect(invite.familyId).toBeTruthy();
      expect(invite.deviceId).toBeTruthy();
      expect(invite.expiresAt).toBeGreaterThan(Date.now());
      expect(invite.signature).toBeTruthy();
      // Signature should be a non-empty base64 string
      expect(invite.signature.length).toBeGreaterThan(32);
    });

    it('should verify a valid invite token successfully', async () => {
      const kp = getDeviceKeypair();
      const invite = await createFamilyInvite(kp);

      const verification = await verifyFamilyInvite(invite);

      expect(verification.valid).toBe(true);
      expect(verification.familyId).toBe(invite.familyId);
      expect(verification.inviterDeviceId).toBe(invite.deviceId);
    });

    it('should reject an expired invite token', async () => {
      const kp = getDeviceKeypair();
      // Create invite with 1ms expiry (already expired)
      const invite = await createFamilyInvite(kp, Date.now() - 1);

      await expect(verifyFamilyInvite(invite)).rejects.toThrow('expired');
    });

    it('should reject a tampered signature', async () => {
      const kp = getDeviceKeypair();
      const invite = await createFamilyInvite(kp);

      // Tamper with the signature — flip the first character to a guaranteed
      // different one. (A previous `.replace(/A/g, 'B')` was a no-op whenever
      // the random signature contained no 'A', making this test flaky.)
      const tamperedInvite: FamilyInviteToken = {
        ...invite,
        signature:
          (invite.signature[0] === 'A' ? 'B' : 'A') + invite.signature.slice(1),
      };

      await expect(verifyFamilyInvite(tamperedInvite)).rejects.toThrow();
    });
  });

  describe('Pairing Code', () => {
    it('should generate and verify a pairing code round-trip', async () => {
      const kp = getDeviceKeypair();
      const deviceId = sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL);

      const code = await generatePairingCode(
        deviceId,
        'test-family-id',
        'ws://localhost:8080',
      );

      expect(code.version).toBe(1);
      expect(code.deviceId).toBe(deviceId);
      expect(code.familyId).toBe('test-family-id');
      expect(code.relayUrl).toBe('ws://localhost:8080');
      expect(code.createdAt).toBeGreaterThan(0);
      expect(code.signature).toBeTruthy();

      // Verify the code
      const verified = await parsePairingCode(code);
      expect(verified.deviceId).toBe(deviceId);
    });

    it('should parse a pairing code from JSON string', async () => {
      const kp = getDeviceKeypair();
      const deviceId = sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL);

      const code = await generatePairingCode(
        deviceId,
        'test-family-json',
        'ws://localhost:8080',
      );

      const json = pairingCodeToString(code);
      const parsed = await parsePairingCodeString(json);

      expect(parsed.familyId).toBe('test-family-json');
      expect(parsed.deviceId).toBe(deviceId);
    });

    it('should accept a family invite after verification', async () => {
      const inviterKp = getDeviceKeypair();
      const invite = await createFamilyInvite(inviterKp);

      // Accept from a different device perspective
      const membership = await acceptFamilyInvite(invite, inviterKp);

      expect(membership.familyId).toBe(invite.familyId);
      expect(membership.deviceId).toBeTruthy();
      expect(membership.joinedAt).toBeGreaterThan(0);
    });

    it('should reject an invalid pairing code JSON', async () => {
      await expect(
        parsePairingCodeString('not-json'),
      ).rejects.toThrow('Invalid pairing code format');
    });
  });
});