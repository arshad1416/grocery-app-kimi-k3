/**
 * Migrating off the defective 2042-word wordlist, without a migration.
 *
 * Every phrase this app produced before the wordlist was corrected is
 * undecodable by the corrected build: the two lists share only 401 of 2048
 * positions, so the probability that a 12-word phrase survives the change is
 * (401/2048)^12 — about 1.4e-9. Roughly 3.5% were worse than that and came out
 * as 11 words, which no build ever accepted.
 *
 * What makes this survivable is that the wordlist was never load-bearing for
 * anyone's DATA. The master key is crypto_generichash(32, seed) over raw
 * CSPRNG entropy; the phrase is only a rendering of that seed. So the fix is
 * to stop storing the rendering and derive it on read. That is idempotent by
 * construction, needs no version stamp, and cannot be interrupted half-done.
 *
 * These tests pin the behaviours that make that safe. Run:
 *   npx jest __tests__/bip39-migration.test.ts
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import { initCrypto, getMasterKey, clearMasterKey, getMasterKeyType } from '../src/crypto';
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
  verifyRecoveryPhrase,
  RecoveryOverwriteError,
  BIP39_WORDLIST,
} from '../src/identity/recovery';

const SEED_ALIAS = 'groceryapp.recovery.seed.';
const PHRASE_ALIAS = 'groceryapp.recovery.phrase.';

beforeEach(async () => {
  (SecureStore as any)._clearStore();
  await initCrypto();
  await clearFamilyMembership();
  await initDeviceIdentity();
  await ensureFamilyMembership(getDeviceKeypair());
});

describe('the phrase is derived from the seed, never read back from storage', () => {
  it('ignores a stale phrase left on disk by an older build', async () => {
    // THE MIGRATION TEST. An upgrading user has a seed AND a phrase string
    // written under the old wordlist. Before this change getStoredRecoveryPhrase
    // returned that string verbatim, forever — so the app kept displaying words
    // that its own verifyRecoveryPhrase would reject, under a heading telling
    // the user to write them down.
    const correct = await generateRecoveryPhrase();
    const familyId = await getFamilyId();

    await SecureStore.setItemAsync(
      `${PHRASE_ALIAS}${familyId}`,
      'legacy phrase from the old wordlist that no build accepts',
    );

    expect(await getStoredRecoveryPhrase()).toBe(correct);
    expect(verifyRecoveryPhrase((await getStoredRecoveryPhrase())!)).toBe(true);
  });

  it('repairs a holed phrase — 11 words — with no user action', async () => {
    // The ~3.5% cohort: an out-of-range index rendered as EMPTY (Array.join
    // does not print "undefined"), so the stored phrase silently lost a word.
    // Their seed was intact the whole time.
    const correct = await generateRecoveryPhrase();
    const familyId = await getFamilyId();

    const holed = correct.split(' ').slice(0, 11).join(' ') + ' ';
    await SecureStore.setItemAsync(`${PHRASE_ALIAS}${familyId}`, holed);
    expect(verifyRecoveryPhrase(holed)).toBe(false);

    const shown = await getStoredRecoveryPhrase();
    expect(shown!.trim().split(/\s+/)).toHaveLength(12);
    expect(verifyRecoveryPhrase(shown!)).toBe(true);
    expect(shown).toBe(correct);
  });

  it('does not persist the phrase at all — one at-rest copy of the secret, not two', async () => {
    const phrase = await generateRecoveryPhrase();
    const familyId = await getFamilyId();

    expect(await SecureStore.getItemAsync(`${PHRASE_ALIAS}${familyId}`)).toBeNull();
    // …yet it is still retrievable, because it is derived.
    expect(await getStoredRecoveryPhrase()).toBe(phrase);
  });

  it('is idempotent — repeated reads never drift', async () => {
    const phrase = await generateRecoveryPhrase();
    for (let i = 0; i < 5; i++) expect(await getStoredRecoveryPhrase()).toBe(phrase);
  });

  it('returns null when there is no seed, rather than a partial phrase', async () => {
    await clearRecoveryPhrase();
    expect(await getStoredRecoveryPhrase()).toBeNull();
    expect(await hasRecoveryPhrase()).toBe(false);
  });
});

describe('hasRecoveryPhrase cannot disagree with getStoredRecoveryPhrase', () => {
  it('reports true for a device holding a seed but no legacy stored-flag', async () => {
    // The old code keyed this off a separate 'stored' flag. A device with a
    // seed and no flag answered false, which suppressed the Home backup banner
    // for someone who did have a recoverable family.
    await generateRecoveryPhrase();
    const familyId = await getFamilyId();
    await SecureStore.deleteItemAsync(`groceryapp.recovery.stored.${familyId}`);

    expect(await hasRecoveryPhrase()).toBe(true);
    expect(await getStoredRecoveryPhrase()).not.toBeNull();
  });

  it('agrees with getStoredRecoveryPhrase in both directions', async () => {
    expect(await hasRecoveryPhrase()).toBe(false);
    expect(await getStoredRecoveryPhrase()).toBeNull();

    await generateRecoveryPhrase();
    expect(await hasRecoveryPhrase()).toBe(true);
    expect(await getStoredRecoveryPhrase()).not.toBeNull();

    await clearRecoveryPhrase();
    expect(await hasRecoveryPhrase()).toBe(false);
    expect(await getStoredRecoveryPhrase()).toBeNull();
  });
});

describe('the seed parser fails closed', () => {
  const malformed = [
    ['too short', '1,2,3'],
    ['too long', new Array(17).fill(1).join(',')],
    ['a byte out of range', new Array(15).fill(1).join(',') + ',256'],
    ['a non-numeric byte', new Array(15).fill(1).join(',') + ',xx'],
    ['an empty field', new Array(15).fill(1).join(',') + ','],
    ['a negative byte', new Array(15).fill(1).join(',') + ',-1'],
    ['a float', new Array(15).fill(1).join(',') + ',1.5'],
    ['whitespace padding', new Array(16).fill(' 1').join(',')],
  ] as const;

  for (const [label, value] of malformed) {
    it(`returns null on ${label} rather than a silently-zeroed seed`, async () => {
      // `new Uint8Array([NaN])` is 0. The old one-liner turned any unparseable
      // byte into a zero and handed back a well-formed WRONG seed — and this
      // function had never run anywhere in the codebase, so none of it was
      // exercised. It is now the source of truth for the phrase.
      await generateRecoveryPhrase();
      const familyId = await getFamilyId();
      await SecureStore.setItemAsync(`${SEED_ALIAS}${familyId}`, value);

      expect(await getStoredRecoveryPhrase()).toBeNull();
      expect(await hasRecoveryPhrase()).toBe(false);
    });
  }

  it('accepts a well-formed seed at both byte extremes', async () => {
    await generateRecoveryPhrase();
    const familyId = await getFamilyId();

    for (const fill of [0, 255]) {
      await SecureStore.setItemAsync(`${SEED_ALIAS}${familyId}`, new Array(16).fill(fill).join(','));
      const phrase = await getStoredRecoveryPhrase();
      expect(phrase!.trim().split(/\s+/)).toHaveLength(12);
      expect(verifyRecoveryPhrase(phrase!)).toBe(true);
    }
  });
});

describe('recoverFromPhrase refuses to silently orphan an existing key', () => {
  it('throws RecoveryOverwriteError when a recovery-derived key is already present', async () => {
    // A 12-word phrase carries only 4 checksum bits, so ~1 in 16 wrong phrases
    // decode "successfully" to wrong entropy. Writing that key orphans
    // everything encrypted under the real one, and the UI said "Recovery
    // Successful". Measured over 300k seeds, an old-wordlist phrase entered
    // into this build is accepted 5.7% of the time and recovers the correct
    // entropy in zero cases.
    const phrase = await generateRecoveryPhrase();
    await recoverFromPhrase(phrase); // establishes type 'recovery'
    expect(await getMasterKeyType()).toBe('recovery');

    const other = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
    expect(verifyRecoveryPhrase(other)).toBe(true); // a VALID but wrong phrase

    const before = await getMasterKey();
    await expect(recoverFromPhrase(other)).rejects.toThrow(RecoveryOverwriteError);

    // The key must be untouched — refusing after writing would be pointless.
    expect(Array.from((await getMasterKey())!)).toEqual(Array.from(before!));
  });

  it('proceeds when the caller has explicitly confirmed', async () => {
    const phrase = await generateRecoveryPhrase();
    await recoverFromPhrase(phrase);

    const other = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
    const key = await recoverFromPhrase(other, { allowOverwrite: true });
    expect(key.length).toBe(32);
  });

  it('does NOT block the join flow, where overwriting is correct', async () => {
    // A device that provisioned its own family-of-one carries type 'device'
    // and must be able to join a real family. Guarding on "a key exists"
    // instead of on its TYPE would break this.
    const familyPhrase = await generateRecoveryPhrase();
    const familyKey = await getMasterKey();

    await clearMasterKey();
    await clearRecoveryPhrase();
    const { setMasterKey, setMasterKeyType } = await import('../src/crypto');
    await setMasterKey(new Uint8Array(32).fill(7));
    await setMasterKeyType('device');
    expect(await getMasterKeyType()).toBe('device');

    const recovered = await recoverFromPhrase(familyPhrase);
    expect(Array.from(recovered)).toEqual(Array.from(familyKey!));
  });

  it('does not block a first-ever restore, where no key exists', async () => {
    const phrase = await generateRecoveryPhrase();
    const key = await getMasterKey();
    await clearMasterKey();
    await clearRecoveryPhrase();

    const recovered = await recoverFromPhrase(phrase);
    expect(Array.from(recovered)).toEqual(Array.from(key!));
  });
});

describe('old-wordlist phrases are diagnosed, never decoded', () => {
  const LEGACY_ONLY = [
    'embryo', 'emperor', 'exceed', 'foreign', 'player',
    'rip', 'ripe', 'support', 'suppose',
  ];

  it('none of the nine legacy-only words is in the canonical list', () => {
    for (const w of LEGACY_ONLY) expect(BIP39_WORDLIST).not.toContain(w);
  });

  it('names the old version instead of blaming the user for a typo', async () => {
    await clearMasterKey();
    await clearRecoveryPhrase();
    const phrase = `abandon ability able about above absent absorb abstract absurd abuse access ${LEGACY_ONLY[0]}`;

    await expect(recoverFromPhrase(phrase)).rejects.toThrow(/older version of PantryRun/);
    await expect(recoverFromPhrase(phrase)).rejects.toThrow(/Settings/);
  });

  it('does not cry "old version" at an ordinary typo', async () => {
    // An unknown word that is NOT one of the nine falls through to the generic
    // message. That is correct: it really could be a typo, and the legacy
    // advice ("go copy the new words") would be a wild goose chase.
    await clearMasterKey();
    await clearRecoveryPhrase();
    const phrase =
      'abandon ability able about above absent absorb abstract absurd abuse access zzzzzz';

    await expect(recoverFromPhrase(phrase)).rejects.not.toThrow(/older version/);
    await expect(recoverFromPhrase(phrase)).rejects.toThrow(/Invalid recovery phrase/);
  });

  it('never returns a key for a legacy phrase — diagnosis is not decoding', async () => {
    await clearMasterKey();
    await clearRecoveryPhrase();
    const phrase = `abandon ability able about above absent absorb abstract absurd abuse access ${LEGACY_ONLY[3]}`;

    await expect(recoverFromPhrase(phrase)).rejects.toThrow();
    expect(await getMasterKey()).toBeNull();
  });
});
