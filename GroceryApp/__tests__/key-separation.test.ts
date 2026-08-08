/**
 * Key-separation honesty guard (audit L4).
 *
 * `deriveSyncKey` exists, is correct, is tested — and nothing calls it.
 * `src/sync/bootstrap.ts` passes the master key straight through as
 * `encryptionKey`, so the Yjs wire is encrypted under the root key. The old
 * docstring claimed the separation was in effect, which is how a security
 * property comes to look shipped when only its helper is.
 *
 * This guard is BIDIRECTIONAL, because both directions of drift are bugs:
 *
 *   not wired  → the docstring must say so, in those words. Otherwise the lie
 *                comes back the next time someone tidies the comment.
 *   wired      → the envelope must carry a version field first. `EncryptedData`
 *                is {ciphertext, iv, tag} with nothing to say which key was
 *                used, and v1.31 is live in closed testing. Switching the sync
 *                key without a versioned envelope makes every relay-held update
 *                for an offline peer, and every row already in the local
 *                offline_queue, permanently undecryptable — and silently stops
 *                sync for any family member still on an older build.
 *
 * So this file goes red on "quietly re-assert the claim" AND on "quietly ship
 * the re-key". Wiring it for real means: version the envelope, decrypt with a
 * master-key fallback for a deprecation window, drop the fallback, and update
 * this test deliberately.
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', 'src');
const cryptoSrc = fs.readFileSync(path.join(SRC, 'crypto', 'index.ts'), 'utf-8');
const bootstrapSrc = fs.readFileSync(path.join(SRC, 'sync', 'bootstrap.ts'), 'utf-8');
const typesSrc = fs.readFileSync(path.join(SRC, 'types', 'index.ts'), 'utf-8');

/** Strip comments so a guard never reads intent out of prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const bootstrapCode = code(bootstrapSrc);
const cryptoCode = code(cryptoSrc);

/**
 * Is the sync channel keyed on anything OTHER than the bare master key?
 *
 * Deliberately inverted. An earlier version asked "does the assignment mention
 * deriveSyncKey", which a one-line refactor defeats — bind it to a local first
 * (`const wireKey = await deriveSyncKey(m)` … `encryptionKey: wireKey`) and the
 * guard reports "not wired" while the channel really is re-keyed. That is the
 * failure direction that loses user data, so the guard must not have it.
 *
 * Asking the question the safe way round: the ONLY value this may be is the
 * master key itself, spelled exactly. Anything else — a local, a rename, a call,
 * a member access — counts as wired and forces the migration checks below.
 * A false "wired" is a loud test failure; a false "not wired" is silent data loss.
 */
function syncIsKeyedOnASubKey(): boolean {
  const assignments = [...bootstrapCode.matchAll(/encryptionKey\s*:\s*([^,\n}]+)/g)];
  if (!assignments.length) {
    throw new Error(
      'bootstrap.ts no longer passes an `encryptionKey` to syncManager.init — ' +
        'this guard can no longer see how the sync channel is keyed. Re-point it.',
    );
  }
  // EVERY occurrence must be the bare master key, not just the first one a
  // regex happens to reach. A second assignment added below the first is
  // exactly how a re-key lands without anyone noticing.
  return !assignments.every((m) => m[1].trim() === 'masterKey');
}

/**
 * Does a real re-key migration exist?
 *
 * Not just "the interface gained a field named version" — that is a one-line
 * change anyone can make without migrating anything. Require all three legs:
 * a version-ish field on the envelope, the encrypt path stamping it, and the
 * decrypt path branching on it (which is where the master-key fallback for the
 * deprecation window has to live).
 */
function reKeyMigrationExists(): { versioned: boolean; stamped: boolean; branched: boolean } {
  const decl = /export interface EncryptedData\s*\{([\s\S]*?)\}/.exec(typesSrc);
  if (!decl) throw new Error('EncryptedData interface not found in src/types/index.ts');
  const body = code(decl[1]);
  const field = /\b(v|version|keyId|alg)\s*\??\s*:/.exec(body);

  const wsSrc = code(fs.readFileSync(path.join(SRC, 'sync', 'y-websocket.ts'), 'utf-8'));
  const name = field ? field[1] : null;

  return {
    versioned: Boolean(field),
    // encryptUpdate writes the discriminator into the envelope it returns.
    stamped: Boolean(name) && new RegExp(`${name}\\s*:`).test(wsSrc),
    // decryptUpdate reads it back and chooses a key.
    branched: Boolean(name) && new RegExp(`\\.${name}\\b`).test(wsSrc),
  };
}

describe('L4 — the key-separation claim matches the wiring', () => {
  it('the guard can still find both things it compares', () => {
    expect(cryptoSrc).toContain('export async function deriveSyncKey');
    expect(bootstrapSrc).toContain('encryptionKey');
    expect(typesSrc).toContain('export interface EncryptedData');
  });

  // Exactly one of the next two applies, and whichever it is does the asserting.
  // Both are stated as a single expectation on the same boolean so that neither
  // can pass by returning early — an early `return` is a green test that checked
  // nothing, which is how a guard rots into decoration.
  it('while the sync channel uses the master key, the docs say NOT WIRED UP', () => {
    const wired = syncIsKeyedOnASubKey();
    if (wired) {
      expect(cryptoSrc).not.toContain('NOT WIRED UP');
      return;
    }
    expect(cryptoSrc).toContain('NOT WIRED UP');
    // And it must not re-assert the property in the present tense.
    expect(cryptoSrc).not.toContain('This ensures key separation');
  });

  it('if the sub-key ever IS wired, a real re-key migration must exist first', () => {
    const wired = syncIsKeyedOnASubKey();
    if (!wired) {
      // Pin the precondition rather than returning early: today the envelope is
      // unversioned, which is precisely why wiring it would orphan live data.
      expect(reKeyMigrationExists().versioned).toBe(false);
      return;
    }
    // A version field alone is not a migration. Demand the whole path.
    expect(reKeyMigrationExists()).toEqual({
      versioned: true,
      stamped: true,
      branched: true,
    });
    expect(cryptoSrc).not.toContain('NOT WIRED UP');
  });

  it('deriveSyncKey and deriveDBKey pass distinct KDF contexts at the call site', () => {
    // Domain separation is the whole point of the helpers: two sub-keys sharing
    // a context and index are the same key under two names. Assert on the actual
    // crypto_kdf_derive_from_key arguments with comments stripped — an earlier
    // version matched the literals anywhere in the file, which docstrings alone
    // satisfied.
    const calls = [...cryptoCode.matchAll(/crypto_kdf_derive_from_key\(([\s\S]*?)\)/g)].map(
      (m) => m[1],
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);

    const ctxOf = (args: string) => /'([^']+)'/.exec(args)?.[1];
    const idOf = (args: string) => {
      const parts = args.split(',').map((s) => s.trim());
      return parts[1];
    };
    const contexts = calls.map(ctxOf);
    // Compare on the trimmed name so the required padding below is the only
    // thing asserting length — otherwise a context could quietly lose a byte
    // and still "contain" the name.
    expect(contexts.map((c) => c?.trim())).toEqual(
      expect.arrayContaining(['yjs-sync', 'db-encr']),
    );
    // Every context is exactly crypto_kdf_CONTEXTBYTES (8). libsodium THROWS
    // `invalid ctx length` otherwise, which is how 'db-encr' (7) made
    // deriveDBKey unusable while looking fine in review. Padding is load-bearing.
    for (const c of contexts) expect(c).toHaveLength(8);
    // No two derivations may share both context and sub-key id.
    const pairs = calls.map((a) => `${ctxOf(a)}#${idOf(a)}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
