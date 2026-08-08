/**
 * First-run recovery backup — regression tests.
 *
 * On first launch provisionFirstRun() mints the 12-word phrase, but before
 * this goal nothing ever told the user it exists. The fix is a persistent
 * Home-screen banner driven by a settings flag, plus a fix to
 * recoverFromPhrase() so joined devices can actually retrieve their phrase.
 *
 * Pinned behaviors:
 *  1. recoverFromPhrase() persists the seed, phrase, and stored-flag under
 *     the joined familyId (it previously only set the master key, so on every
 *     non-founding device hasRecoveryPhrase() stayed false and the Settings →
 *     View Recovery Phrase path threw).
 *  2. The acknowledgement flag recoveryPhraseAcknowledged defaults to false
 *     and is written true in EXACTLY ONE place: the explicit "I've Stored It
 *     Safely" handler in RecoveryScreen. Dismissing or backgrounding can
 *     never set it, so the prompt re-surfaces — the ContributeConsentModal
 *     dismiss-suppresses-forever bug is deliberately not repeated.
 *  3. RecoveryScreen's show mode no longer falls through to
 *     generateRecoveryPhrase() when a master key already exists (that path
 *     threw an unexplained error); it raises an actionable one instead.
 *
 * There is no RN renderer in this suite (and adding one is out of bounds),
 * so UI behaviors are proven statically in the turso-gated-off idiom.
 *
 * Run: npx jest __tests__/recovery-first-run.test.ts
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as SecureStore from 'expo-secure-store';
import { initCrypto, getMasterKey, clearMasterKey } from '../src/crypto';
import { initDeviceIdentity, getDeviceKeypair } from '../src/identity/device';
import {
  ensureFamilyMembership,
  clearFamilyMembership,
  getFamilyId,
} from '../src/identity/family';
import {
  generateRecoveryPhrase,
  recoverFromPhrase,
  hasRecoveryPhrase,
  getStoredRecoveryPhrase,
  clearRecoveryPhrase,
  sha256,
} from '../src/identity/recovery';

const APP_ROOT = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(APP_ROOT, rel), 'utf8');
}

/** Recursively collect every file under a directory. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// ─── Runtime: recoverFromPhrase persists the phrase on joined devices ───────

describe('pure-TS sha256 (BIP39 checksum) matches real SHA-256', () => {
  // react-native-libsodium has NO crypto_hash_sha256 on device (its JSI layer
  // exposes no SHA-256), so the BIP39 checksum threw "undefined is not a
  // function" in provisionFirstRun() on every real device — while this suite
  // stayed green, because the jest mock delegates to libsodium-wrappers,
  // which DOES export it. recovery.ts now uses a pure-TS sha256; this test
  // pins it against the real implementation the mock provides, plus known
  // NIST vectors, so the mock can never hide that gap again.
  it('matches libsodium-wrappers crypto_hash_sha256 across sizes', async () => {
    const wrappers = require('libsodium-wrappers');
    await wrappers.ready;
    for (const len of [0, 1, 15, 16, 31, 32, 55, 56, 63, 64, 65, 127, 128, 1000]) {
      const input = new Uint8Array(len);
      for (let i = 0; i < len; i++) input[i] = (i * 7 + len) & 0xff;
      expect(Array.from(sha256(input))).toEqual(
        Array.from(wrappers.crypto_hash_sha256(input)),
      );
    }
  });

  it('matches the NIST test vectors for "" and "abc"', () => {
    const hex = (b: Uint8Array) =>
      Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
    expect(hex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('recovery.ts no longer calls the device-missing crypto_hash_sha256', () => {
    // The identifier may appear in comments explaining the gap; what must be
    // gone is any actual call through the sodium module.
    expect(read('src/identity/recovery.ts')).not.toMatch(
      /sodium\.crypto_hash_sha256\s*\(/,
    );
  });
});

describe('recoverFromPhrase stores the phrase under the joined familyId', () => {
  beforeEach(async () => {
    (SecureStore as any)._clearStore();
    await initCrypto();
    await clearFamilyMembership();
    await initDeviceIdentity();
    await ensureFamilyMembership(getDeviceKeypair());
  });

  it('a joining device can retrieve its phrase after recovery (the Settings path no longer throws)', async () => {
    // Founder: mint the family phrase and key.
    const phrase = await generateRecoveryPhrase();
    const founderKey = await getMasterKey();
    expect(founderKey).not.toBeNull();

    // Simulate the joining device: same familyId (set by the join flow),
    // but no master key and no stored phrase — the pre-fix state.
    await clearMasterKey();
    await clearRecoveryPhrase();
    expect(await hasRecoveryPhrase()).toBe(false);
    expect(await getStoredRecoveryPhrase()).toBeNull();

    // User enters the family phrase (PairingScreen → Recover from Backup).
    const recoveredKey = await recoverFromPhrase(phrase);
    expect(Array.from(recoveredKey)).toEqual(Array.from(founderKey!));

    // The fix: the phrase is now stored on this device too, so
    // Settings → View Recovery Phrase can display it instead of falling
    // through to generateRecoveryPhrase() and throwing.
    expect(await hasRecoveryPhrase()).toBe(true);
    expect(await getStoredRecoveryPhrase()).toBe(phrase);
  });

  it('normalizes the entered phrase before storing it', async () => {
    const phrase = await generateRecoveryPhrase();
    await clearMasterKey();
    await clearRecoveryPhrase();

    // Sloppy but valid input: mixed case, extra whitespace.
    await recoverFromPhrase(`  ${phrase.toUpperCase().replace(/ /g, '   ')}  `);
    expect(await getStoredRecoveryPhrase()).toBe(phrase);
  });

  it('skips the persist writes when no family membership exists', async () => {
    const phrase = await generateRecoveryPhrase();
    await clearMasterKey();
    await clearRecoveryPhrase();
    await clearFamilyMembership();
    expect(await getFamilyId()).toBeNull();

    // Still recovers the key — recovery must not depend on membership.
    const key = await recoverFromPhrase(phrase);
    expect(key.length).toBe(32);
    expect(await hasRecoveryPhrase()).toBe(false);
  });
});

// ─── Static: the acknowledgement flag and its single write site ─────────────

describe('recoveryPhraseAcknowledged flag posture', () => {
  it('is declared in AppSettings and defaults to false', () => {
    expect(read('src/types/index.ts')).toContain('recoveryPhraseAcknowledged?: boolean');
    expect(read('src/config/settings.ts')).toMatch(
      /recoveryPhraseAcknowledged:\s*false/,
    );
  });

  it('is written true in exactly one place: the explicit "I\'ve saved it" handler', () => {
    const files = [path.join(APP_ROOT, 'App.tsx'), ...walk(path.join(APP_ROOT, 'src'))];
    const writeSites: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const matches = content.match(/recoveryPhraseAcknowledged:\s*true/g);
      for (let i = 0; i < (matches?.length ?? 0); i++) {
        writeSites.push(path.relative(APP_ROOT, file));
      }
    }
    expect(writeSites).toEqual(['src/screens/RecoveryScreen.tsx']);

    // …and that one write lives inside handleConfirmed, the handler behind
    // the "I've Stored It Safely" button — not in any dismiss/back path.
    const screen = read('src/screens/RecoveryScreen.tsx');
    const handlerStart = screen.indexOf('const handleConfirmed');
    const handlerEnd = screen.indexOf('const handleCopy');
    expect(handlerStart).toBeGreaterThan(-1);
    const handlerBody = screen.slice(handlerStart, handlerEnd);
    expect(handlerBody).toMatch(/recoveryPhraseAcknowledged:\s*true/);
  });

  it('HomeScreen shows the prompt off the flag and routes to Recovery in show mode', () => {
    const home = read('src/screens/HomeScreen.tsx');
    expect(home).toContain('recoveryPhraseAcknowledged');
    expect(home).toContain("navigation.navigate('Recovery', { mode: 'show' })");
    // The prompt is gated on the flag being unset — never set by dismissal.
    expect(home).not.toMatch(/recoveryPhraseAcknowledged:\s*true/);
  });
});

// ─── Static: show mode no longer hits the opaque throw-path ─────────────────

describe('RecoveryScreen show mode', () => {
  it('only calls generateRecoveryPhrase when no master key exists', () => {
    const screen = read('src/screens/RecoveryScreen.tsx');
    // The fallback is now guarded by a master-key check…
    expect(screen).toMatch(/else if \(!\(await getMasterKey\(\)\)\)/);
    // …and the stored-phrase-missing-but-keyed state raises an actionable error.
    expect(screen).toContain('No recovery phrase is stored on this device');
  });
});
