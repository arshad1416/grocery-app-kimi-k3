/**
 * GroceryApp Relay Server — v2 with Identity + Rate Limiting
 *
 * Enhanced relay server with:
 *  - Device enrollment endpoint (POST /enroll)
 *  - Family invite signature verification
 *  - Rate limiting per device token (max 100 messages/min)
 *  - WebSocket authentication via relayToken
 *  - Configurable ports via environment variables
 *
 * Design:
 *  - REST endpoints: /health, /enroll, /stats
 *  - WebSocket endpoint: /ws with relayToken auth
 *  - Rate limiting uses in-memory counters with 1-minute windows
 *  - Invite verification validates Ed25519 signatures
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── Blind RSA Token Issuer ──────────────────────────────────────────────────

const { UsedTokensStore } = require('./tokens/used-tokens-store');

/**
 * Lazy-loaded BlindRSA suite instance and issuer private key.
 * Loaded asynchronously on first request to /relay/request-token.
 */
let _blindRsaSuite = null;
let _issuerPrivateKey = null;

const ISSUER_PRIVATE_KEY_PATH =
  process.env.ISSUER_PRIVATE_KEY_PATH || path.join(__dirname, 'keys', 'issuer-private-key.pem');
const ISSUER_PRIVATE_KEY_PEM = process.env.ISSUER_PRIVATE_KEY || null;

/** Per-device token rate limit: N tokens per hour */
const TOKEN_RATE_LIMIT = parseInt(process.env.TOKEN_RATE_LIMIT || '10', 10);
const TOKEN_RATE_WINDOW_MS = 3_600_000; // 1 hour

/**
 * Per-device token issuance rate limiters.
 * Map<deviceId, { count: number, windowStart: number }>
 *
 * NOTE: In-memory only — resets on restart. This is intentional:
 * - The used-tokens store (checkAndMark) prevents replay of issued tokens.
 * - Restart is a deliberate admin action.
 * - Persistence would add complexity for marginal security gain.
 * See UsedTokensStore for the persisted counterpart.
 */
const tokenRateLimiters = new Map();

/**
 * Used tokens store for single-use enforcement at the pool level.
 * Shared with pool-server via handlePoolRequest pass-through.
 */
const usedTokensStore = new UsedTokensStore();

/**
 * Parse a PEM-encoded key to DER bytes (ArrayBuffer).
 * Strips header/footer lines and base64-decodes.
 * @param {string} pem
 * @returns {ArrayBuffer}
 */
function pemToDer(pem) {
  const base64 = pem
    .replace(/-----BEGIN [\w ]+-----/g, '')
    .replace(/-----END [\w ]+-----/g, '')
    .replace(/\s/g, '');
  const binary = Buffer.from(base64, 'base64');
  const bytes = new Uint8Array(binary);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Load (or reload) the BlindRSA suite and issuer private key.
 */
async function ensureIssuerLoaded() {
  if (_blindRsaSuite && _issuerPrivateKey) return;

  const { BlindRSA, Params } = await import('@cloudflare/blindrsa-ts');

  // Create the suite using RSABSSA-SHA384-PSS-Randomized (RFC 9474 standard)
  const suite = new BlindRSA(Params.RSABSSA_SHA384_PSS_Randomized);

  // Load private key PEM
  let pemData = ISSUER_PRIVATE_KEY_PEM;
  if (!pemData) {
    pemData = fs.readFileSync(ISSUER_PRIVATE_KEY_PATH, 'utf-8');
  }

  // Parse PEM to DER (raw binary)
  const derBytes = pemToDer(pemData);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    derBytes,
    { name: 'RSA-PSS', hash: 'SHA-384' },
    true,
    ['sign']
  );

  _blindRsaSuite = suite;
  _issuerPrivateKey = privateKey;
}

/**
 * Check per-device token issuance rate limit.
 * @param {string} deviceId
 * @returns {boolean} true if allowed
 */
function checkTokenRateLimit(deviceId) {
  const now = Date.now();
  let limiter = tokenRateLimiters.get(deviceId);

  if (!limiter || now - limiter.windowStart > TOKEN_RATE_WINDOW_MS) {
    limiter = { count: 1, windowStart: now };
    tokenRateLimiters.set(deviceId, limiter);
    return true;
  }

  limiter.count++;
  if (limiter.count > TOKEN_RATE_LIMIT) {
    return false;
  }

  return true;
}

/**
 * Clean expired token rate limiters.
 */
function cleanTokenRateLimiters() {
  const now = Date.now();
  for (const [deviceId, limiter] of tokenRateLimiters) {
    if (now - limiter.windowStart > TOKEN_RATE_WINDOW_MS * 2) {
      tokenRateLimiters.delete(deviceId);
    }
  }
}

// ─── Configuration ───────────────────────────────────────────────────────────

const RELAY_PORT = parseInt(process.env.RELAY_PORT || process.env.PORT || '8080', 10);
const POOL_PORT = parseInt(process.env.POOL_PORT || RELAY_PORT.toString(), 10);
const API_PORT = parseInt(process.env.API_PORT || process.env.PORT || '8080', 10);
const WS_PORT = parseInt(process.env.WS_PORT || process.env.PORT || '8080', 10);
const MAX_CLIENTS_PER_FAMILY = parseInt(process.env.MAX_CLIENTS_PER_FAMILY || '50', 10);
const MAX_FAMILIES = parseInt(process.env.MAX_FAMILIES || '100', 10);
const MAX_DEVICES_PER_FAMILY = parseInt(process.env.MAX_DEVICES_PER_FAMILY || '20', 10);
const RATE_LIMIT_MESSAGES = parseInt(process.env.RATE_LIMIT_MESSAGES || '100', 10);
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const TOKEN_TTL_MS = parseInt(process.env.TOKEN_TTL_MS || '2592000000', 10); // 30 days default

// ─── TLS ─────────────────────────────────────────────────────────────────────

const TLS_CERT_PATH = process.env.TLS_CERT;
const TLS_KEY_PATH = process.env.TLS_KEY;

// ─── State Persistence ──────────────────────────────────────────────────────────

/** File path for persisting relay state across restarts. */
const STATE_FILE = process.env.RELAY_STATE_FILE || './relay-state.json';

// ─── Voice Assistant OAuth2 & Keys ──────────────────────────────────────────────

/**
 * Cloud voice-assistant integration (Alexa / Google Assistant) is DISABLED by
 * default (opt in with ASSISTANT_INTEGRATION=true). Siri is unaffected
 * (fully on-device).
 *
 * KEY CUSTODY (the fix for the earlier zero-knowledge break):
 *   The relay holds ONLY the assistant RSA *public* key — never the private
 *   key. Clients seal the family key to that public key; only the deployed
 *   assistant webhook (Cloud Function / Lambda), which holds the private key
 *   in its own environment (ASSISTANT_PRIVATE_KEY), can decrypt it, and only
 *   transiently while answering a voice request.
 *
 *   The relay stores all ciphertext plus the sealed family-key blob, but with
 *   no private key it is cryptographically unable to read any of it. Generate
 *   the keypair out of band with `node assistant-keygen.js` and provision the
 *   public half here (ASSISTANT_PUBLIC_KEY or keys/assistant-public-key.pem),
 *   the private half to the webhook ONLY. Endpoints fail closed if the public
 *   key is not provisioned.
 */
const ASSISTANT_INTEGRATION = process.env.ASSISTANT_INTEGRATION === 'true';

const ASSISTANT_PUBLIC_KEY_PATH =
  process.env.ASSISTANT_PUBLIC_KEY_PATH || path.join(__dirname, 'keys', 'assistant-public-key.pem');

let assistantPublicKeyPem = null;

/**
 * Load the voice-assistant RSA PUBLIC key (SPKI PEM). The relay NEVER holds or
 * generates the private key. Returns the PEM string, or null if not
 * provisioned (callers must fail closed).
 */
function getAssistantPublicKey() {
  if (assistantPublicKeyPem) return assistantPublicKeyPem;
  if (process.env.ASSISTANT_PUBLIC_KEY) {
    assistantPublicKeyPem = process.env.ASSISTANT_PUBLIC_KEY;
    return assistantPublicKeyPem;
  }
  try {
    if (fs.existsSync(ASSISTANT_PUBLIC_KEY_PATH)) {
      assistantPublicKeyPem = fs.readFileSync(ASSISTANT_PUBLIC_KEY_PATH, 'utf-8');
      return assistantPublicKeyPem;
    }
  } catch (err) {
    console.error('[assistant-keys] Failed to read public key:', err.message);
  }
  return null;
}

/**
 * Map<accessToken, { familyId: string, encryptedMasterKey: string, expiresAt: number }>
 */
const oauthTokens = new Map();

/**
 * Map<pairingCode, { sessionId: string, redirectUri: string, state: string, scope: string, linked: boolean, familyId: string, encryptedMasterKey: string, authCode: string, createdAt: number }>
 */
const oauthSessions = new Map();

function generatePairingCodeString() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += Math.floor(Math.random() * 10);
  }
  return code;
}


// ─── Pool Server ────────────────────────────────────────────────────────────────

const { PoolStore } = require('./pool/store');
const { handlePoolRequest, setUsedTokensStore } = require('./pool/pool-server');
const { seedTestData } = require('./seed-pool');
const poolStore = new PoolStore();
// Seed test data on startup
seedTestData(poolStore);
// Wire the used-tokens store into the pool server
setUsedTokensStore(usedTokensStore);

/**
 * Serialize relay state to a plain object (JSON-compatible).
 */
function serializeState() {
  const enrolled = {};
  for (const [token, enrollment] of enrolledDevices) {
    enrolled[token] = enrollment;
  }

  const families = {};
  for (const [familyId, tokens] of familyDeviceTokens) {
    families[familyId] = Array.from(tokens);
  }

  const tokens = {};
  for (const [token, data] of oauthTokens) {
    tokens[token] = data;
  }

  return {
    enrolledDevices: enrolled,
    familyDeviceTokens: families,
    usedInviteSignatures: Array.from(usedInviteSignatures),
    oauthTokens: tokens,
  };
}

/**
 * Deserialize and restore relay state from a plain object.
 */
function deserializeState(saved) {
  if (!saved) return;

  if (saved.enrolledDevices) {
    for (const [token, enrollment] of Object.entries(saved.enrolledDevices)) {
      // Only load non-expired tokens
      if (Date.now() <= enrollment.expiresAt) {
        enrolledDevices.set(token, enrollment);
        // Rebuild family device tracking
        if (!familyDeviceTokens.has(enrollment.familyId)) {
          familyDeviceTokens.set(enrollment.familyId, new Set());
        }
        familyDeviceTokens.get(enrollment.familyId).add(token);
      }
    }
  }

  if (saved.usedInviteSignatures) {
    for (const sig of saved.usedInviteSignatures) {
      usedInviteSignatures.add(sig);
    }
  }

  if (saved.oauthTokens) {
    for (const [token, data] of Object.entries(saved.oauthTokens)) {
      if (Date.now() <= data.expiresAt) {
        oauthTokens.set(token, data);
      }
    }
  }
}

let _saveTimeout = null;

/**
 * Debounced save of relay state to disk.
 * Writes at most once per 500ms to avoid hammering the filesystem.
 */
function persistState() {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    try {
      const data = serializeState();
      fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[persist] Failed to save state: ${err.message}`);
    }
  }, 500);
}

/**
 * Load relay state from disk on startup.
 */
function loadStateFromDisk() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const saved = JSON.parse(raw);
      deserializeState(saved);
      console.log(`[persist] Loaded state: ${enrolledDevices.size} enrollments, ${usedInviteSignatures.size} used invites`);
    }
  } catch (err) {
    console.warn(`[persist] Failed to load state: ${err.message}. Starting fresh.`);
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

/**
 * Map<familyId, Set<WebSocket>>
 */
const familyRooms = new Map();

/**
 * Map<WebSocket, { familyId: string, deviceId: string, relayToken: string }>
 */
const clientInfo = new Map();

/**
 * Map<deviceId, WebSocket>
 */
const deviceSockets = new Map();

/**
 * Map<relayToken, { deviceId: string, familyId: string, enrolledAt: number }>
 * Enrolled devices that have completed POST /enroll.
 */
const enrolledDevices = new Map();

/**
 * Map<relayToken, { count: number, windowStart: number }>
 * Rate limiting counters keyed by relay token.
 */
const rateLimiters = new Map();

/**
 * Map<familyId, Set<string>> — relay tokens per family for enforcement.
 */
const familyDeviceTokens = new Map();

/**
 * Set<string> — used invite tokens (signature-based replay protection).
 * Prevents a leaked invite token from being replayed multiple times.
 * Entries are never evicted; invites have a finite TTL so memory is bounded.
 */
const usedInviteSignatures = new Set();

// ─── Ed25519 Signature Verification ──────────────────────────────────────────

/**
 * Verify an Ed25519 signature using tweetnacl (pure JS, zero native deps).
 *
 * tweetnacl takes raw 32-byte Ed25519 public keys (no DER/SPKI wrapping),
 * matching libsodium's crypto_sign_verify_detached format used by the client.
 *
 * @param {string} message - The original message that was signed.
 * @param {string} signature - Base64-encoded signature.
 * @param {string} publicKey - Base64-encoded Ed25519 public key (raw 32 bytes).
 * @returns {boolean} Whether the signature is valid.
 */
function verifyEd25519Signature(message, signature, publicKey) {
  try {
    const nacl = require('tweetnacl');
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = Buffer.from(signature, 'base64');
    const keyBytes = Buffer.from(publicKey, 'base64');
    return nacl.sign.detached.verify(msgBytes, sigBytes, keyBytes);
  } catch (err) {
    console.warn(`[crypto] Signature verification error: ${err.message}`);
    return false;
  }
}

// ─── Shared Cleanup ──────────────────────────────────────────────────────────

/**
 * Remove a client from all internal state.
 */
function removeClient(ws) {
  if (ws._pingInterval) {
    clearInterval(ws._pingInterval);
    ws._pingInterval = null;
  }

  const info = clientInfo.get(ws);
  if (info) {
    const room = familyRooms.get(info.familyId);
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        familyRooms.delete(info.familyId);
      }
    }

    const currentSocket = deviceSockets.get(info.deviceId);
    if (currentSocket === ws) {
      deviceSockets.delete(info.deviceId);
    }

    clientInfo.delete(ws);
  }
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

/**
 * Check if a relay token has exceeded the rate limit.
 * Returns true if the message should be allowed, false if rate limited.
 */
function checkRateLimit(relayToken) {
  const now = Date.now();
  let limiter = rateLimiters.get(relayToken);

  if (!limiter || now - limiter.windowStart > RATE_LIMIT_WINDOW_MS) {
    // Start a new window
    limiter = { count: 1, windowStart: now };
    rateLimiters.set(relayToken, limiter);
    return true;
  }

  limiter.count++;
  if (limiter.count > RATE_LIMIT_MESSAGES) {
    return false; // Rate limited
  }

  return true;
}

/**
 * Reset rate limiters periodically to prevent memory leaks.
 */
function cleanRateLimiters() {
  const now = Date.now();
  for (const [token, limiter] of rateLimiters) {
    if (now - limiter.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimiters.delete(token);
    }
  }
}

// Clean rate limiters every 5 minutes
setInterval(cleanRateLimiters, 5 * 60_000);

// ─── HTTP Server ─────────────────────────────────────────────────────────────

// ─── HTTP / HTTPS Server ──────────────────────────────────────────────────────
// If TLS_CERT and TLS_KEY env vars are set, create HTTPS server.
// Otherwise, create plain HTTP (expected to run behind reverse proxy for TLS).

const https = require('https');

function createServer(requestListener) {
  if (TLS_CERT_PATH && TLS_KEY_PATH) {
    try {
      const tlsOptions = {
        cert: fs.readFileSync(TLS_CERT_PATH),
        key: fs.readFileSync(TLS_KEY_PATH),
      };
      console.log('[tls] Using TLS certificates — server will use HTTPS/WSS');
      return https.createServer(tlsOptions, requestListener);
    } catch (err) {
      console.warn(`[tls] Failed to load TLS certs: ${err.message}. Falling back to HTTP.`);
    }
  }
  return http.createServer(requestListener);
}

const server = createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      families: familyRooms.size,
      clients: clientInfo.size,
      enrolledDevices: enrolledDevices.size,
      version: '2.0',
    }));
    return;
  }

  // GET /relay/public-key — unauthenticated, returns issuer's public key PEM
  if (req.url === '/relay/public-key' && req.method === 'GET') {
    try {
      const publicKeyPath = process.env.ISSUER_PUBLIC_KEY_PATH ||
        path.join(__dirname, 'keys', 'issuer-public-key.pem');
      const publicKeyPem = process.env.ISSUER_PUBLIC_KEY ||
        fs.readFileSync(publicKeyPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(publicKeyPem);
    } catch (err) {
      console.warn('[public-key] Failed to load public key:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Issuer public key not configured' }));
    }
    return;
  }

  // POST /relay/request-token — authenticated, requires relayToken
  if (req.url === '/relay/request-token' && req.method === 'POST') {
    handleTokenRequest(req, res);
    return;
  }

  // Device enrollment
  if (req.url === '/enroll' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      // Enforce body size limit
      if (body.length > 4096) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large (max 4096 bytes)' }));
        return;
      }

      try {
        const data = JSON.parse(body);
        const { deviceToken, familyInviteToken } = data;

        if (!deviceToken || !familyInviteToken) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'deviceToken and familyInviteToken are required',
          }));
          return;
        }

        // Parse the family invite token
        let invite;
        try {
          invite = JSON.parse(familyInviteToken);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid familyInviteToken format' }));
          return;
        }

        const { familyId, deviceId: inviterDeviceId, expiresAt, nonce, signature } = invite;

        if (!familyId || !inviterDeviceId || !expiresAt || !signature) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid invite token structure' }));
          return;
        }

        // Check expiry
        if (Date.now() > expiresAt) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invite token has expired' }));
          return;
        }

        // Verify invite signature using Ed25519.
        // The payload must match the client's serializeTokenPayload exactly,
        // including the nonce field (added for one-time-use enforcement).
        const invitePayload = JSON.stringify({
          familyId,
          deviceId: inviterDeviceId,
          expiresAt,
          ...(nonce !== undefined ? { nonce } : {}),
        });

        const signatureValid = verifyEd25519Signature(
          invitePayload,
          signature,
          inviterDeviceId,
        );

        if (!signatureValid) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid invite signature' }));
          return;
        }

        // Replay protection: reject invite tokens that have already been used.
        // Since invites have finite TTL and signatures are unique per invite,
        // tracking by the full familyInviteToken string is precise.
        if (usedInviteSignatures.has(familyInviteToken)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invite token has already been used' }));
          return;
        }

        // Check family limits
        const totalFamilies = familyRooms.size;
        if (totalFamilies >= MAX_FAMILIES) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Server at maximum family capacity' }));
          return;
        }

        // Check devices per family limit
        const familyTokens = familyDeviceTokens.get(familyId);
        if (familyTokens && familyTokens.size >= MAX_DEVICES_PER_FAMILY) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Family at maximum device capacity' }));
          return;
        }

        // Mark invite as used (replay protection)
        usedInviteSignatures.add(familyInviteToken);

        // Generate a relay token (opaque routing token)
        const relayToken = crypto.randomBytes(32).toString('hex');

        // Store enrollment with TTL
        const now = Date.now();
        enrolledDevices.set(relayToken, {
          deviceId: deviceToken,
          familyId,
          enrolledAt: now,
          expiresAt: now + TOKEN_TTL_MS,
        });

        // Track family device count
        if (!familyDeviceTokens.has(familyId)) {
          familyDeviceTokens.set(familyId, new Set());
        }
        familyDeviceTokens.get(familyId).add(relayToken);

        persistState();

        console.log(`[enroll] Device "${deviceToken.slice(0, 12)}..." enrolled in family "${familyId}"`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          relayToken,
          familyId,
        }));
      } catch (err) {
        console.warn(`[enroll] Error: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Stats page
  if (req.url === '/stats' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });

    const stats = {};
    familyRooms.forEach((clients, familyId) => {
      stats[familyId] = {
        connectedClients: clients.size,
        deviceIds: Array.from(clients).map((ws) => {
          const info = clientInfo.get(ws);
          return info ? info.deviceId.slice(0, 12) + '...' : 'unknown';
        }),
      };
    });

    res.end(JSON.stringify({
      uptime: process.uptime(),
      totalFamilies: familyRooms.size,
      totalClients: clientInfo.size,
      totalEnrolled: enrolledDevices.size,
      families: stats,
      rateLimiters: rateLimiters.size,
      config: {
        maxFamilies: MAX_FAMILIES,
        maxDevicesPerFamily: MAX_DEVICES_PER_FAMILY,
        maxClientsPerFamily: MAX_CLIENTS_PER_FAMILY,
        rateLimitMessagesPerMin: RATE_LIMIT_MESSAGES,
        tokenTtlDays: Math.round(TOKEN_TTL_MS / 86400000),
      },
    }));
    return;
  }

  // Pool endpoints (unauthenticated, identity-free) — only when sharing port
  if (POOL_PORT === RELAY_PORT && req.url.startsWith('/api/pool/')) {
    return handlePoolRequest(req, res, poolStore);
  }

  // POST /api/extract/flyer — authenticated flyer price extraction
  if (req.url === '/api/extract/flyer' && req.method === 'POST') {
    const { handleExtractRequest } = require('./extract/extract-server');
    return handleExtractRequest(req, res, enrolledDevices);
  }

  // Voice-assistant + OAuth account-linking endpoints (see ASSISTANT_INTEGRATION
  // above for why these are off by default).
  if (
    !ASSISTANT_INTEGRATION &&
    (req.url.startsWith('/api/assistant/') ||
      req.url.startsWith('/oauth/') ||
      req.url.startsWith('/api/oauth/'))
  ) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Voice assistant integration is disabled on this relay' }));
    return;
  }

  // GET /api/assistant/public-key — returns the voice-assistant PUBLIC key.
  // Fails closed if no public key has been provisioned (the relay never
  // generates one — see assistant-keygen.js).
  if (req.url === '/api/assistant/public-key' && req.method === 'GET') {
    const pubKey = getAssistantPublicKey();
    if (!pubKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Voice assistant public key not provisioned. Generate a keypair with assistant-keygen.js and set ASSISTANT_PUBLIC_KEY; the private key goes to the webhook only.',
      }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(pubKey);
    return;
  }

  // GET /oauth/authorize — account linking HTML page showing pairing code
  if (req.url.startsWith('/oauth/authorize') && req.method === 'GET') {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const redirectUri = reqUrl.searchParams.get('redirect_uri');
    const state = reqUrl.searchParams.get('state');
    const scope = reqUrl.searchParams.get('scope') || '';
    const clientId = reqUrl.searchParams.get('client_id') || '';

    if (!redirectUri || !state) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing redirect_uri or state parameters');
      return;
    }

    const pairingCode = generatePairingCodeString();
    oauthSessions.set(pairingCode, {
      redirectUri,
      state,
      scope,
      clientId,
      linked: false,
      familyId: null,
      encryptedMasterKey: null,
      authCode: null,
      createdAt: Date.now()
    });

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getAuthorizeHtml(pairingCode));
    return;
  }

  // GET /oauth/status — poll endpoint for pairing screen
  if (req.url.startsWith('/oauth/status') && req.method === 'GET') {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const pairingCode = reqUrl.searchParams.get('pairingCode');
    if (!pairingCode) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing pairingCode' }));
      return;
    }

    const session = oauthSessions.get(pairingCode);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found or expired' }));
      return;
    }

    if (session.linked) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        linked: true,
        redirectUri: `${session.redirectUri}${session.redirectUri.includes('?') ? '&' : '?'}code=${session.authCode}&state=${session.state}`
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ linked: false }));
    return;
  }

  // POST /api/oauth/pair — pairing submission from mobile app
  if (req.url === '/api/oauth/pair' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { pairingCode, familyId, encryptedMasterKey } = JSON.parse(body);
        if (!pairingCode || !familyId || !encryptedMasterKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'pairingCode, familyId, and encryptedMasterKey are required' }));
          return;
        }

        const session = oauthSessions.get(pairingCode);
        if (!session) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or expired pairing code' }));
          return;
        }

        const authCode = crypto.randomBytes(16).toString('hex');
        session.linked = true;
        session.familyId = familyId;
        session.encryptedMasterKey = encryptedMasterKey;
        session.authCode = authCode;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // POST /oauth/token — oauth2 token exchange
  if (req.url === '/oauth/token' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        let params;
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/x-www-form-urlencoded')) {
          params = new URLSearchParams(body);
        } else {
          const parsed = JSON.parse(body);
          params = {
            get(key) { return parsed[key]; }
          };
        }

        const grantType = params.get('grant_type');
        const code = params.get('code');

        if (grantType !== 'authorization_code' || !code) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unsupported grant_type or missing authorization code' }));
          return;
        }

        let foundCode = null;
        let foundSession = null;
        for (const [pCode, session] of oauthSessions.entries()) {
          if (session.authCode === code) {
            foundCode = pCode;
            foundSession = session;
            break;
          }
        }

        if (!foundSession) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or expired authorization code' }));
          return;
        }

        const accessToken = crypto.randomBytes(32).toString('hex');
        oauthTokens.set(accessToken, {
          familyId: foundSession.familyId,
          encryptedMasterKey: foundSession.encryptedMasterKey,
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 // 1 year
        });

        oauthSessions.delete(foundCode);
        persistState();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 31536000
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to exchange token: ' + err.message }));
      }
    });
    return;
  }

  // GET /api/assistant/list-data — fetches encrypted key and all Yjs updates
  if (req.url === '/api/assistant/list-data' && req.method === 'GET') {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized. Missing Bearer token' }));
      return;
    }

    const accessToken = authHeader.slice('Bearer '.length).trim();
    const tokenData = oauthTokens.get(accessToken);

    if (!tokenData || Date.now() > tokenData.expiresAt) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or expired access token' }));
      return;
    }

    const { familyId, encryptedMasterKey } = tokenData;
    const { getAllUpdates } = require('./encrypted-store');
    const updates = getAllUpdates(familyId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      encryptedMasterKey,
      updates
    }));
    return;
  }

  // POST /api/assistant/submit-update — appends Yjs update and relays to WebSocket
  if (req.url === '/api/assistant/submit-update' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized. Missing Bearer token' }));
      return;
    }

    const accessToken = authHeader.slice('Bearer '.length).trim();
    const tokenData = oauthTokens.get(accessToken);

    if (!tokenData || Date.now() > tokenData.expiresAt) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or expired access token' }));
      return;
    }

    const { familyId } = tokenData;

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { listId, payload } = JSON.parse(body);
        if (!listId || !payload) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'listId and payload are required' }));
          return;
        }

        const { addUpdate } = require('./encrypted-store');
        addUpdate(familyId, listId, payload);

        // Broadcast to online family room clients
        const room = familyRooms.get(familyId);
        let relayed = 0;
        if (room) {
          room.forEach((client) => {
            if (client.readyState === client.OPEN) {
              sendTo(client, {
                type: 'update',
                familyId,
                deviceId: 'assistant-cloud',
                listId,
                payload,
              });
              relayed++;
            }
          });
        }

        console.log(`[assistant-update] Update persisted for family "${familyId}" list "${listId}". Relayed to ${relayed} clients.`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to process update: ' + err.message }));
      }
    });
    return;
  }

  // Default 404
  res.writeHead(404);
  res.end('Not Found');
});

// ─── Pool HTTP Server (separate port for transport isolation) ──────────────
// When POOL_PORT differs from RELAY_PORT, bind a dedicated HTTP server for
// pool endpoints. This keeps contributions isolated from authenticated relay traffic.

let poolServer = null;
if (POOL_PORT !== RELAY_PORT) {
  poolServer = createServer((req, res) => {
    handlePoolRequest(req, res, poolStore);
  });
}

// ─── WebSocket Server ────────────────────────────────────────────────────────

const wss = new WebSocketServer({
  server,
  maxPayload: 10 * 1024 * 1024, // 10MB max payload
});

wss.on('connection', (ws, req) => {
  console.log(`[connect] New WebSocket connection`);

  // Authentication is done via 'auth' message (not URL parameter).
  // Client sends { type: 'auth', relayToken: '...' } after WebSocket connects.
  // If auth doesn't arrive within 10s, close the connection.
  ws._authTimeout = setTimeout(() => {
    if (!ws._relayToken) {
      console.warn(`[auth] Connection timed out — closing unauthenticated socket`);
      sendTo(ws, {
        type: 'error',
        message: 'Authentication timeout. Send auth message within 10s.',
      });
      try { ws.close(4001, 'Authentication timeout'); } catch (_) {}
    }
  }, 10_000);

  ws.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      handleMessage(ws, message);
    } catch (err) {
      console.warn(`[error] Failed to parse message: ${err.message}`);
      sendTo(ws, {
        type: 'error',
        message: 'Invalid message format',
      });
    }
  });

  ws.on('close', () => {
    console.log(`[disconnect] Client disconnected`);
    removeClient(ws);
  });

  ws.on('error', (err) => {
    console.warn(`[error] WebSocket error: ${err.message}`);
    removeClient(ws);
  });

  // Ping/pong for keepalive
  ws._pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    }
  }, 30_000);
});

// ─── Message Handling ────────────────────────────────────────────────────────

/**
 * Handle an incoming relay message from a client.
 */
function handleMessage(sender, message) {
  switch (message.type) {
    case 'auth': {
      // Authenticate via relayToken in message body
      const { relayToken } = message;

      if (!relayToken) {
        sendTo(sender, {
          type: 'error',
          message: 'auth message requires relayToken',
        });
        return;
      }

      const enrollment = enrolledDevices.get(relayToken);
      if (!enrollment) {
        sendTo(sender, {
          type: 'error',
          message: 'Invalid relay token',
        });
        return;
      }

      // Check token expiry with sliding window
      if (Date.now() > enrollment.expiresAt) {
        enrolledDevices.delete(relayToken);
        // Also clean up from family device tracking
        const familyTokens = familyDeviceTokens.get(enrollment.familyId);
        if (familyTokens) {
          familyTokens.delete(relayToken);
          if (familyTokens.size === 0) familyDeviceTokens.delete(enrollment.familyId);
        }
        persistState();
        sendTo(sender, {
          type: 'error',
          message: 'Relay token has expired. Re-enroll to continue.',
        });
        console.log(`[auth] Rejected expired token for device "${enrollment.deviceId.slice(0, 12)}..."`);
        return;
      }

      // Sliding-window TTL: refresh expiry on successful auth
      enrollment.expiresAt = Date.now() + TOKEN_TTL_MS;
      persistState();

      sender._relayToken = relayToken;
      sender._enrollment = enrollment;
      // Clear auth timeout since we're authenticated
      clearTimeout(sender._authTimeout);

      sendTo(sender, {
        type: 'auth_ack',
        message: 'Authenticated',
        familyId: enrollment.familyId,
      });
      console.log(`[auth] WebSocket authenticated via message`);
      break;
    }

    case 'identity': {
      // Check authentication
      if (!sender._relayToken) {
        sendTo(sender, {
          type: 'error',
          message: 'Not authenticated. Send auth message first.',
        });
        return;
      }

      // Check rate limit
      if (!checkRateLimit(sender._relayToken)) {
        sendTo(sender, {
          type: 'error',
          message: 'Rate limit exceeded (max 100 messages/min)',
        });
        return;
      }

      const enrollment = sender._enrollment;
      const { deviceId, familyId } = message;

      if (!familyId || !deviceId) {
        sendTo(sender, {
          type: 'error',
          message: 'identity message requires familyId and deviceId',
        });
        return;
      }

      // Verify the claimed deviceId matches the enrolled token's deviceId
      // Prevents a token-holder from impersonating a sibling device
      if (deviceId !== enrollment.deviceId) {
        sendTo(sender, {
          type: 'error',
          message: 'deviceId does not match enrollment',
        });
        console.warn(`[identity] Device "${deviceId.slice(0, 12)}..." tried to impersonate enrollment device "${enrollment.deviceId.slice(0, 12)}..."`);
        return;
      }

      // Verify the claimed familyId matches enrollment
      if (familyId !== enrollment.familyId) {
        sendTo(sender, {
          type: 'error',
          message: 'familyId does not match enrollment',
        });
        return;
      }

      // ── Zombie socket cleanup ──────────────────────────────────────
      const oldSocket = deviceSockets.get(deviceId);
      if (oldSocket && oldSocket !== sender) {
        console.log(`[identity] Device "${deviceId.slice(0, 12)}..." re-identifying — closing old socket`);
        removeClient(oldSocket);
        try {
          oldSocket.close();
        } catch (_) {
          // already closed
        }
      }

      // Remove from old room if re-identifying
      const oldInfo = clientInfo.get(sender);
      if (oldInfo) {
        const oldRoom = familyRooms.get(oldInfo.familyId);
        if (oldRoom) oldRoom.delete(sender);
        const currentSocket = deviceSockets.get(oldInfo.deviceId);
        if (currentSocket === sender) {
          deviceSockets.delete(oldInfo.deviceId);
        }
      }

      // Join family room
      if (!familyRooms.has(familyId)) {
        familyRooms.set(familyId, new Set());
      }

      const room = familyRooms.get(familyId);

      // Enforce max clients per room
      if (room.size >= MAX_CLIENTS_PER_FAMILY) {
        sendTo(sender, {
          type: 'error',
          message: `Family room "${familyId}" is full (max ${MAX_CLIENTS_PER_FAMILY})`,
        });
        return;
      }

      room.add(sender);
      clientInfo.set(sender, { familyId, deviceId, relayToken: sender._relayToken });
      deviceSockets.set(deviceId, sender);

      console.log(`[identity] Device "${deviceId.slice(0, 12)}..." joined family "${familyId}" (${room.size} clients)`);

      sendTo(sender, {
        type: 'ack',
        message: 'Connected to relay',
        familyId,
        deviceId,
      });

      // Send stored update history to the client upon joining
      try {
        const { getAllUpdates } = require('./encrypted-store');
        const familyUpdates = getAllUpdates(familyId);
        let sentHistoryCount = 0;
        for (const [lId, updates] of Object.entries(familyUpdates)) {
          for (const update of updates) {
            sendTo(sender, {
              type: 'update',
              familyId,
              deviceId: 'stored-history',
              listId: lId,
              payload: update
            });
            sentHistoryCount++;
          }
        }
        if (sentHistoryCount > 0) {
          console.log(`[identity] Sent ${sentHistoryCount} historical updates to device "${deviceId.slice(0, 12)}..."`);
        }
      } catch (err) {
        console.warn(`[identity] Failed to load update history: ${err.message}`);
      }

      break;
    }

    case 'update': {
      // Check authentication
      if (!sender._relayToken) {
        sendTo(sender, {
          type: 'error',
          message: 'Not authenticated. Send auth message first.',
        });
        return;
      }

      // Check rate limit
      if (!checkRateLimit(sender._relayToken)) {
        sendTo(sender, {
          type: 'error',
          message: 'Rate limit exceeded (max 100 messages/min)',
        });
        return;
      }

      const { familyId, deviceId, listId, payload } = message;

      if (!familyId || !listId || !payload) {
        sendTo(sender, {
          type: 'error',
          message: 'update message requires familyId, listId, and payload',
        });
        return;
      }

      // Verify sender is in the claimed family room
      const senderInfo = clientInfo.get(sender);
      if (!senderInfo || senderInfo.familyId !== familyId) {
        sendTo(sender, {
          type: 'error',
          message: 'Not authenticated for this family room',
        });
        return;
      }

      // Relay to all OTHER clients in the same family room
      const room = familyRooms.get(familyId);
      if (room) {
        let relayed = 0;
        room.forEach((client) => {
          if (client !== sender && client.readyState === client.OPEN) {
            sendTo(client, {
              type: 'update',
              familyId,
              deviceId,
              listId,
              payload,
            });
            relayed++;
          }
        });
        console.log(`[relay] Device "${deviceId.slice(0, 12)}..." → family "${familyId}" list "${listId}" → ${relayed} peers`);
      }

      // Save update to encrypted-store (100% zero-knowledge persistence)
      try {
        const { addUpdate } = require('./encrypted-store');
        addUpdate(familyId, listId, payload);
      } catch (err) {
        console.warn(`[ws-update] Failed to save update: ${err.message}`);
      }

      sendTo(sender, {
        type: 'ack',
        message: 'Update relayed',
      });
      break;
    }

    default:
      sendTo(sender, {
        type: 'error',
        message: `Unknown message type: ${message.type}`,
      });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendTo(ws, data) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (err) {
      console.warn(`[error] Failed to send message: ${err.message}`);
    }
  }
}

// ─── Blind RSA Token Request Handler ────────────────────────────────────────

/**
 * Handle POST /relay/request-token.
 *
 * Authentication: extract relayToken from Authorization header.
 * Per-device rate limit: N tokens per hour (default: 10).
 * Body: { blindedMsg: "<base64>" }
 * Response: { blindSignature: "<base64>" }
 */
async function handleTokenRequest(req, res) {
  // 1. Authenticate via relayToken
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing or invalid Authorization header. Expected: Bearer <relayToken>' }));
    return;
  }

  const relayToken = authHeader.slice('Bearer '.length).trim();
  const enrollment = enrolledDevices.get(relayToken);

  if (!enrollment) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid relay token' }));
    return;
  }

  // 2. Check token expiry (same sliding window as WebSocket auth)
  if (Date.now() > enrollment.expiresAt) {
    enrolledDevices.delete(relayToken);
    const familyTokens = familyDeviceTokens.get(enrollment.familyId);
    if (familyTokens) {
      familyTokens.delete(relayToken);
      if (familyTokens.size === 0) familyDeviceTokens.delete(enrollment.familyId);
    }
    persistState();
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Relay token has expired. Re-enroll to continue.' }));
    return;
  }

  const deviceId = enrollment.deviceId;

  // 3. Per-device rate limit check
  if (!checkTokenRateLimit(deviceId)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: `Token rate limit exceeded. Max ${TOKEN_RATE_LIMIT} tokens per hour per device.`,
    }));
    return;
  }

  // 4. Parse body
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    // Enforce body size limit
    if (body.length > 4096) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body too large (max 4096 bytes)' }));
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    const { blindedMsg } = parsed;
    if (!blindedMsg || typeof blindedMsg !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'blindedMsg field is required and must be a base64 string' }));
      return;
    }

    // 5. Decode blinded message and blind-sign
    try {
      await ensureIssuerLoaded();

      const blindMsgBytes = Buffer.from(blindedMsg, 'base64');
      const blindSignature = await _blindRsaSuite.blindSign(_issuerPrivateKey, new Uint8Array(blindMsgBytes));

      // 6. Return the blind signature (base64-encoded)
      const blindSigBase64 = Buffer.from(blindSignature).toString('base64');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ blindSignature: blindSigBase64 }));
    } catch (err) {
      console.warn('[token] Blind signing error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to sign token' }));
    }
  });
}

// ─── Start ────────────────────────────────═══════════════════════════════════

// Load persisted state from disk (enrollments, invite signatures)
loadStateFromDisk();

// Voice-assistant public key is loaded lazily on first request. The relay
// never generates or holds the assistant private key (see getAssistantPublicKey
// and assistant-keygen.js); if ASSISTANT_INTEGRATION is on but no public key is
// provisioned, the public-key endpoint fails closed.

// Load the used tokens store (non-blocking)
usedTokensStore.loadOnStartup().catch((err) => {
  console.warn(`[used-tokens] Startup error: ${err.message}`);
});

// Periodic cleanup of token rate limiters (every 2 hours)
setInterval(cleanTokenRateLimiters, 2 * 60 * 60 * 1000);

server.listen(RELAY_PORT, () => {
  const protocol = TLS_CERT_PATH && TLS_KEY_PATH ? 'wss' : 'ws';
  const httpProtocol = TLS_CERT_PATH && TLS_KEY_PATH ? 'https' : 'http';
  console.log(`\n╔══════════════════════════════════════════════════════════════╗
  ║      GroceryApp Relay Server v2                             ║
  ║      Listening on port ${String(RELAY_PORT).padEnd(5)}                               ║
  ║      Identity-aware WebSocket relay for Yjs sync            ║
  ╚══════════════════════════════════════════════════════════════╝

  WebSocket: ${protocol}://localhost:${RELAY_PORT}
  Health:    ${httpProtocol}://localhost:${RELAY_PORT}/health
  Stats:     ${httpProtocol}://localhost:${RELAY_PORT}/stats
  Enroll:    POST ${httpProtocol}://localhost:${RELAY_PORT}/enroll  { deviceToken, familyInviteToken }

  Rate limit:       ${RATE_LIMIT_MESSAGES} messages/min per device
  Max families:     ${MAX_FAMILIES}
  Max devices/family: ${MAX_DEVICES_PER_FAMILY}
  Max clients/family: ${MAX_CLIENTS_PER_FAMILY}
  Token TTL:        ${Math.round(TOKEN_TTL_MS / 86400000)} days
  Auth via:         message (type: 'auth', relayToken: '...')
  TLS:              ${TLS_CERT_PATH && TLS_KEY_PATH ? 'enabled' : 'disabled (use reverse proxy)'}
  `);

    // Periodic cleanup of expired tokens (every hour)
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [token, enrollment] of enrolledDevices) {
        if (now > enrollment.expiresAt) {
          enrolledDevices.delete(token);
          const familyTokens = familyDeviceTokens.get(enrollment.familyId);
          if (familyTokens) {
            familyTokens.delete(token);
            if (familyTokens.size === 0) familyDeviceTokens.delete(enrollment.familyId);
          }
          cleaned++;
        }
      }
      // Prune expired invite signatures (parse JSON to check expiresAt)
      let prunedInvites = 0;
      for (const inviteStr of usedInviteSignatures) {
        try {
          const parsed = JSON.parse(inviteStr);
          if (parsed.expiresAt && now > parsed.expiresAt) {
            usedInviteSignatures.delete(inviteStr);
            prunedInvites++;
          }
        } catch {
          // Malformed entry — remove it
          usedInviteSignatures.delete(inviteStr);
          prunedInvites++;
        }
      }
      if (cleaned > 0 || prunedInvites > 0) {
        console.log(`[cleanup] Removed ${cleaned} expired token(s) and ${prunedInvites} expired invite(s)`);
        persistState();
      }
      // Retention: age out stored encrypted updates (ciphertext-only, but
      // don't keep them forever). Default 30 days, override via UPDATE_TTL_MS.
      try {
        const { cleanupExpiredUpdates } = require('./encrypted-store');
        const updateTtlMs = parseInt(process.env.UPDATE_TTL_MS || '2592000000', 10);
        const removedUpdates = cleanupExpiredUpdates(updateTtlMs);
        if (removedUpdates > 0) {
          console.log(`[cleanup] Removed ${removedUpdates} encrypted update(s) past retention (${Math.round(updateTtlMs / 86400000)}d)`);
        }
      } catch (err) {
        console.error('[cleanup] Encrypted-update retention sweep failed:', err.message);
      }
    }, 60 * 60 * 1000);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

function gracefulShutdown() {
  console.log('[shutdown] Flushing state...');
  if (_saveTimeout) { clearTimeout(_saveTimeout); persistState(); }
  usedTokensStore.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start the pool HTTP server on a separate port
if (POOL_PORT !== RELAY_PORT) {
  poolServer.listen(POOL_PORT, () => {
    console.log(`  Pool API:  http://localhost:${POOL_PORT}/api/pool/contribute`);
  });
} else {
  // When ports are the same, pool is served on the main server (no isolation needed)
  console.log(`  Pool API:  same server (POOL_PORT=${POOL_PORT})`);
}

function getAuthorizeHtml(pairingCode) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Voice Assistant | GroceryApp</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #8a2be2;
      --secondary: #4b0082;
      --glow: #00ffff;
      --bg: #0b0813;
      --card-bg: rgba(255, 255, 255, 0.03);
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #f3f0ff;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Outfit', sans-serif;
      background-color: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }
    
    /* Background animated blobs */
    .blob {
      position: absolute;
      border-radius: 50%;
      filter: blur(80px);
      z-index: 1;
      opacity: 0.15;
      animation: float 20s infinite alternate ease-in-out;
    }
    .blob-1 {
      width: 400px;
      height: 400px;
      background: var(--primary);
      top: -10%;
      left: -10%;
    }
    .blob-2 {
      width: 500px;
      height: 500px;
      background: var(--glow);
      bottom: -10%;
      right: -10%;
      animation-delay: -10s;
    }
    
    @keyframes float {
      0% { transform: translate(0, 0) scale(1); }
      100% { transform: translate(50px, 50px) scale(1.1); }
    }
    
    .container {
      z-index: 10;
      width: 100%;
      max-width: 480px;
      padding: 20px;
    }
    
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 24px;
      padding: 40px 30px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      text-align: center;
      transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .logo {
      font-weight: 800;
      font-size: 28px;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #fff 0%, #a855f7 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 24px;
    }
    
    .title {
      font-size: 22px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    
    .description {
      font-size: 14px;
      color: #9ca3af;
      line-height: 1.6;
      margin-bottom: 32px;
    }
    
    .code-container {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 32px;
      position: relative;
      overflow: hidden;
    }
    
    .code {
      font-family: monospace;
      font-size: 48px;
      font-weight: 800;
      letter-spacing: 8px;
      color: #fff;
      text-shadow: 0 0 20px rgba(168, 85, 247, 0.4);
    }
    
    .status-container {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      font-size: 14px;
      color: #a78bfa;
    }
    
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(167, 139, 250, 0.2);
      border-top-color: #a78bfa;
      border-radius: 50%;
      animation: spin 1s infinite linear;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    /* Success states */
    .success-card {
      border-color: rgba(34, 197, 94, 0.3);
      box-shadow: 0 20px 40px rgba(34, 197, 94, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }
    
    .success {
      color: #22c55e !important;
    }
  </style>
</head>
<body>
  <div class="blob blob-1"></div>
  <div class="blob blob-2"></div>
  
  <div class="container">
    <div class="card" id="card">
      <div class="logo">GroceryApp</div>
      <h1 class="title">Link Voice Assistant</h1>
      <p class="description">
        Open the GroceryApp on your phone, go to <strong>Settings</strong> &rarr; <strong>Link Voice Assistant</strong>, and enter the 6-digit code below to securely link your account.
      </p>
      
      <div class="code-container">
        <div class="code">${pairingCode}</div>
      </div>
      
      <div class="status-container" id="status-box">
        <div class="spinner" id="status-icon"></div>
        <span id="status">Waiting for connection...</span>
      </div>
    </div>
  </div>
  
  <script>
    const pairingCode = "${pairingCode}";
    const poll = setInterval(async () => {
      try {
        const res = await fetch(\`/oauth/status?pairingCode=\` + pairingCode);
        if (res.ok) {
          const data = await res.json();
          if (data.linked && data.redirectUri) {
            clearInterval(poll);
            document.getElementById('status').innerText = 'Successfully Linked! Redirecting...';
            document.getElementById('status').classList.add('success');
            document.getElementById('status-icon').style.display = 'none';
            document.getElementById('card').classList.add('success-card');
            setTimeout(() => {
              window.location.href = data.redirectUri;
            }, 1500);
          }
        }
      } catch (e) {
        console.error(e);
      }
    }, 1500);
  </script>
</body>
</html>`;
}