/**
 * Deployability tests for the relay container image.
 *
 * These are the STATIC EQUIVALENT of `docker build && docker run && curl /health`.
 * The machine this was authored on has no docker daemon, and CI cannot be relied
 * on to have one either, so instead of trusting that the image boots we assert the
 * two things that actually make it boot:
 *
 *   1. every local module server.js reaches is COPYed into the image and is not
 *      cancelled out by .dockerignore  (a missing COPY = MODULE_NOT_FOUND at boot);
 *   2. no secret or local state file can be baked into a published layer.
 *
 * Plus the state-durability property the named volume depends on: everything
 * durable is written under RELAY_DATA_DIR, never into the image's own /app layer.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const RELAY_ROOT = __dirname;
const REPO_ROOT = path.join(RELAY_ROOT, '..');
const DOCKERFILE = fs.readFileSync(path.join(RELAY_ROOT, 'Dockerfile'), 'utf-8');
const DOCKERIGNORE = fs.readFileSync(path.join(RELAY_ROOT, '.dockerignore'), 'utf-8');
const COMPOSE = fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.yml'), 'utf-8');

// ── .dockerignore matching ────────────────────────────────────────────────
// Docker matches each pattern against the context-relative path with Go's
// filepath.Match, so `*` does NOT cross a `/` — `*.test.js` excludes
// server.test.js but not tokens/__tests__/x.test.js. A pattern that matches a
// directory excludes everything beneath it, so we test every ancestor prefix.
function ignorePatterns() {
  return DOCKERIGNORE.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/\/+$/, ''));
}

function patternToRegExp(pattern) {
  const source = pattern
    .split('/')
    .map((seg) =>
      seg === '**'
        ? '.*'
        : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
    )
    .join('/');
  return new RegExp(`^${source}$`);
}

function isDockerIgnored(relPath) {
  const segments = relPath.split('/');
  const prefixes = segments.map((_, i) => segments.slice(0, i + 1).join('/'));
  return ignorePatterns().some((p) => {
    const re = patternToRegExp(p);
    return prefixes.some((prefix) => re.test(prefix));
  });
}

// ── Dockerfile COPY allowlist ─────────────────────────────────────────────
// `COPY a.js b.js ./` and `COPY lib/ ./lib/` — every token but the last is a
// source. A source ending in `/` contributes its whole subtree.
function copiedSources() {
  const sources = [];
  for (const line of DOCKERFILE.split('\n')) {
    const m = line.match(/^\s*COPY\s+(.+)$/);
    if (!m) continue;
    const tokens = m[1].trim().split(/\s+/).filter((t) => !t.startsWith('--'));
    sources.push(...tokens.slice(0, -1));
  }
  return sources;
}

function isCopiedIntoImage(relPath) {
  return copiedSources().some(
    (src) => (src.endsWith('/') ? relPath.startsWith(src) : relPath === src)
  );
}

// ── Local require graph, rooted at the CMD entrypoint ─────────────────────
// Includes lazily-required modules (server.js defers several behind route
// handlers); a lazy require still throws MODULE_NOT_FOUND in the container,
// just later and under load, which is strictly worse than failing at boot.
function localRequireClosure(entry) {
  const seen = new Set();
  const queue = [require.resolve(entry)];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf-8');
    for (const m of src.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      queue.push(require.resolve(path.resolve(path.dirname(file), m[1])));
    }
  }
  return [...seen].map((f) => path.relative(RELAY_ROOT, f));
}

describe('relay container image is deployable', () => {
  test('every local module server.js needs is COPYed into the image', () => {
    const closure = localRequireClosure(path.join(RELAY_ROOT, 'server.js'));

    // Sanity: the walk actually found the graph rather than silently returning
    // just the entrypoint.
    expect(closure).toEqual(expect.arrayContaining(['server.js', 'encrypted-store.js']));
    expect(closure.length).toBeGreaterThan(5);

    const missing = closure.filter((f) => !isCopiedIntoImage(f));
    expect(missing).toEqual([]);
  });

  test('no module the server needs is cancelled out by .dockerignore', () => {
    const closure = localRequireClosure(path.join(RELAY_ROOT, 'server.js'));
    const ignored = closure.filter((f) => isDockerIgnored(f));
    expect(ignored).toEqual([]);
  });

  test('.dockerignore excludes every secret and local-state path', () => {
    // Each of these would otherwise be readable inside any published image.
    // relay-docs.json stays listed even though nothing writes it any more:
    // the cost of an extra ignore line is zero, and re-introducing a writer
    // without re-introducing the ignore is exactly how secrets leak.
    const mustExclude = [
      'keys/issuer-private-key.pem',
      'data/encrypted-updates.json',
      'relay-state.json',
      'used-tokens.json',
      'relay-docs.json',
      '.env',
      'tokens/__tests__/blind-rsa.test.js',
      'extract/extract-server.js.bak2',
      'deploy-image.test.js',
    ];
    const leaked = mustExclude.filter((f) => !isDockerIgnored(f));
    expect(leaked).toEqual([]);
  });

  test('the image never uses a blanket COPY of the build context', () => {
    // `COPY . ./` would defeat nothing less than every assertion above,
    // because .dockerignore is defence in depth, not the primary control.
    expect(DOCKERFILE).not.toMatch(/^\s*COPY\s+\.\s/m);
  });
});

describe('relay state persists in the volume, not the image layer', () => {
  const stateDirInImage = path.join(RELAY_ROOT, 'data');

  test('encrypted-store writes under RELAY_DATA_DIR and nowhere else', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-data-'));
    const preexisting = fs.existsSync(stateDirInImage)
      ? fs.readdirSync(stateDirInImage)
      : null;
    const prevDataDir = process.env.RELAY_DATA_DIR;

    try {
      process.env.RELAY_DATA_DIR = tmp;
      // encrypted-store.js resolves DATA_DIR at module load, so it must be
      // re-required after the env is set — a cached copy from another suite in
      // this worker would make this test pass for the wrong reason.
      jest.isolateModules(() => {
        const { addUpdate } = require('./encrypted-store');
        addUpdate('fam-persist', 'list-1', { ciphertext: 'YmFzZTY0', iv: 'aXY=', tag: 'dGFn' });
      });

      // Same RELAY_DATA_DIR, fresh module state = the container-restart case:
      // the second boot must see what the first boot wrote.
      jest.isolateModules(() => {
        const { getUpdates } = require('./encrypted-store');
        expect(getUpdates('fam-persist', 'list-1').length).toBe(1);
      });

      expect(fs.existsSync(path.join(tmp, 'data', 'encrypted-updates.json'))).toBe(true);

      // ...and nothing landed in /app, which in the container is a read-only
      // image layer that a volume mount does not cover.
      const after = fs.existsSync(stateDirInImage) ? fs.readdirSync(stateDirInImage) : null;
      expect(after).toEqual(preexisting);
    } finally {
      if (prevDataDir === undefined) delete process.env.RELAY_DATA_DIR;
      else process.env.RELAY_DATA_DIR = prevDataDir;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('server.js routes relay-state.json and used-tokens.json through RELAY_DATA_DIR', () => {
    // UsedTokensStore is not env-driven — its default is <relay-root>/used-tokens.json,
    // i.e. inside the image. server.js overrides it at the construction site, so
    // this is a wiring assertion, not a runtime one.
    const src = fs.readFileSync(path.join(RELAY_ROOT, 'server.js'), 'utf-8');
    expect(src).toMatch(/RELAY_DATA_DIR\s*\?\s*\{\s*storeFile:\s*path\.join\(RELAY_DATA_DIR,\s*'used-tokens\.json'\)/);
    expect(src).toMatch(/RELAY_DATA_DIR\s*\?\s*path\.join\(RELAY_DATA_DIR,\s*'relay-state\.json'\)/);
  });

  test('docker-compose mounts RELAY_DATA_DIR as a named volume outside /app', () => {
    expect(COMPOSE).toMatch(/RELAY_DATA_DIR=\/data/);
    expect(COMPOSE).toMatch(/relay-data:\/data/);
    // A volume at /app would shadow the application code COPYed into the image.
    expect(COMPOSE).not.toMatch(/:\/app\s*$/m);
  });
});

describe('docker-compose describes the persistence that actually exists', () => {
  test('compose does not claim the relay stores Yjs doc state', () => {
    // L10: no Y.Doc is ever materialised server-side. The relay forwards opaque
    // client-encrypted update blobs; it cannot construct a Yjs document from
    // them, and doc-store.js — the module that could — is deleted.
    expect(COMPOSE).not.toMatch(/yjs doc state/i);
  });

  test('compose names the module that actually persists updates', () => {
    expect(COMPOSE).toMatch(/encrypted-store\.js/);
  });

  test('doc-store.js is gone and nothing can reach for it', () => {
    expect(fs.existsSync(path.join(RELAY_ROOT, 'doc-store.js'))).toBe(false);
  });
});
