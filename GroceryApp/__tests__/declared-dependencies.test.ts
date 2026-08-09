/**
 * Every package this project NAMES must be one it DECLARES.
 *
 * This guards a bug class, not a bug. Four instances were found in one audit pass,
 * every one of them invisible until the dependency tree happened to change shape:
 *
 *   react-native-iap    imported by src/config/entitlements.ts, declared nowhere.
 *                       The lazy `await import()` meant the app booted fine and threw
 *                       the moment a user tapped Upgrade — the entire paid tier, dead
 *                       in a build that was already in Play closed testing.
 *   babel-preset-expo   named by babel.config.js, declared nowhere. Resolved only
 *                       because npm hoisted it out of `expo`. The instant an unrelated
 *                       version bump nested it under expo/node_modules, Metro bundling
 *                       died with `Cannot find module 'babel-preset-expo'`.
 *   expo-modules-jsi    a real pod, declared nowhere, so npm drifted it to 56.0.12 while
 *                       prebuilt expo-modules-core 56.0.14 required ~56.0.7 — a dyld
 *                       symbol mismatch that stopped iOS launching at all.
 *   expo-asset          same shape, surfaced while chasing the one above.
 *
 * The common thread: a transitive package that happens to be hoisted to the top of
 * node_modules resolves exactly like a declared one, so nothing fails until hoisting
 * changes. `npm ls` will not flag it and neither will TypeScript.
 *
 * So: parse the config files that name packages by string, and assert each name is
 * declared. Config files are the right scope — they are resolved from the project root
 * by tools that do not read our package.json, which is precisely why their dependencies
 * go unnoticed. (Runtime `import` statements in src/ are a larger sweep and are already
 * partly covered by tsc and by free-tier-posture.test.ts.)
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);

/** Config files that name packages as bare string specifiers. */
const CONFIGS = ['babel.config.js', 'metro.config.js', 'jest.config.js'];

/**
 * A bare package specifier: `name`, `@scope/name`, or a subpath like `expo/metro-config`.
 * Deliberately NOT every quoted string — these files also quote option values
 * ('ts', 'json', 'node'), file paths, and regex fragments. Requiring either a scope,
 * a subpath, or a hyphenated name keeps those out while still catching real packages
 * such as `babel-preset-expo` and `ts-jest`.
 */
const SPECIFIER = /['"]((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.-]+)*)['"]/g;

/** Module specifier -> the package name npm installs. */
function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Does this resolve as a package at all, rather than being an option value? */
function isRealPackage(name: string): boolean {
  return fs.existsSync(path.join(ROOT, 'node_modules', name, 'package.json'));
}

function namedPackagesIn(file: string): string[] {
  const src = fs
    .readFileSync(path.join(ROOT, file), 'utf-8')
    // Comments explain things without depending on them: babel.config.js discusses
    // @babel/plugin-proposal-decorators at length while deliberately NOT using it.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  const found = new Set<string>();
  for (const m of src.matchAll(SPECIFIER)) {
    const name = packageOf(m[1]);
    if (isRealPackage(name)) found.add(name);
  }
  return [...found].sort();
}

describe('every package named by a config file is declared in package.json', () => {
  it('finds the config files it is supposed to be checking', () => {
    for (const f of CONFIGS) {
      expect(fs.existsSync(path.join(ROOT, f))).toBe(true);
    }
    // If the specifier regex ever stops matching, this suite would pass vacuously.
    expect(namedPackagesIn('babel.config.js')).toContain('babel-preset-expo');
  });

  for (const file of CONFIGS) {
    it(`${file} names only declared packages`, () => {
      const undeclared = namedPackagesIn(file).filter((n) => !declared.has(n));
      expect(undeclared).toEqual([]);
    });
  }

  it('babel-preset-expo specifically stays declared', () => {
    // Called out by name because losing it does not fail loudly: it resolves via
    // hoisting from `expo` right up until the tree reshapes, and then Metro dies.
    expect(declared.has('babel-preset-expo')).toBe(true);
  });

  it('expo-modules-jsi stays declared and pinned, because a prebuilt binary depends on the exact version', () => {
    // expo-modules-core 56.0.14 ships as a prebuilt binary whose ABI is frozen; it
    // needs the NON-throwing JSI methods, which exist only at 56.0.7. Left undeclared,
    // npm drifts it and iOS stops launching. An exact pin, not a range.
    const spec =
      (pkg.dependencies ?? {})['expo-modules-jsi'] ??
      (pkg.devDependencies ?? {})['expo-modules-jsi'];
    expect(spec).toBe('56.0.7');
  });
});
