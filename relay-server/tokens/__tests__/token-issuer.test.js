/**
 * Token Issuer (Blind RSA) — Tests
 *
 * Tests for the authenticated POST /relay/request-token endpoint
 * and GET /relay/public-key, plus UsedTokensStore persistence.
 *
 * These tests validate the new RFC 9474 Blind RSA token system.
 *
 * NOTE: @cloudflare/blindrsa-ts is ESM-only, so we use dynamic import()
 * instead of require() for that module.
 */

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { UsedTokensStore } = require('../used-tokens-store');

const TEST_PUBLIC_KEY_PATH = path.join(__dirname, '..', '..', 'keys', 'issuer-public-key.pem');
const TEST_PRIVATE_KEY_PATH = path.join(__dirname, '..', '..', 'keys', 'issuer-private-key.pem');

// ─── Global suite and keys (lazy-loaded once) ───────────────────────────────

let testSuite = null;
let testPublicKey = null;
let testPrivateKey = null;

async function ensureTestCrypto() {
  if (testSuite) return;

  const { BlindRSA, Params } = await import('@cloudflare/blindrsa-ts');
  testSuite = new BlindRSA(Params.RSABSSA_SHA384_PSS_Randomized);

  const privatePem = fs.readFileSync(TEST_PRIVATE_KEY_PATH, 'utf-8');
  const privBase64 = privatePem
    .replace(/-----BEGIN [\w ]+-----/g, '')
    .replace(/-----END [\w ]+-----/g, '')
    .replace(/\s/g, '');
  const privBinary = Buffer.from(privBase64, 'base64');
  const privBytes = new Uint8Array(privBinary);
  testPrivateKey = await crypto.subtle.importKey(
    'pkcs8',
    privBytes.buffer,
    { name: 'RSA-PSS', hash: 'SHA-384' },
    true,
    ['sign']
  );

  const publicPem = fs.readFileSync(TEST_PUBLIC_KEY_PATH, 'utf-8');
  const pubBase64 = publicPem
    .replace(/-----BEGIN [\w ]+-----/g, '')
    .replace(/-----END [\w ]+-----/g, '')
    .replace(/\s/g, '');
  const pubBinary = Buffer.from(pubBase64, 'base64');
  const pubBytes = new Uint8Array(pubBinary);
  testPublicKey = await crypto.subtle.importKey(
    'spki',
    pubBytes.buffer,
    { name: 'RSA-PSS', hash: 'SHA-384' },
    true,
    ['verify']
  );
}

// ─── Helper: create a test issuer server ────────────────────────────────────

async function createTestIssuerServer() {
  await ensureTestCrypto();

  // In-memory enrolled devices for testing
  const enrolledDevices = new Map();

  // Token rate limiters
  const tokenRateLimiters = new Map();
  const TOKEN_RATE_LIMIT = 10;
  const TOKEN_RATE_WINDOW_MS = 3_600_000; // 1 hour

  function checkTokenRateLimit(deviceId) {
    const now = Date.now();
    let limiter = tokenRateLimiters.get(deviceId);
    if (!limiter || now - limiter.windowStart > TOKEN_RATE_WINDOW_MS) {
      limiter = { count: 1, windowStart: now };
      tokenRateLimiters.set(deviceId, limiter);
      return true;
    }
    limiter.count++;
    if (limiter.count > TOKEN_RATE_LIMIT) return false;
    return true;
  }

  // Register a test device
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

  function handleRequest(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /relay/public-key
    if (req.url === '/relay/public-key' && req.method === 'GET') {
      const pem = fs.readFileSync(TEST_PUBLIC_KEY_PATH, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(pem);
      return;
    }

    // POST /relay/request-token
    if (req.url === '/relay/request-token' && req.method === 'POST') {
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

      if (!checkTokenRateLimit(enrollment.deviceId)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token rate limit exceeded' }));
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
        try { parsed = JSON.parse(body); }
        catch {
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
          const blindSignature = await testSuite.blindSign(testPrivateKey, new Uint8Array(blindMsgBytes));
          const blindSigBase64 = Buffer.from(blindSignature).toString('base64');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ blindSignature: blindSigBase64 }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to sign token' }));
        }
      });
      return;
    }

    // GET /health
    if (req.url === '/health' && req.method === 'GET') {
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
      resolve({ server, port, url, registerDevice });
    });
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Blind RSA Token Issuer', () => {
  let testEnv;

  beforeAll(async () => {
    testEnv = await createTestIssuerServer();
  }, 15000);

  afterAll(() => {
    if (testEnv) testEnv.server.close();
  });

  describe('GET /relay/public-key', () => {
    it('returns the issuer public key in PEM format', async () => {
      const { url } = testEnv;
      const response = await fetch(`${url}/relay/public-key`);
      expect(response.status).toBe(200);
      const pem = await response.text();
      expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
      expect(pem).toContain('-----END PUBLIC KEY-----');
    });
  });

  describe('POST /relay/request-token', () => {
    it('returns blindSignature for authenticated request', async () => {
      const { url, registerDevice } = testEnv;
      const deviceId = 'test-device-1';
      const relayToken = registerDevice(deviceId);

      // Client-side: generate nonce and blind
      const nonce = new Uint8Array(32);
      crypto.getRandomValues(nonce);
      const { blindedMsg, inv } = await testSuite.blind(testPublicKey, nonce);
      const blindedBase64 = Buffer.from(blindedMsg).toString('base64');

      const response = await fetch(`${url}/relay/request-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${relayToken}`,
        },
        body: JSON.stringify({ blindedMsg: blindedBase64 }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('blindSignature');
      expect(typeof data.blindSignature).toBe('string');

      // Verify the blind signature finalizes correctly
      const blindSignature = Buffer.from(data.blindSignature, 'base64');
      const finalToken = await testSuite.finalize(testPublicKey, nonce, blindSignature, inv);
      expect(finalToken.length).toBe(256); // 2048-bit RSA signature = 256 bytes
    });

    it('returns 401 without Authorization header', async () => {
      const { url } = testEnv;

      const response = await fetch(`${url}/relay/request-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blindedMsg: 'dGVzdA==' }),
      });

      expect(response.status).toBe(401);
    });

    it('returns 403 with invalid relay token', async () => {
      const { url } = testEnv;

      const response = await fetch(`${url}/relay/request-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token',
        },
        body: JSON.stringify({ blindedMsg: 'dGVzdA==' }),
      });

      expect(response.status).toBe(403);
    });

    it('returns 400 for missing blindedMsg field', async () => {
      const { url, registerDevice } = testEnv;
      const relayToken = registerDevice('test-device-2');

      const response = await fetch(`${url}/relay/request-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${relayToken}`,
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('blindedMsg');
    });

    it('returns 400 for invalid JSON', async () => {
      const { url, registerDevice } = testEnv;
      const relayToken = registerDevice('test-device-3');

      const response = await fetch(`${url}/relay/request-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${relayToken}`,
        },
        body: 'not-json',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('UsedTokensStore', () => {
    it('persists and reloads tokens', async () => {
      const tmpFile = path.join(__dirname, '..', '..', '__test_used_tokens__.json');
      try { fs.unlinkSync(tmpFile); } catch {}

      const store = new UsedTokensStore({
        storeFile: tmpFile,
        ttlMs: 60000,
        cleanupIntervalMs: 600000,
      });

      await store.loadOnStartup();

      // First use - should succeed
      expect(store.checkAndMark('token-1')).toBe(true);
      expect(store.checkAndMark('token-2')).toBe(true);
      expect(store.checkAndMark('token-1')).toBe(false); // Replay

      // Shutdown to flush writes before creating new store
      await store.shutdown();

      // Create a new store instance and load from disk
      const store2 = new UsedTokensStore({
        storeFile: tmpFile,
        ttlMs: 60000,
        cleanupIntervalMs: 600000,
      });
      await store2.loadOnStartup();

      // Should persist the used tokens
      expect(store2.checkAndMark('token-1')).toBe(false);
      expect(store2.checkAndMark('token-2')).toBe(false);
      expect(store2.checkAndMark('token-3')).toBe(true);

      await store2.shutdown();
      try { fs.unlinkSync(tmpFile); } catch {}
    });

    it('returns correct size', async () => {
      const tmpFile = path.join(__dirname, '..', '..', '__test_size__.json');
      try { fs.unlinkSync(tmpFile); } catch {}

      const store = new UsedTokensStore({
        storeFile: tmpFile,
        ttlMs: 60000,
        cleanupIntervalMs: 600000,
      });
      await store.loadOnStartup();

      expect(store.size()).toBe(0);
      store.checkAndMark('a');
      expect(store.size()).toBe(1);
      store.checkAndMark('b');
      expect(store.size()).toBe(2);

      await store.shutdown();
      try { fs.unlinkSync(tmpFile); } catch {}
    });

    it('cleanExpired is a no-op — tokens are permanent (double-spend closure)', async () => {
      const tmpFile = path.join(__dirname, '..', '..', '__test_cleanup__.json');
      try { fs.unlinkSync(tmpFile); } catch {}

      const store = new UsedTokensStore({
        storeFile: tmpFile,
        ttlMs: 1, // previously this would have expired — now it must NOT
        cleanupIntervalMs: 600000,
      });
      await store.loadOnStartup();

      store.checkAndMark('expired-token');
      expect(store.isUsed('expired-token')).toBe(true);

      // Wait longer than the declared TTL
      await new Promise((r) => setTimeout(r, 10));

      // cleanExpired is now a deliberate no-op: spent means spent forever.
      const cleaned = store.cleanExpired();
      expect(cleaned).toBe(0);
      // Token MUST still be marked as used — double-spend window closed.
      expect(store.isUsed('expired-token')).toBe(true);

      await store.shutdown();
      try { fs.unlinkSync(tmpFile); } catch {}
    });
  });
});
