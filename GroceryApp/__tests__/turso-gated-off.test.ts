/**
 * Turso gated off for v1 (Option B) — regression tests.
 *
 * Pins the credential-purge decision recorded in GOAL_PROMPT_NOTES.md:
 *  - No client-side source may reference the Turso credential fields or the
 *    EXPO_PUBLIC_TURSO_* build-time env vars (mirrors the release check
 *    `grep -rn -E "tursoToken|tursoUrl|EXPO_PUBLIC_TURSO" App.tsx src`).
 *  - App.tsx never initializes the Turso client.
 *  - The Deals tab is compiled out (DEALS_TAB_ENABLED = false).
 *  - isTursoReady() is false — every consumer degrades gracefully.
 *  - Settings persisted by earlier versions that still carry Turso
 *    credentials are stripped on load and the cleaned object re-persisted.
 *
 * Run: npx jest __tests__/turso-gated-off.test.ts
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import sodium from 'libsodium-wrappers';

const APP_ROOT = path.resolve(__dirname, '..');
const CREDENTIAL_PATTERN = /tursoToken|tursoUrl|EXPO_PUBLIC_TURSO/;

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

// ─── Source-level checks (mirror the release grep) ──────────────────────────

describe('Turso credential path is gone from client source', () => {
  it('App.tsx and src/** contain no Turso credential identifiers', () => {
    const files = [path.join(APP_ROOT, 'App.tsx'), ...walk(path.join(APP_ROOT, 'src'))];
    const offenders: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      if (CREDENTIAL_PATTERN.test(content)) offenders.push(path.relative(APP_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('App.tsx never calls initTurso', () => {
    const appTsx = fs.readFileSync(path.join(APP_ROOT, 'App.tsx'), 'utf8');
    expect(appTsx).not.toContain('initTurso');
  });

  it('the Deals tab is compiled out (DEALS_TAB_ENABLED = false)', () => {
    const tabBar = fs.readFileSync(
      path.join(APP_ROOT, 'src', 'components', 'BottomTabBar.tsx'),
      'utf8',
    );
    expect(tabBar).toContain('DEALS_TAB_ENABLED = false');
  });
});

// ─── Runtime checks ──────────────────────────────────────────────────────────

describe('Turso client is never initialized at runtime', () => {
  it('isTursoReady() is false on a fresh app start', async () => {
    const { isTursoReady } = await import('../src/services/tursoClient');
    expect(isTursoReady()).toBe(false);
  });
});

describe('persisted-settings migration strips Turso credentials', () => {
  beforeAll(async () => {
    await sodium.ready;
  });

  it('initSettings purges turso* fields stored by earlier versions and stays clean', async () => {
    const { initSettings, updateSettings, getSettings, clearSettings } = await import(
      '../src/config/settings'
    );

    await clearSettings();
    await initSettings();

    // Simulate an old install: settings persisted on device still carry the
    // removed credential fields (updateSettings writes through to the store).
    await updateSettings({
      tursoUrl: 'https://legacy-db.example.io',
      tursoToken: 'legacy-jwt-value',
      tursoEnabled: true,
    } as any);

    // Simulate the next app start: initSettings reloads from the store and
    // must strip every turso* key and re-persist the cleaned object.
    const migrated = await initSettings();
    const tursoKeys = Object.keys(migrated).filter((k) => k.startsWith('turso'));
    expect(tursoKeys).toEqual([]);

    // A further restart loads the re-persisted object — still clean.
    const reloaded = await initSettings();
    expect(Object.keys(reloaded).filter((k) => k.startsWith('turso'))).toEqual([]);
    expect(Object.keys(getSettings()).filter((k) => k.startsWith('turso'))).toEqual([]);

    // Non-credential settings survive the migration untouched.
    expect(reloaded.hostingTier).toBeDefined();
    expect(reloaded.flyerScanEnabled).toBeDefined();
  });
});

describe('FlippDealsAdapter no longer depends on Turso credentials', () => {
  it('isAvailable() is driven only by the flyer-scan opt-in', async () => {
    const { initSettings, updateSettings, clearSettings } = await import(
      '../src/config/settings'
    );
    const { flippDealsAdapter } = await import('../src/pricing/flipp-deals-adapter');

    await clearSettings();
    await initSettings();

    await updateSettings({ flyerScanEnabled: false });
    expect(flippDealsAdapter.isAvailable()).toBe(false);

    await updateSettings({ flyerScanEnabled: true });
    expect(flippDealsAdapter.isAvailable()).toBe(true);
  });
});
