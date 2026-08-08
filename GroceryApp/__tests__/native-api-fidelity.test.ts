/**
 * Native-API fidelity guard.
 *
 * ── The bug class ────────────────────────────────────────────────────────────
 * `react-native-libsodium` ships two different surfaces. The JS-only build
 * (`lib.d.ts` / `lib.js`, used on web and re-exported by `libsodium-wrappers`)
 * declares the complete libsodium API. The NATIVE build (`lib.native.d.ts` /
 * `lib.native.js`, the JSI bridge that actually runs on device) declares a
 * strict SUBSET. Anything in the gap is `undefined` at runtime on a phone.
 *
 * Nothing in the normal test run can see that gap, because
 * `__mocks__/react-native-libsodium.js` is a two-line re-export of
 * `libsodium-wrappers` — i.e. the mock is strictly MORE capable than the
 * device library. A unit test therefore passes while the shipped app throws
 * (or, worse, silently computes with `undefined`).
 *
 * Concrete instances already found in this codebase:
 *   - `sodium.crypto_hash_sha256` is undefined on device; worked around with a
 *     pure-TS SHA-256 (see the note at `src/identity/recovery.ts:49`).
 *   - `sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES` is undefined, so
 *     `cipherWithTag.slice(0, len - undefined)` yielded NaN-length slices and
 *     malformed every encrypted Yjs update; now a local `const ABYTES = 16`
 *     (see `src/sync/y-websocket.ts:82` and `NotificationManager.ts:39`).
 *
 * ── What this test does ──────────────────────────────────────────────────────
 * It is a mechanical diff, not a list of known bugs: every libsodium member
 * referenced from any source file that pulls in `react-native-libsodium` is
 * checked against what `lib.native.d.ts` actually declares. A member that only
 * exists on the JS-only surface fails the test. That catches the whole class,
 * including instances nobody has found yet.
 *
 * Run: npx jest __tests__/native-api-fidelity.test.ts
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const APP_ROOT = path.resolve(__dirname, '..');
const NATIVE_DTS = path.join(
  APP_ROOT,
  'node_modules/react-native-libsodium/lib/typescript/lib.native.d.ts',
);

/**
 * Members verified present on the device surface by means OTHER than
 * `lib.native.d.ts` — e.g. confirmed in `lib.native.js`, or exercised on a
 * physical device. Each entry needs that evidence written next to it.
 * Empty today: every member the sources use is either declared or genuinely
 * absent. Do not use this list to silence a real absence — see KNOWN_MISSING.
 */
const VERIFIED_PRESENT_WAIVERS: Record<string, string> = {};

/**
 * Members confirmed ABSENT from the device surface that source code still
 * references — live bugs, pinned here so the guard can keep failing loudly on
 * anything NEW while the known ones are being fixed by their owners.
 *
 * Empty today. `crypto_scalarmult_base` used to be listed: the whole
 * `crypto_scalarmult` family is genuinely absent from both `lib.native.d.ts`
 * and `lib.native.js`, but the identity module removed the last call site (see
 * the note at `src/identity/family.ts:426`, which now derives the peer key
 * from `devicePublicKey` instead), so the entry expired. Any entry added here
 * MUST name a real call site: the "no waiver has outlived the call site"
 * assertion below deletes it for you by turning red once that site is gone.
 */
const KNOWN_MISSING: Record<string, string> = {};

/**
 * Member names that unambiguously belong to the libsodium namespace. Matching
 * on the MEMBER rather than the receiver is deliberate: the lazy-import
 * pattern in this codebase binds the module under several different names
 * (`sodium`, `mod`, `s`), so a receiver-keyed scan silently misses call sites
 * such as `NotificationManager.ts:254`, which uses `s.`.
 */
const SODIUM_MEMBER =
  /\.\s*(crypto_[A-Za-z0-9_]+|randombytes_[A-Za-z0-9_]+|sodium_[A-Za-z0-9_]+|base64_variants|to_base64|from_base64|to_hex|from_hex|memcmp|memzero)\b/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * Remove comments so that prose such as
 * `const ABYTES = 16; // sodium.crypto_..._ABYTES` is not read as a call site.
 * ponytail: regex, not a parser — it mis-handles a `//` inside a string
 * literal and a `//` comment immediately after a `:`. Neither occurs in this
 * tree; if one ever does, the symptom is a spurious failure naming the exact
 * line, so swap in a real tokenizer then rather than pre-emptively.
 */
function stripComments(source: string): string {
  return source
    // Blank out block comments but keep their newlines, so the line numbers
    // this test reports still point at the real source lines.
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every member name the NATIVE surface declares. */
function nativeSurface(): Set<string> {
  const dts = fs.readFileSync(NATIVE_DTS, 'utf8');
  const declared = new Set<string>();

  // Top-level `export declare const X` / `export declare function X`.
  for (const m of dts.matchAll(/export\s+declare\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(m[1]);
  }
  // Re-exports, e.g. `export { base64_variants, to_string } from './...'`.
  for (const m of dts.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const name of m[1].split(',')) declared.add(name.trim());
  }
  // Keys of the default-export object — `mod.default` is what the lazy
  // loaders in src/ actually hand back, so its keys are part of the surface.
  const defaultBlock = dts.match(/declare const _default:\s*\{([\s\S]*?)\n\};/);
  if (defaultBlock) {
    for (const m of defaultBlock[1].matchAll(/^\s+([A-Za-z_$][\w$]*)\s*:/gm)) declared.add(m[1]);
  }

  return declared;
}

/** Every libsodium member referenced from sources that load the native module. */
function referencedMembers(): Map<string, string[]> {
  const files = [path.join(APP_ROOT, 'App.tsx'), ...walk(path.join(APP_ROOT, 'src'))].filter((f) =>
    /\.tsx?$/.test(f),
  );

  const refs = new Map<string, string[]>();
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    // Only files that name the package directly. Today every sodium-using file
    // imports it directly (8 such files ⊂ 10 that mention it), so nothing is
    // missed. If an indirection layer is ever added — a `getSodium()` re-export,
    // a wrapper module — widen this filter or the members reached through it
    // become invisible to the guard.
    if (!raw.includes('react-native-libsodium')) continue;

    const source = stripComments(raw);
    for (const m of source.matchAll(SODIUM_MEMBER)) {
      const member = m[1];
      const line = source.slice(0, m.index).split('\n').length;
      const where = `${path.relative(APP_ROOT, file)}:${line}`;
      const seen = refs.get(member) ?? [];
      if (!seen.includes(where)) seen.push(where);
      refs.set(member, seen);
    }
  }
  return refs;
}

describe('native-API fidelity: src/ must not use libsodium members the device lacks', () => {
  it('the native type surface is readable and non-trivial', () => {
    // Guards the guard: if the extraction silently returned an empty set, every
    // reference would be reported as missing rather than the test passing
    // vacuously — but a near-empty set would still be a broken parse.
    expect(fs.existsSync(NATIVE_DTS)).toBe(true);
    expect(nativeSurface().size).toBeGreaterThan(40);
  });

  it('finds the libsodium call sites it is supposed to be checking', () => {
    // Guards against the scan silently matching nothing (e.g. after a refactor
    // renames the package), which would make the real assertion vacuous.
    const refs = referencedMembers();
    expect(refs.size).toBeGreaterThan(10);
    expect(refs.has('crypto_aead_xchacha20poly1305_ietf_encrypt')).toBe(true);
  });

  it('every referenced member is declared by lib.native.d.ts', () => {
    const declared = nativeSurface();
    const violations: string[] = [];

    for (const [member, sites] of referencedMembers()) {
      if (declared.has(member)) continue;
      if (member in VERIFIED_PRESENT_WAIVERS) continue;
      if (member in KNOWN_MISSING) continue;
      violations.push(`${member} — referenced at ${sites.join(', ')}`);
    }

    // One-way subset on purpose: new violations fail, and a KNOWN_MISSING entry
    // that gets fixed elsewhere does NOT turn this test red for its owner.
    expect(violations.sort()).toEqual([]);
  });

  it('no waiver has outlived the call site it was written for', () => {
    // The waiver lists are this guard's only intentional blind spot, and they
    // are otherwise write-only: entries get added when a bug is found and
    // nothing forces their removal once the owning module fixes the call site.
    // A stale entry then silently re-exempts the member for whoever writes it
    // next — exactly the bug class the guard exists to catch. This makes the
    // lists self-expiring: they go red the moment the last reference is gone.
    const refs = referencedMembers();
    const stale = [...Object.keys(KNOWN_MISSING), ...Object.keys(VERIFIED_PRESENT_WAIVERS)].filter(
      (member) => !refs.has(member),
    );
    expect(stale.sort()).toEqual([]);
  });
});
