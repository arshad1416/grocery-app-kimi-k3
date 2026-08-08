/**
 * H11 — the token-issuance budget must be keyed on the *enrollment*, not on
 * the client-supplied deviceToken.
 *
 * Invariant guarded: handleTokenRequest in server.js keys the issuance budget on
 * `relayToken` (server-minted at /enroll), never on `enrollment.deviceId`. A red
 * run here means that keying regressed — it is not an expected failure.
 *
 * What the audit actually buys, and what it does not — the distinction matters
 * because the naive reading of H11 ("the client picks its own budget") is not
 * quite what the code does:
 *
 *   `/enroll` stores `deviceId: deviceToken` verbatim from the request body.
 *   Nothing signs it and nothing binds it to a key — the Ed25519 signature on
 *   the invite covers the *inviter's* deviceId, never the enrollee's. So the
 *   rate-limit key is a string the enrolling client chose.
 *
 *   It is NOT a volume multiplier: a fresh key still costs a fresh enrollment
 *   either way, so keying on relayToken does not lower the ceiling (it raises
 *   it slightly — re-enrolling resets a per-relayToken bucket, where a
 *   per-deviceId bucket carried over). Issuance volume is bounded by /enroll,
 *   MAX_DEVICES_PER_FAMILY and MAX_FAMILIES, not by this key.
 *
 *   It IS an integrity/availability hole, which is what this test pins. A
 *   deviceId is public inside a family — it is the base64 signing key embedded
 *   in every invite. Any family member can therefore enroll while *claiming a
 *   peer's deviceId* and spend that peer's hourly token budget, and the victim
 *   gets 429s on a bucket they never touched. A relayToken is 32 CSPRNG bytes
 *   minted server-side at /enroll and is not attacker-choosable, so the same
 *   attack has nowhere to aim.
 *
 * The child-process spawn is the relay-auth.test.js / hardening.test.js
 * pattern: an isolated process so the per-IP and per-device counters here are
 * untouched by any suite running alongside.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nacl = require('tweetnacl');

const RELAY_ROOT = path.join(__dirname, '..', '..');
const PORT = 9750;
const BASE = `http://127.0.0.1:${PORT}`;

// Two requests per hour is enough to prove a shared bucket without waiting on
// a real hour or firing ten requests.
const TOKEN_RATE_LIMIT = 2;

let child;
let stateFile;

beforeAll(async () => {
  stateFile = path.join(RELAY_ROOT, `__token_rate_limit_test_state_${PORT}__.json`);
  try { fs.unlinkSync(stateFile); } catch {}

  child = spawn(process.execPath, ['server.js'], {
    cwd: RELAY_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      RELAY_PORT: String(PORT),
      POOL_PORT: String(PORT + 1),
      RELAY_STATE_FILE: stateFile,
      RELAY_DATA_DIR: '',
      TOKEN_RATE_LIMIT: String(TOKEN_RATE_LIMIT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server on ${PORT} did not start`)), 8000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Listening on port')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('error', reject);
  });
}, 20000);

afterAll(async () => {
  if (child) {
    // SIGKILL, not SIGTERM — see the note in relay-auth.test.js: the graceful
    // path waits on keep-alive sockets and can outlive Jest's force-exit,
    // orphaning the child and hitting EADDRINUSE on the next run.
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));
  }
  try { fs.unlinkSync(stateFile); } catch {}
});

/** Signed family invite, same shape the client's family.ts serializes. */
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

async function enroll(familyId, keypair, deviceToken) {
  const res = await fetch(`${BASE}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken, familyInviteToken: makeInvite(familyId, keypair) }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).relayToken;
}

/**
 * Hit POST /relay/request-token with a body that fails JSON.parse.
 *
 * The rate limiter runs before the body is read (step 3 vs step 4 in
 * handleTokenRequest), so the counter still increments and no blind-RSA work
 * happens. That makes 400 the "allowed" status and 429 the "throttled" one —
 * the two are unambiguous and neither needs a real blinded message.
 */
function requestToken(relayToken) {
  return fetch(`${BASE}/relay/request-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${relayToken}`, 'Content-Type': 'application/json' },
    body: 'not json',
  }).then((r) => r.status);
}

describe('H11 — token issuance budget is bound to the enrollment', () => {
  it("a second enrollment claiming a peer's deviceId cannot spend that peer's budget", async () => {
    const familyId = `fam-h11-${crypto.randomBytes(8).toString('hex')}`;
    const founder = nacl.sign.keyPair();

    // The victim's self-asserted device identity. In the real client this is
    // public within the family — it is the signing key inside every invite.
    const victimDeviceToken = crypto.randomBytes(32).toString('base64');

    const victimRelayToken = await enroll(familyId, founder, victimDeviceToken);
    // Same family, fresh invite nonce, and the attacker simply claims the
    // victim's deviceToken. /enroll never checks it against anything.
    const attackerRelayToken = await enroll(familyId, founder, victimDeviceToken);

    expect(attackerRelayToken).not.toBe(victimRelayToken);

    // Attacker exhausts a full hourly budget on its own enrollment.
    const attackerStatuses = [];
    for (let i = 0; i < TOKEN_RATE_LIMIT; i++) {
      attackerStatuses.push(await requestToken(attackerRelayToken));
    }
    expect(attackerStatuses).toEqual(Array(TOKEN_RATE_LIMIT).fill(400));

    // Positive control: the attacker's own budget IS exhausted, so the limiter
    // is genuinely running at TOKEN_RATE_LIMIT and this test is not vacuous.
    expect(await requestToken(attackerRelayToken)).toBe(429);

    // The victim has spent nothing. Keyed on the enrollment this is its first
    // request of the window; keyed on the shared deviceId string it is the
    // attacker's (TOKEN_RATE_LIMIT + 2)th.
    expect(await requestToken(victimRelayToken)).toBe(400);
  }, 20000);
});
