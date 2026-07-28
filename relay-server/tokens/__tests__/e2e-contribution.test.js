/**
 * End-to-end Blind RSA Contribution Test
 *
 * Exercises the real blind RSA token flow end-to-end:
 *  1. Generate a throwaway RSA keypair using @cloudflare/blindrsa-ts
 *  2. Mint a real token (blind → request-token → finalize)
 *  3. Contribute with it against a pool endpoint (verify → accept)
 *  4. Verify replay protection rejects duplicate use
 *  5. Negative tests: wrong key, malformed tokens, missing auth
 *
 * Self-contained: generates its own keypair, no external dependencies.
 * Uses the REAL @cloudflare/blindrsa-ts library (no mocks).
 *
 * Run via:
 *   NODE_OPTIONS=--experimental-vm-modules npx jest --forceExit relay-server/tokens/__tests__/e2e-contribution.test.js
 *
 * NOTE: @cloudflare/blindrsa-ts is ESM-only, so we use dynamic import().
 */

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { UsedTokensStore } = require('../used-tokens-store');

// ─── Global suite and keypair (generated once for all tests) ─────────────────

let _suite = null;
let _keypair = null;

const TEMP_STORE_FILE = path.join(__dirname, '..', '..', '__test_e2e_used_tokens__.json');

async function ensureKeypair() {
  if (_suite) return;
  const { BlindRSA, Params } = await import('@cloudflare/blindrsa-ts');
  _suite = new BlindRSA(Params.RSABSSA_SHA384_PSS_Randomized);
  _keypair = await _suite.generateKey({
    name: 'RSA-PSS',
    modulusLength: 2048,
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
  });
  // Verify key structure by exporting public key as JWK
  const jwk = await crypto.subtle.exportKey('jwk', _keypair.publicKey);
  if (!jwk || !jwk.n) {
    throw new Error('Failed to export public key as JWK — key generation may have failed');
  }
}

// ─── Token Parsing (mirrors pool-server.js parseToken) ─────────────────────

/**
 * Parse a v2 Blind RSA token.
 * Token format: "v2.<base64(signature(256 bytes) || nonce(32 bytes))>"
 */
function parseToken(tokenStr) {
  if (!tokenStr || typeof tokenStr !== 'string') {
    return { valid: false, error: 'Token is required' };
  }

  const parts = tokenStr.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed token: expected format v2.<base64>' };
  }

  const [version, encoded] = parts;
  if (version !== 'v2') {
    return { valid: false, error: `Unknown token version: ${version}` };
  }

  let tokenBytes;
  try {
    tokenBytes = Buffer.from(encoded, 'base64');
  } catch {
    return { valid: false, error: 'Invalid base64 encoding' };
  }

  // 256 bytes signature + 32 bytes nonce = 288 bytes total
  if (tokenBytes.length !== 288) {
    return {
      valid: false,
      error: `Invalid token length: expected 288 bytes, got ${tokenBytes.length}`,
    };
  }

  const signature = new Uint8Array(tokenBytes.slice(0, 256));
  const nonce = new Uint8Array(tokenBytes.slice(256, 288));

  return { valid: true, signature, nonce, tokenStr };
}

// ─── Test server with issuer + pool endpoints ─────────────────────────────

async function createTestEnv() {
  await ensureKeypair();

  // In-memory enrolled devices (mirrors relay server's authentication)
  const enrolledDevices = new Map();

  // Clean any previous temp store
  try { fs.unlinkSync(TEMP_STORE_FILE); } catch {}

  const usedTokensStore = new UsedTokensStore({
    storeFile: TEMP_STORE_FILE,
    ttlMs: 60000,
    cleanupIntervalMs: 600000,
  });
  await usedTokensStore.loadOnStartup();

  function registerDevice(deviceId) {
    const relayToken = crypto.randomBytes(32).toString('hex');
    enrolledDevices.set(relayToken, {
      deviceId,
      familyId: 'test-family',
      enrolledAt: Date.now(),
      expiresAt: Date.now() + 86_400_000,
    });
    return relayToken;
  }

  // ── Issuer: POST /relay/request-token (mimics relay-server/server.js) ──

  function handleTokenRequest(req, res) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid Authorization header' }));
      return;
    }

    const relayToken = authHeader.slice('Bearer '.length).trim();
    const enrollment = enrolledDevices.get(relayToken);
    if (!enrollment) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid relay token' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      if (body.length > 4096) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }

      let parsed;
      try { parsed = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const { blindedMsg } = parsed;
      if (!blindedMsg || typeof blindedMsg !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'blindedMsg field is required' }));
        return;
      }

      try {
        const blindMsgBytes = Buffer.from(blindedMsg, 'base64');
        const blindSignature = await _suite.blindSign(
          _keypair.privateKey,
          new Uint8Array(blindMsgBytes)
        );
        const blindSigBase64 = Buffer.from(blindSignature).toString('base64');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ blindSignature: blindSigBase64 }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to sign token' }));
      }
    });
  }

  // ── Pool: POST /api/pool/contribute (mimics pool-server.js handleContribute) ──

  function handlePoolContribute(req, res) {
    // Token verification (fail closed)
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Missing or invalid Authorization header. Expected: Bearer <token>',
      }));
      return;
    }

    const tokenStr = authHeader.slice('Bearer '.length).trim();
    const parsed = parseToken(tokenStr);
    if (!parsed.valid) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: parsed.error }));
      return;
    }

    // Verify Blind RSA signature: verify(publicKey, signature, nonce)
    _suite
      .verify(_keypair.publicKey, parsed.signature, parsed.nonce)
      .then((validSig) => {
        if (!validSig) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid token signature' }));
          return;
        }

        // Single-use enforcement (replay protection)
        if (!usedTokensStore.checkAndMark(tokenStr)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Token has already been used' }));
          return;
        }

        // Contribution accepted
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      })
      .catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token verification failed' }));
      });
  }

  // ── Request router ──

  function handleRequest(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/pool/contribute' && req.method === 'POST') {
      handlePoolContribute(req, res);
      return;
    }

    if (url.pathname === '/relay/request-token' && req.method === 'POST') {
      handleTokenRequest(req, res);
      return;
    }

    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  return new Promise((resolve) => {
    const server = http.createServer(handleRequest);
    server.listen(0, () => {
      const port = server.address().port;
      const url = `http://localhost:${port}`;
      resolve({
        server,
        port,
        url,
        registerDevice,
        usedTokensStore,
      });
    });
  });
}

// ─── Helper: mint a token via the issuer (client-side flow) ─────────────────

async function mintToken(issuerUrl, relayToken) {
  // 1. Generate random 32-byte nonce
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);

  // 2. Blind the nonce: { blindedMsg, inv } = blind(publicKey, nonce)
  const { blindedMsg, inv } = await _suite.blind(_keypair.publicKey, nonce);
  const blindedBase64 = Buffer.from(blindedMsg).toString('base64');

  // 3. POST to issuer
  const response = await fetch(`${issuerUrl}/relay/request-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${relayToken}`,
    },
    body: JSON.stringify({ blindedMsg: blindedBase64 }),
  });

  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status}`);
  }

  const data = await response.json();

  // 4. Finalize: produce the final token signature
  const blindSignature = Buffer.from(data.blindSignature, 'base64');
  const finalTokenBytes = await _suite.finalize(
    _keypair.publicKey,
    nonce,
    new Uint8Array(blindSignature),
    inv
  );

  // 5. Construct wire token: "v2.<base64(signature || nonce)>"
  const combined = new Uint8Array(finalTokenBytes.length + 32);
  combined.set(finalTokenBytes, 0);
  combined.set(nonce, finalTokenBytes.length);
  const wireToken = 'v2.' + Buffer.from(combined).toString('base64');

  return { wireToken, nonce };
}

// ─── Helper: contribute with a token ────────────────────────────────────────

async function contribute(poolUrl, wireToken, bodyOverrides = {}) {
  return fetch(`${poolUrl}/api/pool/contribute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${wireToken}`,
    },
    body: JSON.stringify({
      storeId: 'test-store',
      itemName: 'milk',
      price: 4.99,
      flyerWeek: '2026-W22',
      validTo: Date.now() + 86_400_000,
      ...bodyOverrides,
    }),
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('End-to-end Blind RSA Contribution', () => {
  let env;

  beforeAll(async () => {
    env = await createTestEnv();
  }, 60000);

  afterAll(async () => {
    if (env) {
      env.server.close();
      await env.usedTokensStore.shutdown();
    }
    try { fs.unlinkSync(TEMP_STORE_FILE); } catch {}
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Positive test: full token mint + contribution
  // ──────────────────────────────────────────────────────────────────────────

  it('mints a real token and contributes successfully (200)', async () => {
    const relayToken = env.registerDevice('e2e-device-1');

    const { wireToken } = await mintToken(env.url, relayToken);

    // Verify wire token structure
    expect(wireToken).toMatch(/^v2\.[A-Za-z0-9+/=]+$/);
    const decoded = Buffer.from(wireToken.slice(3), 'base64');
    expect(decoded.length).toBe(288); // 256 sig + 32 nonce

    // Contribute with the token
    const response = await contribute(env.url, wireToken);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Replay protection: same token used twice
  // ──────────────────────────────────────────────────────────────────────────

  it('rejects a replayed token (403)', async () => {
    const relayToken = env.registerDevice('e2e-replay-device');

    const { wireToken } = await mintToken(env.url, relayToken);

    // First use — should succeed
    const first = await contribute(env.url, wireToken, {
      storeId: 'store-1',
      itemName: 'eggs',
      price: 3.49,
    });
    expect(first.status).toBe(200);

    // Replay — should be rejected
    const replay = await contribute(env.url, wireToken, {
      storeId: 'store-2',
      itemName: 'bread',
      price: 2.99,
    });
    expect(replay.status).toBe(403);
    const errData = await replay.json();
    expect(errData.error).toMatch(/already been used/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Wrong key: token signed with a different keypair
  // ──────────────────────────────────────────────────────────────────────────

  it('rejects a token signed with a different keypair (403)', async () => {
    // Generate a separate keypair for the "wrong" issuer
    const { BlindRSA, Params } = await import('@cloudflare/blindrsa-ts');
    const wrongSuite = new BlindRSA(Params.RSABSSA_SHA384_PSS_Randomized);
    const wrongKeypair = await wrongSuite.generateKey({
      name: 'RSA-PSS',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    });

    // Client uses the wrong public key to blind
    const nonce = new Uint8Array(32);
    crypto.getRandomValues(nonce);
    const { blindedMsg, inv } = await wrongSuite.blind(wrongKeypair.publicKey, nonce);

    // Sign with the wrong private key (bypass the issuer endpoint)
    const blindSignature = await wrongSuite.blindSign(
      wrongKeypair.privateKey,
      new Uint8Array(blindedMsg)
    );

    // Finalize with the wrong public key
    const finalTokenBytes = await wrongSuite.finalize(
      wrongKeypair.publicKey,
      nonce,
      new Uint8Array(blindSignature),
      inv
    );

    const combined = new Uint8Array(finalTokenBytes.length + 32);
    combined.set(finalTokenBytes, 0);
    combined.set(nonce, finalTokenBytes.length);
    const wrongToken = 'v2.' + Buffer.from(combined).toString('base64');

    // Pool (which uses the REAL keypair) must reject this token
    const response = await contribute(env.url, wrongToken, {
      storeId: 'store-x',
      itemName: 'butter',
      price: 5.99,
    });
    expect(response.status).toBe(403);
    const errData = await response.json();
    expect(errData.error).toMatch(/Invalid token signature/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Malformed: wrong token length
  // ──────────────────────────────────────────────────────────────────────────

  it('rejects a token with wrong byte length (403)', async () => {
    // 32 random bytes (not 288)
    const shortBytes = crypto.randomBytes(32);
    const shortToken = 'v2.' + shortBytes.toString('base64');

    const response = await contribute(env.url, shortToken, {
      storeId: 'store-y',
      itemName: 'cheese',
      price: 7.99,
    });
    expect(response.status).toBe(403);
    const errData = await response.json();
    expect(errData.error).toMatch(/Invalid token length/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Malformed: not base64
  // ──────────────────────────────────────────────────────────────────────────

  it('rejects a non-base64 token (403)', async () => {
    const response = await contribute(env.url, 'v2.!!!not-base64!!!', {
      storeId: 'store-z',
      itemName: 'yogurt',
      price: 1.99,
    });
    expect(response.status).toBe(403);
    const errData = await response.json();
    // Node.js Buffer.from(base64) silently decodes non-base64 chars,
    // producing a short buffer that hits the length check
    expect(errData.error).toMatch(/Invalid token length|Malformed token/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Malformed: unknown version prefix
  // ──────────────────────────────────────────────────────────────────────────

  it('rejects a token with unknown version prefix (403)', async () => {
    const fakeBytes = crypto.randomBytes(288); // correct length but wrong version
    const badVersionToken = 'v1.' + fakeBytes.toString('base64');

    const response = await contribute(env.url, badVersionToken, {
      storeId: 'store-w',
      itemName: 'soda',
      price: 0.99,
    });
    expect(response.status).toBe(403);
    const errData = await response.json();
    expect(errData.error).toMatch(/Unknown token version/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Missing Authorization header
  // ──────────────────────────────────────────────────────────────────────────

  it('rejects a request without Authorization header (401)', async () => {
    const response = await fetch(`${env.url}/api/pool/contribute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: 'test-store',
        itemName: 'water',
        price: 0.50,
        flyerWeek: '2026-W22',
        validTo: Date.now() + 86_400_000,
      }),
    });
    expect(response.status).toBe(401);
    const errData = await response.json();
    expect(errData.error).toMatch(/Missing or invalid Authorization/i);
  });
});
