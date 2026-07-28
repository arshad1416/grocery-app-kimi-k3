/**
 * Identity System Tests
 *
 * Tests for:
 *  - Device key generation produces valid keypair
 *  - Device ID is consistent (same public key)
 *  - Device ID changes after rotate
 *  - Create family invite with valid signature
 *  - Verify family invite with correct signature passes
 *  - Verify family invite with wrong signature fails
 *  - Verify expired invite fails
 *  - Accept invite stores family ID
 *  - Passkey registration mock
 */

import sodium from 'libsodium-wrappers';
import {
  initDeviceIdentity,
  getDeviceId,
  getDeviceKeypair,
  rotateDeviceKey,
  clearDeviceIdentity,
  isDeviceInitialized,
} from '../src/identity/device';
import {
  createFamilyInvite,
  verifyFamilyInvite,
  acceptFamilyInvite,
  getFamilyId,
  leaveFamily,
  clearFamilyMembership,
  hasFamilyMembership,
} from '../src/identity/family';
import {
  isPasskeySupported,
  registerPasskey,
  authenticateWithPasskey,
  hasPasskey,
  removePasskey,
  clearPasskeyData,
} from '../src/identity/passkeys';
import * as SecureStore from 'expo-secure-store';

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  getItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

beforeAll(async () => {
  await sodium.ready;
});

beforeEach(async () => {
  jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
});

afterEach(async () => {
  await clearDeviceIdentity().catch(() => {});
  await clearFamilyMembership().catch(() => {});
  await clearPasskeyData().catch(() => {});
});

describe('Device Key Generation', () => {
  test('initDeviceIdentity generates a valid keypair on first launch', async () => {
    const deviceId = await initDeviceIdentity();

    expect(deviceId).toBeDefined();
    expect(typeof deviceId).toBe('string');
    expect(deviceId.length).toBeGreaterThan(0);

    const kp = getDeviceKeypair();
    expect(kp.publicKey).toBeDefined();
    expect(kp.privateKey).toBeDefined();
    expect(kp.publicKey.length).toBe(32);
    expect(kp.privateKey.length).toBe(32);

    expect(isDeviceInitialized()).toBe(true);
  });

  test('getDeviceId returns consistent ID', async () => {
    const id1 = await initDeviceIdentity();
    const id2 = getDeviceId();

    expect(id1).toBe(id2);
  });

  test('getDeviceId throws if not initialized', () => {
    expect(() => getDeviceId()).toThrow();
  });

  test('getDeviceKeypair throws if not initialized', () => {
    expect(() => getDeviceKeypair()).toThrow();
  });
});

describe('Key Rotation', () => {
  test('rotateDeviceKey produces new keypair with different ID', async () => {
    // Mock the first init
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => {
      // Return different mock keys depending on what's being requested
      return Promise.resolve(null); // First time
    });

    const originalId = await initDeviceIdentity();

    // Now mock as if we have stored keys for future gets
    // After init, the keys are cached, so rotate should work
    const newId = await rotateDeviceKey();

    expect(newId).toBeDefined();
    expect(newId).not.toBe(originalId);

    const kp = getDeviceKeypair();
    expect(kp.publicKey).toBeDefined();
  });
});

describe('Family Invite — Creation and Verification', () => {
  test('createFamilyInvite produces a valid signed token', async () => {
    await initDeviceIdentity();
    const kp = getDeviceKeypair();

    const invite = await createFamilyInvite(kp);

    expect(invite).toBeDefined();
    expect(invite.familyId).toBeDefined();
    expect(invite.deviceId).toBeDefined();
    expect(invite.expiresAt).toBeGreaterThan(Date.now());
    expect(invite.signature).toBeDefined();
    expect(typeof invite.signature).toBe('string');
    expect(invite.signature.length).toBeGreaterThan(0);
  });

  test('verifyFamilyInvite passes with valid invite', async () => {
    await initDeviceIdentity();
    const kp = getDeviceKeypair();

    const invite = await createFamilyInvite(kp);
    const result = await verifyFamilyInvite(invite);

    expect(result.valid).toBe(true);
    expect(result.familyId).toBe(invite.familyId);
    expect(result.inviterDeviceId).toBe(invite.deviceId);
  });

  test('verifyFamilyInvite fails with wrong signature', async () => {
    await initDeviceIdentity();
    const kp = getDeviceKeypair();

    const invite = await createFamilyInvite(kp);
    // Tamper with the signature
    const tampered = {
      ...invite,
      signature: 'aW52YWxpZF9zaWduYXR1cmU=' + 'a',
    };

    await expect(verifyFamilyInvite(tampered)).rejects.toThrow();
  });

  test('verifyFamilyInvite fails with expired invite', async () => {
    await initDeviceIdentity();
    const kp = getDeviceKeypair();

    // Create an invite that expired 1 hour ago
    const invite = await createFamilyInvite(kp, Date.now() - 3600_000);

    await expect(verifyFamilyInvite(invite)).rejects.toThrow('expired');
  });

  test('verifyFamilyInvite fails with invalid deviceId', async () => {
    await initDeviceIdentity();
    const kp = getDeviceKeypair();

    const invite = await createFamilyInvite(kp);
    const tampered = {
      ...invite,
      deviceId: 'aW52YWxpZF9kZXZpY2VfaWQ=',
    };

    await expect(verifyFamilyInvite(tampered)).rejects.toThrow();
  });

  test('acceptFamilyInvite stores family membership', async () => {
    await initDeviceIdentity();
    const inviterKp = getDeviceKeypair();

    const invite = await createFamilyInvite(inviterKp);

    // Accept from a "different" device perspective
    const result = await acceptFamilyInvite(invite, inviterKp);

    expect(result).toBeDefined();
    expect(result.familyId).toBe(invite.familyId);
    expect(result.joinedAt).toBeGreaterThan(0);
    expect(result.deviceId).toBe(getDeviceId());

    // Verify stored
    const storedFamilyId = await getFamilyId();
    expect(storedFamilyId).toBe(invite.familyId);

    const hasMembership = await hasFamilyMembership();
    expect(hasMembership).toBe(true);
  });

  test('acceptFamilyInvite rejects expired invite', async () => {
    await initDeviceIdentity();
    const kp = getDeviceKeypair();

    const invite = await createFamilyInvite(kp, Date.now() - 3600_000);

    await expect(
      acceptFamilyInvite(invite, kp),
    ).rejects.toThrow();
  });
});

describe('Family Membership', () => {
  test('getFamilyId returns null without membership', async () => {
    const id = await getFamilyId();
    expect(id).toBeNull();
  });

  test('hasFamilyMembership returns false without membership', async () => {
    const has = await hasFamilyMembership();
    expect(has).toBe(false);
  });

  test('leaveFamily clears membership', async () => {
    await initDeviceIdentity();
    const kp = getDeviceKeypair();
    const invite = await createFamilyInvite(kp);
    await acceptFamilyInvite(invite, kp);

    expect(await hasFamilyMembership()).toBe(true);

    await leaveFamily();
    expect(await hasFamilyMembership()).toBe(false);
    expect(await getFamilyId()).toBeNull();
  });
});

describe('Passkey Support', () => {
  test('isPasskeySupported returns false in test environment', async () => {
    const supported = await isPasskeySupported();
    // In Node.js test env, there's no WebAuthn API
    expect(supported).toBe(false);
  });

  test('registerPasskey returns null when passkeys not supported', async () => {
    await initDeviceIdentity();
    const credential = await registerPasskey();
    expect(credential).toBeNull();
  });

  test('authenticateWithPasskey returns null when passkeys not supported', async () => {
    await initDeviceIdentity();
    const result = await authenticateWithPasskey();
    expect(result).toBeNull();
  });

  test('hasPasskey returns false in test env', async () => {
    await initDeviceIdentity();
    const has = await hasPasskey();
    expect(has).toBe(false);
  });

  test('removePasskey does not throw', async () => {
    await initDeviceIdentity();
    await expect(removePasskey()).resolves.toBeUndefined();
  });
});

describe('End-to-End Flow', () => {
  test('full flow: init → create invite → verify → accept → get family', async () => {
    await initDeviceIdentity();
    const kp = getDeviceKeypair();
    const deviceId = getDeviceId();

    // Create invite
    const invite = await createFamilyInvite(kp);
    expect(invite.deviceId).toBeDefined();

    // Verify
    const verification = await verifyFamilyInvite(invite);
    expect(verification.valid).toBe(true);

    // Accept
    const membership = await acceptFamilyInvite(invite, kp);
    expect(membership.familyId).toBe(invite.familyId);

    // Get family ID
    const storedFamilyId = await getFamilyId();
    expect(storedFamilyId).toBe(invite.familyId);
  });

  test('device ID format is consistent base64', async () => {
    await initDeviceIdentity();
    const deviceId = getDeviceId();

    // Device ID should be valid base64
    expect(() => {
      const decoded = Buffer.from(deviceId, 'base64');
      expect(decoded.length).toBe(32);
    }).not.toThrow();
  });
});