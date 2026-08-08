/**
 * `decryptField` must not disguise an authentication failure as plaintext.
 *
 * Found while closing audit L4/L5, pre-existing. `decrypt()` used to sit inside
 * the same try/catch as `JSON.parse`, and that catch is commented
 * "Not encrypted — return as-is (plaintext)". So an AEAD authentication failure
 * — wrong key, or corrupted/tampered ciphertext — fell through to
 * `return stored`, handing the caller the envelope JSON as if it were the
 * user's own text.
 *
 * Two distinct harms, which is why this is its own suite:
 *   1. The grocery item renders as `{"ciphertext":…,"iv":…,"tag":…}`.
 *   2. The Poly1305 tag exists to detect exactly this, and its failure was
 *      swallowed at the moment it fired. Write-through would then re-encrypt
 *      that envelope-as-plaintext on the next edit, cementing the corruption.
 *
 * Three inputs must stay distinguishable, and only the first is "plaintext":
 *   a legacy non-JSON row      → returned unchanged
 *   JSON that is not our shape → returned unchanged
 *   a real envelope that fails → withheld (null), never returned as text
 */

import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import sodium from 'libsodium-wrappers';
import { initCrypto, deriveKeyFromPassphrase, generateSalt } from '../src/crypto/index';
import { encryptField, decryptField } from '../src/storage/hydrate';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const CONTEXT = 'grocery_item.name';

let key: Uint8Array;
let otherKey: Uint8Array;

beforeAll(async () => {
  await sodium.ready;
  await initCrypto();
  key = await deriveKeyFromPassphrase('right', await generateSalt());
  otherKey = await deriveKeyFromPassphrase('wrong', await generateSalt());
});

describe('decryptField distinguishes "never encrypted" from "failed to authenticate"', () => {
  it('round-trips a value encrypted with the same key and context', async () => {
    const stored = await encryptField('oat milk', key, CONTEXT);
    expect(await decryptField(stored, key, CONTEXT)).toBe('oat milk');
  });

  it('returns a legacy non-JSON row unchanged', async () => {
    expect(await decryptField('oat milk', key, CONTEXT)).toBe('oat milk');
  });

  it('returns JSON that is not an envelope unchanged', async () => {
    // Parses fine, but has none of ciphertext/iv/tag — not ours, so not ours to fail on.
    const notOurs = JSON.stringify({ hello: 'world' });
    expect(await decryptField(notOurs, key, CONTEXT)).toBe(notOurs);
    expect(await decryptField('123', key, CONTEXT)).toBe('123');
    expect(await decryptField('null', key, CONTEXT)).toBe('null');
  });

  it('withholds the field when the key is wrong, and never returns the envelope', async () => {
    const stored = await encryptField('oat milk', key, CONTEXT);
    const out = await decryptField(stored, otherKey, CONTEXT);

    expect(out).toBeNull();
    // The specific regression: the old code returned `stored` here.
    expect(out).not.toBe(stored);
    expect(out ?? '').not.toContain('ciphertext');
  });

  it('withholds the field when the AAD context is wrong', async () => {
    const stored = await encryptField('oat milk', key, CONTEXT);
    const out = await decryptField(stored, key, 'grocery_item.notes');

    expect(out).toBeNull();
    expect(out ?? '').not.toContain('ciphertext');
  });

  it('withholds the field when the ciphertext has been tampered with', async () => {
    const stored = await encryptField('oat milk', key, CONTEXT);
    const envelope = JSON.parse(stored);
    // Flip one base64 character — enough for Poly1305 to reject it.
    envelope.ciphertext =
      (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1);
    const tampered = JSON.stringify(envelope);

    const out = await decryptField(tampered, key, CONTEXT);
    expect(out).toBeNull();
    expect(out).not.toBe(tampered);
  });

  it('still maps empty and null inputs to null', async () => {
    expect(await decryptField('', key, CONTEXT)).toBeNull();
    expect(await decryptField(null, key, CONTEXT)).toBeNull();
    expect(await decryptField(undefined, key, CONTEXT)).toBeNull();
  });
});
