/**
 * Turso reintroduction guard — structural, not credential-name based.
 *
 * ── Why this exists alongside turso-gated-off.test.ts ────────────────────────
 * That test pins the credential-purge decision by scanning App.tsx + src/**
 * for `tursoToken | tursoUrl | EXPO_PUBLIC_TURSO`, and asserts that App.tsx
 * does not call `initTurso`. Both checks are keyed on the SHAPE the credential
 * had when it was removed, which is not the shape a reintroduction would take:
 *
 *  - `src/services/tursoClient.ts` still ships. It is dynamically imported from
 *    `src/screens/AddItemSheet.tsx:394`, so the module is one line away from
 *    being live again.
 *  - The `initTurso` assertion covers App.tsx only. Any other module — a screen,
 *    an adapter, a service — can call it and the guard stays silent.
 *  - A developer who wires the client back up would not need to name a variable
 *    `tursoToken`. `const t = process.env.DB_TOKEN` defeats the whole pattern.
 *
 * Demonstrated: a synthetic `src/screens/DealsScreen.tsx` that calls
 * `initTurso()` and POSTs a bearer token to `/v2/pipeline` — i.e. the complete
 * credential path, restored — produces ZERO offenders under the old
 * CREDENTIAL_PATTERN and is caught by both assertions below.
 *
 * ── What is guarded ──────────────────────────────────────────────────────────
 * Two structural invariants, each keyed on something a reintroduction cannot
 * avoid regardless of naming:
 *
 *  1. `/v2/pipeline` — the Turso HTTP API endpoint. Talking to Turso from the
 *     client means naming this path. It may appear in exactly one module.
 *  2. `initTurso(` — the only way to arm the client. It may be called from
 *     exactly one module: the one that defines it.
 *
 * `tursoClient.ts` itself is the single permitted home. Deleting that module
 * outright would be the stronger fix — this guard is what makes keeping it
 * survivable in the meantime.
 *
 * Run: npx jest __tests__/turso-reintroduction-guard.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const APP_ROOT = path.resolve(__dirname, '..');

/** The one module allowed to contain the endpoint and define the initializer. */
const TURSO_CLIENT = path.join('src', 'services', 'tursoClient.ts');

/**
 * ponytail: source files only (.ts/.tsx). `src/services/BARCODE_FEATURE.md`
 * mentions `/v2/pipeline` while describing what tursoClient.ts does; prose
 * naming an endpoint cannot send a credential, and adding a per-file waiver
 * for docs is how allowlists start rotting into directory-wide exemptions.
 * Widen to docs only if a doc ever starts carrying a real host or token.
 */
const SOURCE_EXT = /\.tsx?$/;

const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; label: string; why: string }> = [
  {
    pattern: /\/v2\/pipeline/,
    label: '/v2/pipeline',
    why: 'Turso HTTP endpoint — a client that talks to Turso must name this path',
  },
  {
    pattern: /\binitTurso\s*\(/,
    label: 'initTurso(',
    why: 'arms the Turso client — callable from its defining module only',
  },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Files carrying a forbidden pattern, excluding the one permitted module. */
function offenders(root: string, label: string): string[] {
  const rule = FORBIDDEN.find((f) => f.label === label)!;
  const roots = [path.join(root, 'App.tsx'), path.join(root, 'src')].filter((p) =>
    fs.existsSync(p),
  );

  const found: string[] = [];
  for (const entry of roots) {
    const files = fs.statSync(entry).isDirectory() ? walk(entry) : [entry];
    for (const file of files) {
      if (!SOURCE_EXT.test(file)) continue;
      const relative = path.relative(root, file);
      if (relative === TURSO_CLIENT) continue;
      if (rule.pattern.test(fs.readFileSync(file, 'utf8'))) found.push(relative);
    }
  }
  return found.sort();
}

describe('Turso client cannot be reintroduced outside its own module', () => {
  // Deliberately no assertion that tursoClient.ts exists: deleting it is the
  // stronger fix, and a guard that goes red on the better outcome gets deleted
  // instead of adjusted. The exemption below simply stops matching anything.

  for (const { label, why } of FORBIDDEN) {
    it(`no file outside tursoClient.ts contains \`${label}\` (${why})`, () => {
      expect(offenders(APP_ROOT, label)).toEqual([]);
    });
  }
});

describe('the guard actually catches a reintroduction', () => {
  // Without this, a typo in either regex would leave the assertions above
  // passing forever while guarding nothing.
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'turso-guard-'));

  beforeAll(() => {
    fs.mkdirSync(path.join(fixture, 'src', 'screens'), { recursive: true });
    fs.writeFileSync(
      path.join(fixture, 'src', 'screens', 'DealsScreen.tsx'),
      [
        "import { initTurso, getTurso } from '../services/tursoClient';",
        'export async function loadDeals(host: string, tok: string) {',
        '  await initTurso();',
        '  const res = await fetch(`${host}/v2/pipeline`, {',
        '    headers: { Authorization: `Bearer ${tok}` },',
        '  });',
        '  return res.json();',
        '}',
        '',
      ].join('\n'),
    );
  });

  afterAll(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it('flags a screen that re-arms the client and POSTs to the endpoint', () => {
    expect(offenders(fixture, 'initTurso(')).toEqual(['src/screens/DealsScreen.tsx']);
    expect(offenders(fixture, '/v2/pipeline')).toEqual(['src/screens/DealsScreen.tsx']);
  });

  it('the pre-existing credential-name pattern misses that same file', () => {
    // The documented gap this guard closes: the old check is keyed on the
    // identifiers the credential happened to use, none of which a
    // reintroduction is obliged to reuse.
    const legacyPattern = /tursoToken|tursoUrl|EXPO_PUBLIC_TURSO/;
    const source = fs.readFileSync(
      path.join(fixture, 'src', 'screens', 'DealsScreen.tsx'),
      'utf8',
    );
    expect(legacyPattern.test(source)).toBe(false);
  });
});
