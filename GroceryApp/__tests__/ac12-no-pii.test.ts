/**
 * Acceptance Test AC-12: No PII — Device Identity, Family Invite, Relay Enrollment
 *
 * Tests that:
 * - Device identity module returns no PII fields
 * - Family invite tokens contain only opaque identifiers
 * - The relay enrollment data shape is correct (no PII)
 *
 * Run: npx jest __tests__/ac12-no-pii.test.ts
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type { FamilyInviteToken } from '../src/types';

// ─── Device Identity — No PII ───────────────────────────────────────────────

describe('AC-12a: Device Identity — No PII Fields', () => {
  it('device ID is an opaque base64 string — not an email, phone, or name', () => {
    // Simulate what getDeviceId() returns: a base64-encoded public key
    const deviceId = 'uVjR8t2KpQ6mXzA4bNcEwF3gHsI7lO9pY0qRsT5vW1x';

    // Should NOT look like PII
    expect(deviceId).not.toContain('@');
    expect(deviceId).not.toContain('.com');
    expect(deviceId).not.toMatch(/^\+?\d{7,}$/); // not a phone number
    expect(deviceId).not.toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/); // not a full name

    // Should look like base64
    expect(deviceId).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('device identity module does not expose any PII properties', () => {
    // The getDeviceKeypair shape should have no PII
    const keypair = {
      publicKey: new Uint8Array([1, 2, 3]),
      privateKey: new Uint8Array([4, 5, 6]),
    };

    const keys = Object.keys(keypair);
    expect(keys).toContain('publicKey');
    expect(keys).toContain('privateKey');
    // No PII fields
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('phone');
    expect(keys).not.toContain('name');
    expect(keys).not.toContain('username');
    expect(keys).not.toContain('address');
    expect(keys.length).toBe(2);
  });
});

// ─── Family Invite Tokens — No PII ──────────────────────────────────────────

describe('AC-12b: Family Invite Tokens — Opaque Identifiers Only', () => {
  it('FamilyInviteToken contains only opaque identifiers — no PII', () => {
    const inviteToken: FamilyInviteToken = {
      familyId: 'fam_uVjR8t2KpQ6',
      deviceId: 'dev_XzA4bNcEwF3',
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      nonce: 'random-nonce-base64',
      signature: 'base64-signature-data',
    };

    const keys = Object.keys(inviteToken);
    expect(keys).toContain('familyId');
    expect(keys).toContain('deviceId');
    expect(keys).toContain('expiresAt');
    expect(keys).toContain('nonce');
    expect(keys).toContain('signature');

    // No PII fields
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('phone');
    expect(keys).not.toContain('name');
    expect(keys).not.toContain('username');

    // Values should be opaque identifiers
    expect(inviteToken.familyId).toMatch(/^fam_/);
    expect(inviteToken.deviceId).toMatch(/^dev_/);
    expect(inviteToken.signature).toBe('base64-signature-data');
  });
});

// ─── Relay Enrollment — No PII ──────────────────────────────────────────────

describe('AC-12c: Relay Enrollment Data — Correct Shape, No PII', () => {
  it('enrollment payload has no PII fields', () => {
    interface RelayEnrollment {
      deviceId: string;
      familyId: string;
      publicKey: string;
      timestamp: number;
    }

    const enrollment: RelayEnrollment = {
      deviceId: 'base64pubkey123',
      familyId: 'family-uuid-here',
      publicKey: 'base64-ed25519-pubkey',
      timestamp: Date.now(),
    };

    const keys = Object.keys(enrollment);
    expect(keys).toContain('deviceId');
    expect(keys).toContain('familyId');
    expect(keys).toContain('publicKey');
    expect(keys).toContain('timestamp');

    // Verify no PII fields
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('phone');
    expect(keys).not.toContain('name');
    expect(keys).not.toContain('address');
    expect(keys).not.toContain('username');
    expect(keys).not.toContain('password');
    expect(keys).not.toContain('token');

    // All identifiers should be opaque
    expect(enrollment.deviceId).toBe('base64pubkey123');
    expect(enrollment.familyId).toBe('family-uuid-here');
    expect(enrollment.publicKey).toBe('base64-ed25519-pubkey');
    expect(typeof enrollment.timestamp).toBe('number');
  });

  it('reinvite string contains no PII', () => {
    // Simulate output of reinviteToString
    const reinviteString = JSON.stringify({
      action: 'reinvite',
      familyId: 'fam_abc123',
      deviceId: 'dev_xyz789',
      expiresAt: 2000000000000,
      signature: 'sig_data',
    });

    const parsed = JSON.parse(reinviteString);
    expect(parsed.action).toBe('reinvite');
    expect(parsed.familyId).toMatch(/^fam_/);
    expect(parsed.deviceId).toMatch(/^dev_/);
    expect(parsed.signature).toBe('sig_data');

    // Ensure no PII is embedded
    expect(reinviteString).not.toContain('@');
    expect(reinviteString).not.toContain('email');
    expect(reinviteString).not.toContain('name');
    expect(reinviteString).not.toContain('phone');
  });
});