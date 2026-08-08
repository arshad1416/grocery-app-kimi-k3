/**
 * Relay auth regression tests — audit findings H5, L1 and the tail of H4.
 *
 * H5: the opt-in voice-assistant OAuth pairing flow minted 6-digit
 *     Math.random() pairing codes, polled them through an unauthenticated and
 *     unrate-limited /oauth/status against sessions that were never evicted,
 *     and stored whatever redirect_uri the caller supplied (open redirect).
 * L1: POST /enroll had no rate limiting of any kind.
 * H4 (tail): GET /health handed out the same aggregate counters that /stats
 *     was hardened to withhold, unauthenticated and cross-origin readable.
 *
 * Servers are spawned as child processes (the hardening.test.js pattern) so
 * this file can run alongside the suites that bind their own ports, and so the
 * limiter tests get a process whose per-IP counters nothing else has touched.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nacl = require('tweetnacl');

// Server A — functional flow. Generous limits, short pairing-session TTL so the
// expiry assertion doesn't sit for ten minutes.
const PORT_A = 9700;
// Server B — limiter behaviour. Tight /enroll budget; its per-IP counters are
// deliberately isolated from server A's.
const PORT_B = 9710;
// Server C — proxy-aware limiter behaviour: TRUST_PROXY on, so the per-IP key
// comes from X-Forwarded-For and the IPv6 /64 bucketing is observable.
const PORT_C = 9720;
// Server D — default /oauth/authorize budget, for the flood test.
const PORT_D = 9730;
// Server E — the live-pairing-session ceiling (cap 2, budget wide open so the
// 503 that fires is the cap and not the rate limiter).
const PORT_E = 9740;

// Server F — the deployment docs/self-host-security.md actually recommends:
// TRUST_PROXY unset and no X-Forwarded-For reaching the relay. Every per-IP
// budget silently collapses into one relay-wide budget here, so the collapse
// has to be shouted about.
const PORT_F = 9770;
// Server G — a two-hop chain (CDN in front of nginx) declared with
// TRUSTED_PROXY_HOPS=2.
const PORT_G = 9780;

const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;
const BASE_C = `http://127.0.0.1:${PORT_C}`;
const BASE_D = `http://127.0.0.1:${PORT_D}`;
const BASE_E = `http://127.0.0.1:${PORT_E}`;
const BASE_F = `http://127.0.0.1:${PORT_F}`;
const BASE_G = `http://127.0.0.1:${PORT_G}`;

const ALLOWED_REDIRECT = 'https://oauth.example.com/cb';
const SESSION_TTL_MS = 1500;

const children = [];
const stderrOf = new Map();

/**
 * Poll a child's accumulated stderr for `needle`. A child's console.warn and
 * the parent's 'data' event are decoupled, so asserting immediately after the
 * request that triggered the warning is a race.
 */
async function waitForStderr(port, needle, timeoutMs = 2000) {
  const entry = stderrOf.get(port);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (entry.stderr.includes(needle)) return entry.stderr;
    await new Promise((r) => setTimeout(r, 25));
  }
  return entry.stderr;
}

function startServer(port, extraEnv) {
  const stateFile = path.join(__dirname, `__relay_auth_test_state_${port}__.json`);
  try { fs.unlinkSync(stateFile); } catch {}

  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      RELAY_PORT: String(port),
      POOL_PORT: String(port + 1),
      RELAY_STATE_FILE: stateFile,
      RELAY_DATA_DIR: '',
      ASSISTANT_INTEGRATION: 'true',
      ASSISTANT_REDIRECT_URIS: ALLOWED_REDIRECT,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Accumulated so the proxy-misconfiguration warnings can be asserted on.
  const entry = { child, stateFile, stderr: '' };
  child.stderr.on('data', (chunk) => { entry.stderr += chunk.toString(); });
  children.push(entry);
  stderrOf.set(port, entry);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server on ${port} did not start`)), 8000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Listening on port')) {
        clearTimeout(timeout);
        resolve(child);
      }
    });
    child.on('error', reject);
  });
}

beforeAll(async () => {
  await Promise.all([
    // A runs dozens of /oauth/authorize calls across the suite, well past the
    // 15/min a real operator wants, so its authorize budget is opened up.
    startServer(PORT_A, {
      OAUTH_SESSION_TTL_MS: String(SESSION_TTL_MS),
      OAUTH_AUTHORIZE_LIMIT: '500',
    }),
    startServer(PORT_B, { ENROLL_RATE_LIMIT: '3' }),
    // C doubles as the "every budget is operator-tunable" server: each of these
    // is far below its default, so a hardcoded constant fails the tests below.
    startServer(PORT_C, {
      TRUST_PROXY: 'true',
      ENROLL_RATE_LIMIT: '2',
      OAUTH_MISS_LIMIT: '3',
      OAUTH_PAIR_MAX_ATTEMPTS: '2',
      OAUTH_POLL_LIMIT: '20',
    }),
    startServer(PORT_D, {}),
    startServer(PORT_E, { OAUTH_MAX_SESSIONS: '2', OAUTH_AUTHORIZE_LIMIT: '100' }),
    // '' rather than omitting the key: the parent env is inherited wholesale,
    // and `=== 'true'` is false either way.
    startServer(PORT_F, { TRUST_PROXY: '' }),
    startServer(PORT_G, { TRUST_PROXY: 'true', TRUSTED_PROXY_HOPS: '2', ENROLL_RATE_LIMIT: '2' }),
  ]);
}, 20000);

afterAll(async () => {
  for (const { child, stateFile } of children) {
    // SIGKILL, not SIGTERM: the graceful path waits up to 5s on server.close()
    // for keep-alive sockets, and if Jest force-exits the worker inside that
    // window (another suite in this project leaks an in-process server, which
    // triggers exactly that) the child is orphaned and the next run hits
    // EADDRINUSE. Nothing here needs a clean flush — the state file is deleted
    // on the next line.
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));
    try { fs.unlinkSync(stateFile); } catch {}
  }
});

// afterAll is not guaranteed to finish: Jest force-exits the worker when
// another suite in this project leaks a handle, and anything still spawned at
// that point is orphaned and holds its port, so the NEXT run dies on
// EADDRINUSE. A synchronous exit hook runs on that path too.
process.on('exit', () => {
  for (const { child } of children) {
    try { child.kill('SIGKILL'); } catch {}
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInvite(familyId, keypair) {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const nonce = Buffer.from(nacl.randomBytes(16)).toString('base64');
  const deviceId = Buffer.from(keypair.publicKey).toString('base64');
  const payload = JSON.stringify({ familyId, deviceId, expiresAt, nonce });
  const sig = nacl.sign.detached(new TextEncoder().encode(payload), keypair.secretKey);
  return JSON.stringify({
    familyId,
    deviceId,
    expiresAt,
    nonce,
    signature: Buffer.from(sig).toString('base64'),
  });
}

function enroll(base, familyInviteToken, headers = {}) {
  return fetch(`${base}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      deviceToken: crypto.randomBytes(32).toString('base64'),
      familyInviteToken,
    }),
  });
}

function authorize(base, redirectUri = ALLOWED_REDIRECT, headers = {}) {
  return fetch(
    `${base}/oauth/authorize?client_id=test-client&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&state=test-state`,
    { headers }
  );
}

/** Start an account-linking session and return its pairing code. */
async function newPairingCode(base, redirectUri = ALLOWED_REDIRECT) {
  const res = await authorize(base, redirectUri);
  expect(res.status).toBe(200);
  const html = await res.text();
  const match = html.match(/class="code">([^<]+)<\/div>/);
  expect(match).not.toBeNull();
  return match[1];
}

function pair(base, body) {
  return fetch(`${base}/api/oauth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const serverSrc = () => fs.readFileSync(path.join(__dirname, 'server.js'), 'utf-8');

/** Slice out a top-level `function name(...) { ... }` body for source assertions. */
function sourceOf(fnName) {
  const src = serverSrc();
  const start = src.indexOf(`function ${fnName}(`);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end);
}

// ─── H5a: pairing codes come from a CSPRNG over a real keyspace ───────────────

describe('H5 — pairing code generation', () => {
  it('generatePairingCodeString uses a CSPRNG, not Math.random', () => {
    const fn = sourceOf('generatePairingCodeString');
    expect(fn).not.toMatch(/Math\.random/);
    expect(fn).toMatch(/crypto\.randomInt|crypto\.randomBytes/);
  });

  it('issued codes are at least 8 characters and not the old 6-digit format', async () => {
    const code = await newPairingCode(BASE_A);
    expect(code).not.toMatch(/^\d{6}$/);
    expect(code.length).toBeGreaterThanOrEqual(8);
  });

  it('20 consecutive codes are all distinct', async () => {
    const codes = [];
    for (let i = 0; i < 20; i++) codes.push(await newPairingCode(BASE_A));
    expect(new Set(codes).size).toBe(20);
  });
});

// ─── H5b: redirect_uri allowlist ──────────────────────────────────────────────

describe('H5 — redirect_uri allowlist', () => {
  it('an allowlisted redirect_uri is accepted', async () => {
    const res = await fetch(
      `${BASE_A}/oauth/authorize?client_id=c&response_type=code&state=s` +
        `&redirect_uri=${encodeURIComponent(ALLOWED_REDIRECT)}`
    );
    expect(res.status).toBe(200);
  });

  it('an unregistered redirect_uri is rejected — no open redirect', async () => {
    const res = await fetch(
      `${BASE_A}/oauth/authorize?client_id=c&response_type=code&state=s` +
        `&redirect_uri=${encodeURIComponent('https://evil.example.net/steal')}`
    );
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toMatch(/redirect_uri/);
  });

  it('a prefix-extension of an allowlisted URI is rejected (exact match only)', async () => {
    const res = await fetch(
      `${BASE_A}/oauth/authorize?client_id=c&response_type=code&state=s` +
        `&redirect_uri=${encodeURIComponent(ALLOWED_REDIRECT + '.evil.net/x')}`
    );
    expect(res.status).toBe(400);
  });
});

// ─── H5c: constant-time lookup, malformed codes ───────────────────────────────

describe('H5 — pairing code comparison', () => {
  it('the pairing-code lookup uses timingSafeEqual', () => {
    expect(sourceOf('findPairingSession')).toMatch(/timingSafeEqual/);
  });

  it('a short pairing code is a clean 404, not a crash', async () => {
    const res = await fetch(`${BASE_A}/oauth/status?pairingCode=abc`);
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty('error');
  });

  it('an over-long pairing code is a clean 404, not a crash', async () => {
    const res = await pair(BASE_A, {
      pairingCode: 'A'.repeat(512),
      familyId: 'f',
      encryptedMasterKey: 'k',
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty('error');
  });
});

// ─── H5d: pairing sessions expire ─────────────────────────────────────────────

describe('H5 — pairing session expiry', () => {
  it('a session is pollable before its TTL and gone after it', async () => {
    const code = await newPairingCode(BASE_A);

    const fresh = await fetch(`${BASE_A}/oauth/status?pairingCode=${code}`);
    expect(fresh.status).toBe(200);
    expect((await fresh.json()).linked).toBe(false);

    await new Promise((r) => setTimeout(r, SESSION_TTL_MS + 500));

    const stale = await fetch(`${BASE_A}/oauth/status?pairingCode=${code}`);
    expect(stale.status).toBe(404);

    // And the expired code can no longer be linked.
    const linkAttempt = await pair(BASE_A, {
      pairingCode: code,
      familyId: 'family-late',
      encryptedMasterKey: 'k',
    });
    expect(linkAttempt.status).toBe(404);
  });
});

// ─── H5e: bounded attempts per code ───────────────────────────────────────────

describe('H5 — bounded attempts per pairing code', () => {
  it('a linked session cannot be re-pointed at another family', async () => {
    const code = await newPairingCode(BASE_A);

    const first = await pair(BASE_A, {
      pairingCode: code,
      familyId: 'family-legit',
      encryptedMasterKey: 'sealed-legit',
    });
    expect(first.status).toBe(200);
    expect((await first.json()).success).toBe(true);

    const hijack = await pair(BASE_A, {
      pairingCode: code,
      familyId: 'family-attacker',
      encryptedMasterKey: 'sealed-attacker',
    });
    expect(hijack.status).toBe(409);

    // The authorization still carries the legitimate family.
    const status = await fetch(`${BASE_A}/oauth/status?pairingCode=${code}`);
    expect(status.status).toBe(200);
    const data = await status.json();
    expect(data.linked).toBe(true);
    expect(data.redirectUri.startsWith(ALLOWED_REDIRECT)).toBe(true);
  });

  it('a third party cannot burn an already-linked session out of existence', async () => {
    // Server C runs OAUTH_PAIR_MAX_ATTEMPTS=2, so three post-link submissions
    // are well past the budget. They must all be a flat 409 that leaves the
    // session intact: once a code is linked its attempt budget is irrelevant,
    // and spending it would let anyone who learned the code deny the legitimate
    // link before the vendor exchanges the authCode.
    const code = await newPairingCode(BASE_C);
    expect((await pair(BASE_C, {
      pairingCode: code,
      familyId: 'family-holds',
      encryptedMasterKey: 'sealed-legit',
    })).status).toBe(200);

    for (let i = 0; i < 3; i++) {
      const res = await pair(BASE_C, {
        pairingCode: code,
        familyId: 'family-attacker',
        encryptedMasterKey: 'sealed-attacker',
      });
      expect(res.status).toBe(409);
    }

    // Still linked, still exchangeable.
    const status = await fetch(`${BASE_C}/oauth/status?pairingCode=${code}`);
    expect(status.status).toBe(200);
    expect((await status.json()).linked).toBe(true);
  });

  it('the linking happy path still completes: authorize → pair → token', async () => {
    const code = await newPairingCode(BASE_A);

    const linked = await pair(BASE_A, {
      pairingCode: code,
      familyId: 'family-happy-path',
      encryptedMasterKey: 'sealed-for-the-webhook',
    });
    expect(linked.status).toBe(200);

    const status = await fetch(`${BASE_A}/oauth/status?pairingCode=${code}`);
    const { redirectUri } = await status.json();
    const authCode = new URL(redirectUri).searchParams.get('code');
    expect(authCode).toBeTruthy();

    const token = await fetch(`${BASE_A}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: ALLOWED_REDIRECT,
        client_id: 'test-client',
      }),
    });
    expect(token.status).toBe(200);
    const granted = await token.json();
    expect(granted.access_token).toBeTruthy();
    expect(granted.token_type).toBe('Bearer');
  });

  it('a code is destroyed after too many submissions', async () => {
    const code = await newPairingCode(BASE_A);

    // Well-formed-code, invalid-payload submissions burn the attempt budget.
    let sawLockout = false;
    for (let i = 0; i < 10 && !sawLockout; i++) {
      const res = await pair(BASE_A, { pairingCode: code, familyId: 'f' }); // no key
      if (res.status === 429) sawLockout = true;
    }
    expect(sawLockout).toBe(true);

    // Even a fully valid submission now fails: the session is gone.
    const res = await pair(BASE_A, {
      pairingCode: code,
      familyId: 'f',
      encryptedMasterKey: 'k',
    });
    expect(res.status).toBe(404);
  });
});

// ─── H5f: polling is rate limited ─────────────────────────────────────────────

describe('H5 — /oauth/status rate limiting', () => {
  it('per-IP guessing of unknown codes is cut off', async () => {
    let sawLockout = false;
    let statuses = [];
    for (let i = 0; i < 40 && !sawLockout; i++) {
      const res = await fetch(`${BASE_B}/oauth/status?pairingCode=ZZZZ${String(i).padStart(4, '0')}`);
      statuses.push(res.status);
      if (res.status === 429) sawLockout = true;
    }
    expect(statuses[0]).toBe(404); // misses answer honestly at first
    expect(sawLockout).toBe(true);
  });

  it('polling a known code is also bounded', async () => {
    const code = await newPairingCode(BASE_B);
    let sawLockout = false;
    for (let i = 0; i < 200 && !sawLockout; i++) {
      const res = await fetch(`${BASE_B}/oauth/status?pairingCode=${code}`);
      if (res.status === 429) sawLockout = true;
    }
    expect(sawLockout).toBe(true);
  });
});

// ─── H5g: /oauth/authorize — the one route that allocates state ───────────────

describe('H5 — /oauth/authorize is bounded', () => {
  it('a flood of link attempts from one IP is cut off with 429', async () => {
    // Server D leaves OAUTH_AUTHORIZE_LIMIT at its default (15/min).
    const statuses = [];
    for (let i = 0; i < 25 && !statuses.includes(429); i++) {
      statuses.push((await authorize(BASE_D)).status);
    }
    expect(statuses[0]).toBe(200); // a real "link account" click still works
    expect(statuses).toContain(429);
  });

  it('live pairing sessions are hard-capped, not grown without limit', async () => {
    // Server E: OAUTH_MAX_SESSIONS=2, generous per-IP budget, so the ceiling
    // that bites is the session count rather than the request rate.
    expect((await authorize(BASE_E)).status).toBe(200);
    expect((await authorize(BASE_E)).status).toBe(200);
    const third = await authorize(BASE_E);
    expect(third.status).toBe(503);
    expect(third.headers.get('retry-after')).toBe('60');
  });
});

// ─── The budgets are operator-tunable, not hardcoded ─────────────────────────
//
// A household behind one NAT can exceed a default that was sized for one
// client, and there has to be a knob for that. Server C runs every budget far
// below its default, so a hardcoded constant fails all three.

describe('oauth budgets honour their env overrides', () => {
  it('OAUTH_MISS_LIMIT=3 cuts guessing off at the 4th miss', async () => {
    const statuses = [];
    for (let i = 0; i < 6 && !statuses.includes(429); i++) {
      statuses.push((await fetch(`${BASE_C}/oauth/status?pairingCode=QQQQ${i}000`)).status);
    }
    expect(statuses.slice(0, 3)).toEqual([404, 404, 404]);
    expect(statuses[3]).toBe(429);
  });

  it('OAUTH_PAIR_MAX_ATTEMPTS=2 destroys a code on the 3rd submission', async () => {
    const code = await newPairingCode(BASE_C);
    expect((await pair(BASE_C, { pairingCode: code, familyId: 'f' })).status).toBe(400);
    expect((await pair(BASE_C, { pairingCode: code, familyId: 'f' })).status).toBe(400);
    expect((await pair(BASE_C, { pairingCode: code, familyId: 'f' })).status).toBe(429);
  });

  it('OAUTH_POLL_LIMIT=20 bounds polling of a code the caller legitimately holds', async () => {
    const code = await newPairingCode(BASE_C);
    let sawLockout = false;
    for (let i = 0; i < 40 && !sawLockout; i++) {
      if ((await fetch(`${BASE_C}/oauth/status?pairingCode=${code}`)).status === 429) sawLockout = true;
    }
    expect(sawLockout).toBe(true);
  });
});

// ─── H5h: /oauth/token honours the session TTL ────────────────────────────────

describe('H5 — expired sessions are not exchangeable', () => {
  it('an expired but linked session cannot be traded for an access token', async () => {
    const code = await newPairingCode(BASE_A);

    const linked = await pair(BASE_A, {
      pairingCode: code,
      familyId: 'family-ttl-token',
      encryptedMasterKey: 'sealed',
    });
    expect(linked.status).toBe(200);

    const status = await fetch(`${BASE_A}/oauth/status?pairingCode=${code}`);
    const authCode = new URL((await status.json()).redirectUri).searchParams.get('code');
    expect(authCode).toBeTruthy();

    // /oauth/token matches on authCode and never goes through
    // findPairingSession, so it has to apply the TTL itself.
    await new Promise((r) => setTimeout(r, SESSION_TTL_MS + 500));

    const token = await fetch(`${BASE_A}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: ALLOWED_REDIRECT,
        client_id: 'test-client',
      }),
    });
    expect(token.status).toBe(400);
    expect(await token.json()).toHaveProperty('error');
  });
});

// ─── Rate-limit keying: X-Forwarded-For and the IPv6 /64 bucket ───────────────

describe('rate-limit keying behind a proxy', () => {
  // Server C: TRUST_PROXY=true, ENROLL_RATE_LIMIT=2.
  const invite = () => makeInvite('family-ipv6-' + crypto.randomUUID(), nacl.sign.keyPair());
  const xff = (addr) => ({ 'X-Forwarded-For': addr });

  it('a whole IPv6 /64 shares one budget, whatever form the address is written in', async () => {
    // Same /64 (2001:db8:1:2::/64) three ways: compressed, expanded-with-
    // leading-zeros, and a different interface identifier. Keying on the full
    // /128 would give an attacker with a routine /64 allocation 2^64 free
    // budgets and make the limiter decorative.
    expect((await enroll(BASE_C, invite(), xff('2001:db8:1:2::1'))).status).toBe(200);
    expect((await enroll(BASE_C, invite(), xff('2001:0db8:0001:0002:aaaa::9'))).status).toBe(200);
    expect((await enroll(BASE_C, invite(), xff('2001:db8:1:2:ffff:ffff:ffff:ffff'))).status).toBe(429);
  });

  it('a forged leading X-Forwarded-For entry cannot buy a fresh budget', async () => {
    // nginx's $proxy_add_x_forwarded_for and Caddy's default both APPEND the
    // real peer, so the leftmost entry is whatever the caller sent. Keying on
    // it would let one host bypass every budget by varying a header. Same /64
    // in the trailing (proxy-written) position all three times.
    const forge = (n) => `198.51.100.${n}, 2001:db8:5:5::${n}`;
    expect((await enroll(BASE_C, invite(), xff(forge(1)))).status).toBe(200);
    expect((await enroll(BASE_C, invite(), xff(forge(2)))).status).toBe(200);
    expect((await enroll(BASE_C, invite(), xff(forge(3)))).status).toBe(429);
  });

  it('a different /64 gets its own budget', async () => {
    expect((await enroll(BASE_C, invite(), xff('2001:db8:9:9::1'))).status).toBe(200);
  });

  it('IPv4 and IPv4-mapped forms of one address share a budget', async () => {
    expect((await enroll(BASE_C, invite(), xff('198.51.100.7'))).status).toBe(200);
    expect((await enroll(BASE_C, invite(), xff('::ffff:198.51.100.7'))).status).toBe(200);
    expect((await enroll(BASE_C, invite(), xff('198.51.100.7'))).status).toBe(429);
  });
});

// ─── The silent per-IP collapse in the recommended deployment ─────────────────

describe('proxy misconfiguration is not silent', () => {
  const invite = () => makeInvite('family-proxywarn-' + crypto.randomUUID(), nacl.sign.keyPair());

  it('warns at boot when TRUST_PROXY is unset', async () => {
    // docs/self-host-security.md Option A (the "recommended" nginx block) sets
    // X-Forwarded-Proto and not X-Forwarded-For, and TRUST_PROXY is documented
    // nowhere, so this is the state an operator lands in by following the
    // shipped instructions. It has to say something.
    const err = await waitForStderr(PORT_F, 'TRUST_PROXY is not set');
    expect(err).toContain('TRUST_PROXY is not set');
    expect(err).toMatch(/relay-wide budget/);
  });

  it('does not warn at boot when TRUST_PROXY is set', () => {
    // Server C is correctly configured; the warning must not be background noise.
    expect(stderrOf.get(PORT_C).stderr).not.toContain('TRUST_PROXY is not set');
  });

  it('names the collapse when requests arrive from a loopback peer with no X-Forwarded-For', async () => {
    // The case the old warning missed: TRUST_PROXY is false AND the header is
    // absent, so the two "agree" and nothing fired — while every client on the
    // relay shared one budget.
    expect((await enroll(BASE_F, invite())).status).toBe(200);
    const err = await waitForStderr(PORT_F, 'every client shares one rate-limit budget');
    expect(err).toContain('every client shares one rate-limit budget');
    expect(err).toMatch(/127\.0\.0\.1|0:0:0:0/);
  });
});

// ─── TRUSTED_PROXY_HOPS: a two-proxy chain ───────────────────────────────────

describe('TRUSTED_PROXY_HOPS', () => {
  // Server G: TRUST_PROXY=true, TRUSTED_PROXY_HOPS=2, ENROLL_RATE_LIMIT=2.
  const invite = () => makeInvite('family-hops-' + crypto.randomUUID(), nacl.sign.keyPair());
  const xff = (addr) => ({ 'X-Forwarded-For': addr });

  it('keys on the entry the operator\'s own edge wrote, not the last one', async () => {
    // CDN → nginx: nginx appends the CDN's address, the CDN appended the real
    // client. With two declared hops the real client is second from the right.
    // Leading and trailing entries vary; only the middle is constant, so a
    // relay keying on the rightmost entry never rate-limits this at all.
    const chain = (n) => `9.9.9.${n}, 5.6.7.8, 203.0.113.${n}`;
    expect((await enroll(BASE_G, invite(), xff(chain(1)))).status).toBe(200);
    expect((await enroll(BASE_G, invite(), xff(chain(2)))).status).toBe(200);
    expect((await enroll(BASE_G, invite(), xff(chain(3)))).status).toBe(429);
  });

  it('discards a header too short for the declared chain instead of trusting it', async () => {
    // A single-entry header cannot have come through two appending proxies, so
    // it is ignored and the real peer (loopback, here) is used. Clamping to
    // index 0 instead would hand each of these its own bucket and never 429 —
    // exactly the forged-leading-entry bypass, re-opened via a config value.
    expect((await enroll(BASE_G, invite(), xff('198.18.0.1'))).status).toBe(200);
    expect((await enroll(BASE_G, invite(), xff('198.18.0.2'))).status).toBe(200);
    expect((await enroll(BASE_G, invite(), xff('198.18.0.3'))).status).toBe(429);
  });
});

// ─── L1: /enroll is rate limited, and enrollment still works ──────────────────

describe('L1 — POST /enroll rate limiting', () => {
  let relayToken;

  it('a valid enrollment still succeeds', async () => {
    const res = await enroll(BASE_A, makeInvite('family-enroll-ok-' + Date.now(), nacl.sign.keyPair()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.relayToken).toBeTruthy();
    relayToken = body.relayToken;
  });

  it('a flood from one source IP is cut off with 429', async () => {
    // Server B runs with ENROLL_RATE_LIMIT=3.
    const results = [];
    for (let i = 0; i < 6; i++) {
      const res = await enroll(BASE_B, makeInvite('family-flood-' + i, nacl.sign.keyPair()));
      results.push(res.status);
    }
    expect(results[0]).toBe(200);
    expect(results).toContain(429);
    // The limiter must run before the body is parsed and the signature verified.
    expect(results[results.length - 1]).toBe(429);
  });

  // ─── H4 tail: /health ───────────────────────────────────────────────────────

  it('unauthenticated GET /health is a bare liveness signal', async () => {
    const res = await fetch(`${BASE_A}/health`);
    expect(res.status).toBe(200); // container healthcheck must keep working
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.families).toBeUndefined();
    expect(data.clients).toBeUndefined();
    expect(data.enrolledDevices).toBeUndefined();
    expect(data.uptime).toBeUndefined();
  });

  it('GET /health with a bogus relayToken is refused', async () => {
    const res = await fetch(`${BASE_A}/health`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status).toBe(403);
  });

  it('GET /health with an enrolled relayToken returns the counters, no wildcard CORS', async () => {
    expect(relayToken).toBeTruthy();
    const res = await fetch(`${BASE_A}/health`, {
      headers: { Authorization: `Bearer ${relayToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.enrolledDevices).toEqual(expect.any(Number));
    expect(data.uptime).toEqual(expect.any(Number));
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
