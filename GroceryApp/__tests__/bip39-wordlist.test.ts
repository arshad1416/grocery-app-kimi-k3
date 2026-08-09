/**
 * The BIP39 wordlist is DATA, and data needs a checksum, not a code review.
 *
 * This file shipped for its entire history with 2042 words under a comment
 * claiming 2048. Nothing caught it, and the reasons are worth keeping written
 * down because they are all reproducible mistakes:
 *
 *   1. BIP39_WORDLIST was not exported, so no test could reach it.
 *   2. The one test suite that covers this module (ac13-key-recovery) defined
 *      its OWN 42-word BIP39_WORDLIST_SUBSET and validated against that. It
 *      was testing a fake list, so it passed no matter what the real one held.
 *   3. Nothing ever read BIP39_WORDLIST.length. The bounds guard in
 *      wordIndicesToEntropy compared against a literal 2048 instead, so a
 *      six-word shortfall was invisible to the only code that could have seen it.
 *   4. The count was asserted by a COMMENT. A comment is what lied.
 *
 * So: assert the sha256 of the list, not its length. A length check passes on
 * 2048 wrong words; this does not. The digest below is the one published for
 * english.txt by BIP-0039 itself, so it pins contents AND order against the
 * spec rather than against whatever this repo happens to contain.
 */

import { describe, it, expect } from '@jest/globals';
import { createHash } from 'crypto';
import {
  BIP39_WORDLIST,
  entropyToWordIndices,
  wordIndicesToEntropy,
} from '../src/identity/recovery';

/** sha256 of the canonical BIP-0039 english.txt, verified against the spec. */
const SPEC_SHA256 = '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda';

const sha = (words: readonly string[]) =>
  createHash('sha256')
    .update(words.join('\n') + '\n')
    .digest('hex');

describe('BIP39_WORDLIST is the canonical list', () => {
  it('hashes to the digest published in BIP-0039', () => {
    // The single load-bearing assertion in this file. It pins every word AND
    // the order, which is what actually determines the encoding.
    expect(sha(BIP39_WORDLIST)).toBe(SPEC_SHA256);
  });

  it('has exactly 2048 entries', () => {
    // Redundant against the digest, kept because it names the failure. A
    // wrong count reads as "2042 !== 2048"; the digest alone reads as noise.
    expect(BIP39_WORDLIST.length).toBe(2048);
  });

  it('is 2048 DISTINCT words', () => {
    // A duplicate would make indexOf() lossy: two indices, one word, so a
    // phrase could not be decoded back to the index that produced it.
    expect(new Set(BIP39_WORDLIST).size).toBe(2048);
  });

  it('is sorted, so indexOf agrees with the spec ordering', () => {
    expect([...BIP39_WORDLIST]).toEqual([...BIP39_WORDLIST].sort());
  });

  it('contains the 15 words the old list was missing', () => {
    // Absent for this repo's whole history. Named individually so a partial
    // regression points at itself instead of at an opaque digest mismatch.
    for (const w of [
      'cram', 'embark', 'embody', 'embrace', 'empower', 'enact', 'endless',
      'endorse', 'excess', 'huge', 'ripple', 'ritual', 'stem', 'summer', 'supreme',
    ]) {
      expect(BIP39_WORDLIST).toContain(w);
    }
  });

  it('contains none of the 9 words that were never BIP39', () => {
    for (const w of [
      'embryo', 'emperor', 'exceed', 'foreign', 'player',
      'rip', 'ripe', 'support', 'suppose',
    ]) {
      expect(BIP39_WORDLIST).not.toContain(w);
    }
  });
});

describe('every index the encoder can emit maps to a real word', () => {
  it('has a defined, non-empty word at all 2048 positions', () => {
    // The hole bug: indices 2042..2047 were reachable and indexed past the
    // end. `undefined` does NOT stringify as "undefined" here — Array.join
    // renders it as empty — so the phrase silently lost a word instead of
    // showing anything wrong. Any triage that greps for the string
    // "undefined" finds nothing on a fully-affected population.
    for (let i = 0; i < 2048; i++) {
      expect(typeof BIP39_WORDLIST[i]).toBe('string');
      expect(BIP39_WORDLIST[i].length).toBeGreaterThan(0);
    }
  });

  it('11 bits addresses exactly the list, with nothing spare and nothing short', () => {
    // BITS_PER_WORD = 11 => indices 0..2047. If the list is ever not 2^11
    // long, one of these two failures says which direction.
    expect(BIP39_WORDLIST.length).toBe(1 << 11);
  });

  it('never produces a phrase with a missing word, over many random seeds', () => {
    // The actual user-visible symptom, asserted end to end rather than by
    // reasoning about bounds. 3.5% of seeds used to trip this.
    for (let n = 0; n < 3000; n++) {
      const entropy = new Uint8Array(16);
      for (let i = 0; i < 16; i++) entropy[i] = Math.floor(Math.random() * 256);

      const phrase = entropyToWordIndices(entropy)
        .map((i) => BIP39_WORDLIST[i])
        .join(' ');

      // The exact checks the app performs on the way back in.
      expect(phrase.trim().split(/\s+/)).toHaveLength(12);
      expect(phrase).not.toMatch(/\s{2}/);
      expect(phrase).not.toMatch(/undefined/);
    }
  });

  it('round-trips entropy -> words -> entropy for many random seeds', () => {
    for (let n = 0; n < 2000; n++) {
      const entropy = new Uint8Array(16);
      for (let i = 0; i < 16; i++) entropy[i] = Math.floor(Math.random() * 256);

      const indices = entropyToWordIndices(entropy);
      // Go through the WORDS, not just the indices — that is the path a user
      // takes, and it is where a duplicate or a hole would show up.
      const roundTripped = indices
        .map((i) => BIP39_WORDLIST[i])
        .map((w) => BIP39_WORDLIST.indexOf(w));

      expect(roundTripped).toEqual(indices);
      expect(Array.from(wordIndicesToEntropy(roundTripped))).toEqual(Array.from(entropy));
    }
  });
});

describe('official BIP-0039 test vectors', () => {
  /**
   * The Trezor vectors, which are the reference implementation's own. These
   * pin the WHOLE codec — wordlist, bit packing, and the 4-bit checksum — to
   * the spec, not merely to itself. A round-trip test proves this app can read
   * back what it wrote; only these prove anyone ELSE can, which is the actual
   * promise a BIP39 phrase makes to a user.
   *
   * Under the old 2042-word list every one of these produced a wrong phrase.
   */
  const VECTORS: ReadonlyArray<readonly [string, string]> = [
    [
      '00000000000000000000000000000000',
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    ],
    [
      '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
    ],
    [
      '80808080808080808080808080808080',
      'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
    ],
    ['ffffffffffffffffffffffffffffffff', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'],
    [
      '9e885d952ad362caeb4efe34a8e91bd2',
      'ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic',
    ],
    [
      '0c1e24e5917779d297e14d45f14e1a1a',
      'army van defense carry jealous true garbage claim echo media make crunch',
    ],
  ];

  const fromHex = (hex: string) =>
    new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));

  for (const [hex, expected] of VECTORS) {
    it(`encodes ${hex.slice(0, 8)}… to the phrase the spec specifies`, () => {
      const phrase = entropyToWordIndices(fromHex(hex))
        .map((i) => BIP39_WORDLIST[i])
        .join(' ');
      expect(phrase).toBe(expected);
    });

    it(`decodes the spec phrase for ${hex.slice(0, 8)}… back to its entropy`, () => {
      const indices = expected.split(' ').map((w) => BIP39_WORDLIST.indexOf(w));
      expect(indices).not.toContain(-1);
      expect(Array.from(wordIndicesToEntropy(indices))).toEqual(Array.from(fromHex(hex)));
    });
  }
});

describe('the bounds guard is derived from the list, not a literal', () => {
  it('rejects an index one past the end', () => {
    expect(() => wordIndicesToEntropy(new Array(12).fill(BIP39_WORDLIST.length))).toThrow(
      /out of range/,
    );
  });

  it('accepts the last valid index', () => {
    // A guard hardcoded to a number LARGER than the list lets this through
    // and yields undefined words; one hardcoded SMALLER wrongly rejects here.
    expect(() => wordIndicesToEntropy(new Array(12).fill(BIP39_WORDLIST.length - 1))).not.toThrow(
      /out of range/,
    );
  });
});
