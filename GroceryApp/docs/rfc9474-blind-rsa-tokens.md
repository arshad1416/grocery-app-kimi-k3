# RFC 9474 Blind RSA Token System — Implementation Plan

## Problem Statement

The current HMAC-based token scheme (v1) is **not truly blind**:
- The `blinded` value = `HMAC(nonce, "contribution-token-v1")` travels in cleartext between issuer and pool
- The pool verifier shares `ISSUER_SECRET` with the issuer
- Anyone with `ISSUER_SECRET` can link issuance to redemption
- The standalone token issuer (port 3001) is a separate service with no device auth

## Solution: RFC 9474 Blind RSA (`@cloudflare/blindrsa-ts`)

Replace the HMAC scheme with proper blind RSA signatures. The issuer gets a CryptoKeyPair — the private key stays on the relay (authenticated endpoint), the public key goes to the pool verifier *only*. The client blinds the message before sending to the issuer; the issuer signs blindly and cannot learn what it signed.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ Client (GroceryApp - React Native)                                  │
│                                                                     │
│  1. Generate 32-byte nonce (message)                                │
│  2. blind(publicKey, nonce) → { blindedMsg, inv }                  │
│  3. POST /relay/request-token  { blindedMsg }  (Auth: relayToken)  │
│  4. Receive { blindSignature }                                      │
│  5. finalize(publicKey, nonce, blindSignature, inv) → token bytes   │
│  6. Use v2.<base64(token)> in Authorization header                  │
└────────────────────┬────────────────────────────────────────────────┘
                     │ WebSocket auth (relayToken)
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Relay Server (relay-server/server.js)                               │
│                                                                     │
│  POST /relay/request-token:                                         │
│    - Auth: Bearer <relayToken>  (same auth as WebSocket)            │
│    - Rate limit per deviceId (N tokens/hour)                        │
│    - blindSign(privateKey, blindedMsg) → blindSignature             │
│    - NEVER sees the original message (that's the blinding)          │
│                                                                     │
│  GET /relay/public-key:                                             │
│    - Returns ISSUER_PUBLIC_KEY in PEM format                        │
│    - No auth required (public info)                                 │
└────────────────────┬────────────────────────────────────────────────┘
                     │ Unauthenticated (token in Authorization header)
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Pool Server (relay-server/pool/pool-server.js)                      │
│                                                                     │
│  POST /api/pool/contribute:                                         │
│    - Reads ISSUER_PUBLIC_KEY env var (PEM RSA public key)           │
│    - If key is NOT set → 500 "Pool not configured" (FAIL CLOSED)   │
│    - verify(publicKey, token, nonce) → true/false                   │
│    - Never touches the private key                                  │
│    - Spent-set persisted to JSON file                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## File-by-File Changes

### Phase 1: Relay-Server Dependencies & Key Management

#### 1. `relay-server/package.json`

**Change**: Add `@cloudflare/blindrsa-ts` dependency.

```diff
{
  "dependencies": {
    "tweetnacl": "^1.0.3",
    "ws": "^8.18.1",
+   "@cloudflare/blindrsa-ts": "^0.4.5"
  }
}
```

Run `npm install` after updating.

#### 2. `GroceryApp/package.json`

**Change**: Add `@cloudflare/blindrsa-ts` as a dependency for the React Native client.

```diff
{
  "dependencies": {
    ...
    "zustand": "^5.0.14",
+   "@cloudflare/blindrsa-ts": "^0.4.5"
  }
}
```

---

### Phase 2: Key Generation & Relay-Server Token Issuance

#### 3. (NEW) `relay-server/tokens/blind-rsa-keygen.js`

**Purpose**: CLI/init script to generate a Blind RSA keypair.

Generate a 2048-bit RSA keypair using `RSABSSA.SHA384.generateKey()`:
- Private key: export as PKCS#8 PEM → save to `ISSUER_PRIVATE_KEY_FILE` (default: `./issuer-private-key.pem`)
- Public key: export as SPKI PEM → save to `ISSUER_PUBLIC_KEY_FILE` (default: `./issuer-public-key.pem`)
- Print instructions for setting environment variables

**Can also be run as**: `node tokens/blind-rsa-keygen.js`

The relay reads `ISSUER_PRIVATE_KEY` (or `ISSUER_PRIVATE_KEY_FILE`) on startup.
The pool reads `ISSUER_PUBLIC_KEY` (or `ISSUER_PUBLIC_KEY_FILE`) on startup.
The client fetches the public key from the relay via `GET /relay/public-key`.

#### 4. `relay-server/server.js` — Add Key Loading

**Location**: After line ~50 (configuration section), add BlindRSA key initialization.

```javascript
const { BlindRSA, RSABSSA } = require('@cloudflare/blindrsa-ts');

// ─── Blind RSA Key Loading ──────────────────────────────────────────
const ISSUER_PRIVATE_KEY_FILE = process.env.ISSUER_PRIVATE_KEY_FILE || './issuer-private-key.pem';
const ISSUER_PUBLIC_KEY_FILE = process.env.ISSUER_PUBLIC_KEY_FILE || './issuer-public-key.pem';

let blindRSA = null;       // BlindRSA instance (suite)
let issuerKeyPair = null;  // CryptoKeyPair { publicKey, privateKey }

async function loadIssuerKeys() {
  // Load private key PEM
  let privateKeyPem;
  if (process.env.ISSUER_PRIVATE_KEY) {
    privateKeyPem = process.env.ISSUER_PRIVATE_KEY;
  } else {
    privateKeyPem = fs.readFileSync(ISSUER_PRIVATE_KEY_FILE, 'utf-8');
  }

  // Import private key (PKCS#8 PEM)
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToBuffer(privateKeyPem),
    { name: 'RSA-PSS', hash: 'SHA-384' },
    false,
    ['sign']
  );

  // Load public key PEM
  let publicKeyPem;
  if (process.env.ISSUER_PUBLIC_KEY) {
    publicKeyPem = process.env.ISSUER_PUBLIC_KEY;
  } else {
    publicKeyPem = fs.readFileSync(ISSUER_PUBLIC_KEY_FILE, 'utf-8');
  }

  const publicKey = await crypto.subtle.importKey(
    'spki',
    pemToBuffer(publicKeyPem),
    { name: 'RSA-PSS', hash: 'SHA-384' },
    false,
    ['verify']
  );

  issuerKeyPair = { publicKey, privateKey };

  // Create BlindRSA instance (RSABSSA.SHA384.PSSZero.Deterministic or Randomized)
  blindRSA = RSABSSA.SHA384.PSSZero.Randomized();

  console.log('[blindrsa] Issuer keys loaded successfully');
}
```

Helper: `pemToBuffer(pem)` strips PEM headers and base64-decodes to ArrayBuffer.

**Important**: Call `loadIssuerKeys()` during server startup before listening. If keys can't be loaded, the `/relay/request-token` endpoint returns 503.

#### 5. `relay-server/server.js` — Add `POST /relay/request-token`

**Location**: In the HTTP request handler, after the `/stats` route (line ~487), add the new endpoint.

Pseudo-code:

```javascript
// ─── Token issuance (authenticated, per-device rate limited) ─────

// Rate limit: tokens per hour per deviceId
const TOKEN_RATE_LIMIT = parseInt(process.env.TOKEN_RATE_LIMIT || '10', 10);
const TOKEN_RATE_WINDOW_MS = 3600_000; // 1 hour
const deviceTokenRateLimiters = new Map(); // Map<deviceId, { count, windowStart }>

if (req.url === '/relay/request-token' && req.method === 'POST') {
  // ── Authenticate via relay token ────────────────────────────
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Missing Authorization header' }));
    return;
  }

  const relayToken = authHeader.slice('Bearer '.length).trim();
  const enrollment = enrolledDevices.get(relayToken);

  if (!enrollment) {
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Invalid relay token' }));
    return;
  }

  if (Date.now() > enrollment.expiresAt) {
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Relay token expired' }));
    return;
  }

  const deviceId = enrollment.deviceId;

  // ── Per-device rate limit ──────────────────────────────────
  const now = Date.now();
  let limiter = deviceTokenRateLimiters.get(deviceId);
  if (!limiter || now - limiter.windowStart > TOKEN_RATE_WINDOW_MS) {
    limiter = { count: 1, windowStart: now };
    deviceTokenRateLimiters.set(deviceId, limiter);
  } else {
    limiter.count++;
  }

  if (limiter.count > TOKEN_RATE_LIMIT) {
    res.writeHead(429);
    res.end(JSON.stringify({ error: 'Rate limit exceeded. Max ' + TOKEN_RATE_LIMIT + ' tokens per hour.' }));
    return;
  }

  // ── Parse blinded message ──────────────────────────────────
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { blindedMsg } = data; // base64-encoded Uint8Array

      if (!blindedMsg || typeof blindedMsg !== 'string') {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'blindedMsg required (base64 string)' }));
        return;
      }

      // Decode blinded message
      const blindMsgBytes = Buffer.from(blindedMsg, 'base64');

      // Blind sign — issuer signs without seeing the message
      const blindSignature = await blindRSA.blindSign(
        issuerKeyPair.privateKey,
        blindMsgBytes
      );

      // Base64-encode result
      const blindSignatureB64 = Buffer.from(blindSignature).toString('base64');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ blindSignature: blindSignatureB64 }));
    } catch (err) {
      console.warn('[blindrsa] Token issuance error:', err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Token issuance failed' }));
    }
  });
  return;
}
```

#### 6. `relay-server/server.js` — Add `GET /relay/public-key`

Add next to the `/relay/request-token` handling:

```javascript
if (req.url === '/relay/public-key' && req.method === 'GET') {
  if (!issuerKeyPair) {
    res.writeHead(503);
    res.end(JSON.stringify({ error: 'Issuer keys not loaded' }));
    return;
  }

  // Export public key as SPKI PEM
  const spkiBytes = await crypto.subtle.exportKey('spki', issuerKeyPair.publicKey);
  const pem = bufferToPem(spkiBytes, 'PUBLIC KEY');

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(pem);
  return;
}
```

---

### Phase 3: Pool Server — Public Key Verification (Fail Closed)

#### 7. `relay-server/pool/pool-server.js` — Rewrite token verification

**Changes**:
- Replace `ISSUER_SECRET` with `ISSUER_PUBLIC_KEY` env var
- Import BlindRSA suite
- **Fail closed**: if `ISSUER_PUBLIC_KEY` is not set, reject all contributions with 500
- Verify using `BlindRSA.verify(publicKey, signature, message)` where:
  - `signature` = base64-decoded token bytes from `v2.<base64(token)>`
  - `message` = the 32-byte nonce (needs to be reconstructed — see wire format notes)
- Remove `verifyToken()` from `../tokens/token-verifier` — import it inline or rewrite the module

**Token format change**: The v1 token carried `blinded:expiresAt` in the payload. The v2 token is just `v2.<base64(signatureBytes)>` — opaque bytes from `BlindRSA.finalize()`. The pool verifier needs the original 32-byte nonce (message) to verify. **Design decision**: include the nonce alongside the contribution payload OR encode it in the token.

**Recommendation**: The nonce (message) is sent alongside the contribution, not embedded in the token. The wire protocol becomes:

```
Authorization: Bearer v2.<base64(signature)>
X-Token-Nonce: <base64(nonce)>
```

Or, simpler: encode both in the v2 token format:
```
v2.<base64(signature + ":" + nonce)>
```

**Chosen approach**: Encode `signature (256 bytes) || nonce (32 bytes)` concatenated, then base64. Pool decodes to get both.

```javascript
// In the verification logic:
const raw = Buffer.from(tokenBytes, 'base64');
const signature = raw.subarray(0, 256);  // RSA 2048-bit signature
const nonce = raw.subarray(256);         // 32-byte message

// Verify
const isValid = await blindRSA.verify(publicKey, signature, nonce);
```

#### 8. `relay-server/pool/pool-server.js` — Fail-closed guard

Replace the current ISSUER_SECRET guard:

```javascript
const { BlindRSA, RSABSSA } = require('@cloudflare/blindrsa-ts');

// ─── Configuration ──────────────────────────────────────────────────
const ISSUER_PUBLIC_KEY_PEM = process.env.ISSUER_PUBLIC_KEY || null;

// Import public key on module load
let issuerPublicKey = null;
let blindRSA = null;

async function initPoolVerifier() {
  if (!ISSUER_PUBLIC_KEY_PEM) {
    console.error('[pool] FATAL: ISSUER_PUBLIC_KEY is not set. Pool will reject all contributions.');
    return; // fail-closed mode — all requests rejected
  }
  // Import SPKI PEM → CryptoKey
  const spkiBytes = pemToBuffer(ISSUER_PUBLIC_KEY_PEM);
  issuerPublicKey = await crypto.subtle.importKey(
    'spki',
    spkiBytes,
    { name: 'RSA-PSS', hash: 'SHA-384' },
    false,
    ['verify']
  );
  blindRSA = RSABSSA.SHA384.PSSZero.Randomized();
  console.log('[pool] Blind RSA verifier initialized');
}
initPoolVerifier();
```

In `handlePoolRequest`, the token verification section becomes:

```javascript
if (ISSUER_PUBLIC_KEY_PEM) {
  // Issuer key configured — require valid token
  if (!issuerPublicKey || !blindRSA) {
    // Keys failed to load
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Pool not configured: issuer public key unavailable' }));
    return;
  }

  // Parse auth header
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Missing or invalid Authorization header' }));
    return;
  }

  const tokenStr = authHeader.slice('Bearer '.length).trim();
  const parts = tokenStr.split('.');
  if (parts.length !== 2 || parts[0] !== 'v2') {
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Invalid token format' }));
    return;
  }

  const raw = Buffer.from(parts[1], 'base64');
  if (raw.length < 288) { // 256 bytes signature + 32 bytes nonce
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Malformed token' }));
    return;
  }

  const signature = raw.subarray(0, 256);
  const nonce = raw.subarray(256);

  // Check spent-set
  const usedTokens = getUsedTokens(); // from persisted file
  if (usedTokens.has(parts[1])) {
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Token already used' }));
    return;
  }

  // Verify the blind signature
  const isValid = await blindRSA.verify(issuerPublicKey, signature, nonce);
  if (!isValid) {
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Invalid token signature' }));
    return;
  }

  // Mark as used and persist
  markTokenUsed(parts[1]);

} else {
  // FAIL CLOSED — no key means no contributions accepted
  res.writeHead(500);
  res.end(JSON.stringify({ error: 'Pool not configured: ISSUER_PUBLIC_KEY not set' }));
  return;
}
```

Note: Because `handlePoolRequest()` is synchronous but `blindRSA.verify()` is async, the handler signature needs to change: currently `handlePoolRequest(req, res, store)` should become `async function handlePoolRequest(req, res, store)`.

#### 9. (MODIFY) `relay-server/pool/pool-server.js` — Make handler async

Change the exported function to handle the async verify call:

```javascript
async function handlePoolRequest(req, res, store) {
  // ... CORS headers (unchanged) ...

  if (url.pathname === '/api/pool/contribute' && req.method === 'POST') {
    // Token verification (async — see above) ...
    // Validation (unchanged) ...
    // Storage (unchanged) ...
  }
}
```

#### 10. `relay-server/server.js` — Update pool handler call

Since `handlePoolRequest` is now async, the call site on lines ~490-492 needs an `await`:

```javascript
if (POOL_PORT === RELAY_PORT && req.url.startsWith('/api/pool/')) {
  await handlePoolRequest(req, res, poolStore);
  return;
}
```

And in the pool server listener:

```javascript
poolServer = createServer(async (req, res) => {
  await handlePoolRequest(req, res, poolStore);
});
```

---

### Phase 4: Persisted Spent-Set

#### 11. (NEW) `relay-server/tokens/used-tokens-store.js`

**Purpose**: Manage a persisted spent-set as a JSON file.

```javascript
const fs = require('fs');
const path = require('path');

const USED_TOKENS_FILE = process.env.USED_TOKENS_FILE || './used-tokens.json';
const USED_TOKEN_TTL_MS = 86_400_000; // 24 hours

let usedTokens = new Map(); // Map<tokenHash, usedAt>
let _saveTimeout = null;

function loadUsedTokens() {
  try {
    if (fs.existsSync(USED_TOKENS_FILE)) {
      const raw = fs.readFileSync(USED_TOKENS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      const now = Date.now();
      for (const [hash, timestamp] of Object.entries(parsed)) {
        if (now - timestamp < USED_TOKEN_TTL_MS) {
          usedTokens.set(hash, timestamp);
        }
      }
    }
  } catch (err) {
    console.warn('[used-tokens] Failed to load:', err.message);
  }
}

function persistUsedTokens() {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    try {
      const obj = {};
      for (const [hash, timestamp] of usedTokens) {
        obj[hash] = timestamp;
      }
      fs.writeFileSync(USED_TOKENS_FILE, JSON.stringify(obj), 'utf-8');
    } catch (err) {
      console.warn('[used-tokens] Failed to persist:', err.message);
    }
  }, 500); // debounce 500ms
}

function markTokenUsed(tokenStr) {
  const hash = crypto.createHash('sha256').update(tokenStr).digest('hex');
  usedTokens.set(hash, Date.now());
  persistUsedTokens();
}

function isTokenUsed(tokenStr) {
  const hash = crypto.createHash('sha256').update(tokenStr).digest('hex');
  if (!usedTokens.has(hash)) return false;
  // Check TTL
  const usedAt = usedTokens.get(hash);
  if (Date.now() - usedAt > USED_TOKEN_TTL_MS) {
    usedTokens.delete(hash);
    persistUsedTokens();
    return false;
  }
  return true;
}

module.exports = { loadUsedTokens, markTokenUsed, isTokenUsed };
```

The pool server imports and uses this module instead of the in-memory-only `usedTokens` Map in `token-verifier.js`.

#### 12. `relay-server/pool/pool-server.js` — Integrate persisted spent-set

Import the module:

```javascript
const { loadUsedTokens, markTokenUsed, isTokenUsed } = require('../tokens/used-tokens-store');
```

Call `loadUsedTokens()` at startup in `initPoolVerifier()`.

Replace `usedTokens.has(parts[1])` check with `isTokenUsed(tokenStr)`.

Replace `markTokenUsed(parts[1])` with the persisted version.

---

### Phase 5: Client-Side Re-Implementation (GroceryApp)

#### 13. `src/pricing/tokens.ts` — Full Rewrite

**Purpose**: Remove HMAC-based scheme. Implement proper blind RSA using `@cloudflare/blindrsa-ts`.

```typescript
import { RSABSSA } from '@cloudflare/blindrsa-ts';
import { getSettings } from '../config/settings';

const TOKEN_VERSION = 'v2';
const REQUEST_TIMEOUT_MS = 10_000;

// ─── Cached state ──────────────────────────────────────────────────

interface CachedToken {
  token: string;        // Full wire token string
  expiresAt: number;    // 24h from issuance
  cachedAt: number;
}

let tokenCache: CachedToken | null = null;
const MAX_CACHE_AGE_MS = 79_200_000; // 22 hours

// ─── Public Key Caching ────────────────────────────────────────────

let cachedPublicKey: CryptoKey | null = null;
let cachedPublicKeyPem: string | null = null;
let blindRSAInstance: ReturnType<typeof RSABSSA.SHA384.PSSZero.Randomized> | null = null;

/**
 * Fetch the issuer public key from the relay server.
 * Cache it in memory for the session lifetime.
 */
async function getIssuerPublicKey(): Promise<{ key: CryptoKey; pem: string }> {
  if (cachedPublicKey && cachedPublicKeyPem) {
    return { key: cachedPublicKey, pem: cachedPublicKeyPem };
  }

  const { relayUrl, relayPort } = getSettings();
  const httpUrl = relayUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:');
  const base = `${httpUrl}:${relayPort}`;

  const response = await fetch(`${base}/relay/public-key`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch issuer public key: ${response.status}`);
  }

  const pem = await response.text();
  
  // Import the PEM as a CryptoKey
  const pemContents = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '');
  const derBytes = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'spki',
    derBytes.buffer,
    { name: 'RSA-PSS', hash: 'SHA-384' },
    false,
    ['verify']
  );

  cachedPublicKey = key;
  cachedPublicKeyPem = pem;
  blindRSAInstance = RSABSSA.SHA384.PSSZero.Randomized();

  return { key, pem };
}

// ─── Token Protocol ────────────────────────────────────────────────

/**
 * Generate a 32-byte random nonce (the message to be blind-signed).
 */
function generateNonce(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Utility: convert ArrayBuffer to base64 string.
 */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Request a fresh blind-signed token from the authenticated relay.
 *
 * Flow:
 *  1. Generate random 32-byte nonce
 *  2. blind(publicKey, nonce) → { blindedMsg, inv }
 *  3. POST /relay/request-token { blindedMsg } with relay token auth
 *  4. Receive { blindSignature }
 *  5. finalize(publicKey, nonce, blindSignature, inv) → token bytes
 *  6. Encode as v2.<base64(token)> and cache
 */
export async function requestContributionToken(): Promise<string | null> {
  const { relayUrl, relayPort } = getSettings();
  const httpUrl = relayUrl
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:');
  const base = `${httpUrl}:${relayPort}`;

  // Fetch public key and create BlindRSA instance
  const { key: publicKey } = await getIssuerPublicKey();
  const blindRSA = blindRSAInstance!;

  // Step 1: Generate nonce
  const nonce = generateNonce();

  // Step 2: Blind the nonce
  const { blindedMsg, inv } = await blindRSA.blind(publicKey, nonce);
  // blindedMsg: Uint8Array — the blinded message to send to issuer
  // inv: Uint8Array — the blinding factor (secret, kept client-side)

  // Step 3: POST to authenticated relay endpoint
  const response = await fetch(`${base}/relay/request-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Use the relay token for authentication (from secure store)
      'Authorization': `Bearer ${getSettings().relayToken}`,
    },
    body: JSON.stringify({
      blindedMsg: arrayBufferToBase64(blindedMsg.buffer),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    console.warn('[tokens] Failed to request token:', response.status);
    return null;
  }

  const data = await response.json() as { blindSignature: string };
  const blindSignature = Uint8Array.from(atob(data.blindSignature), c => c.charCodeAt(0));

  // Step 5: Finalize/unblind the signature
  const tokenBytes = await blindRSA.finalize(publicKey, nonce, blindSignature, inv);

  // Step 6: Encode wire token
  const tokenPayload = arrayBufferToBase64(tokenBytes.buffer);
  const token = `${TOKEN_VERSION}.${tokenPayload}`;

  // Cache the token
  tokenCache = {
    token,
    expiresAt: Date.now() + 86_400_000, // 24h TTL
    cachedAt: Date.now(),
  };

  return token;
}

// ─── Cache Helpers (unchanged interface) ───────────────────────────

export async function getContributionToken(): Promise<string | null> {
  if (tokenCache) {
    const age = Date.now() - tokenCache.cachedAt;
    if (age < MAX_CACHE_AGE_MS && Date.now() < tokenCache.expiresAt) {
      return tokenCache.token;
    }
    tokenCache = null;
  }
  return requestContributionToken();
}

export function clearContributionTokenCache(): void {
  tokenCache = null;
}
```

**Key change from v1**: 
- Token is fetched from the **authenticated relay** (`/relay/request-token`), not a separate issuer URL
- Authentication uses the existing relay token (same as WebSocket auth)
- The nonce is NEVER sent to the issuer — only `blindedMsg` 
- The issuer returns `{ blindSignature }` only — cannot link to final token
- Wire format: `v2.<base64(tokenBytes)>`

#### 14. `src/pricing/contribute.ts` — Minor changes

**Changes**:
- Import updated `getContributionToken` and `clearContributionTokenCache` (interface unchanged)
- No changes to the contribution flow itself — it already uses `Authorization: Bearer <token>`
- The token format changes from `v1.<payload>.<proof>` to `v2.<bytes>`, but the contribution function passes it as opaque string

**Potential update**: Add `X-Token-Nonce` header if the pool needs the nonce separately. However, with the chosen wire format (signature + nonce concatenated in the token bytes), no extra header is needed.

---

### Phase 6: Configuration & Environment Changes

#### 15. `relay-server/server.js` — Add env var documentation

Add to the env var block at the top:

```javascript
// ─── Blind RSA Issuer Keys ──────────────────────────────────────────
// ISSUER_PRIVATE_KEY        — PEM-encoded RSA private key (PKCS#8)
// ISSUER_PRIVATE_KEY_FILE   — File path (default: ./issuer-private-key.pem)
// ISSUER_PUBLIC_KEY         — PEM-encoded RSA public key (SPKI)
// ISSUER_PUBLIC_KEY_FILE    — File path (default: ./issuer-public-key.pem)
// TOKEN_RATE_LIMIT          — Max tokens per device per hour (default: 10)
```

#### 16. `relay-server/pool/pool-server.js` — Add env var documentation

```javascript
// ─── Configuration ──────────────────────────────────────────────────
// ISSUER_PUBLIC_KEY      — PEM-encoded RSA public key (REQUIRED, fail-closed)
// ISSUER_PUBLIC_KEY_FILE — File path fallback
// USED_TOKENS_FILE       — Path to persisted spent-set JSON (default: ./used-tokens.json)
```

#### 17. (OPTIONAL) `src/types/index.ts` — Update AppSettings

The `tokenIssuerUrl` setting can be removed since tokens flow through the authenticated relay:

```diff
export interface AppSettings {
  ...
-  /** Token issuer URL for blind-signed contribution tokens */
-  tokenIssuerUrl?: string;
}
```

#### 18. (OPTIONAL) `src/config/settings.ts` — Remove `tokenIssuerUrl`

Remove the field from `DEFAULT_SETTINGS` since it's no longer used.

---

## Migration & Backward Compatibility

### No backward compatibility with v1 tokens

v1 tokens (HMAC-based) must be rejected once the Blind RSA scheme is live. This is acceptable because:
- Tokens have a 24h TTL
- The switchover can happen during a maintenance window
- The client falls back to `null` (self-host mode) if the relay is unreachable

### Deployment sequence

1. **Generate keys**: Run `node tokens/blind-rsa-keygen.js` on the relay server
2. **Set env vars**: Configure `ISSUER_PRIVATE_KEY`, `ISSUER_PUBLIC_KEY` on relay; `ISSUER_PUBLIC_KEY` on pool
3. **Deploy relay-server**: New code with `/relay/request-token` and `/relay/public-key` endpoints
4. **Deploy pool-server**: New code with blind RSA verification, persisted spent-set, fail-closed
5. **Update client app**: New `@cloudflare/blindrsa-ts` dependency, rewritten `tokens.ts`
6. **Test**: End-to-end: client blinds → relay signs → pool verifies → contribution accepted

## Cleanup

After deployment:
- The standalone token issuer (`relay-server/tokens/token-issuer.js`) can be retired
- The old `token-verifier.js` can be deleted (its logic is replaced by `used-tokens-store.js` + inline BlindRSA verify)
- The `ISSUER_SECRET` env var is no longer needed on either relay or pool

---

## Summary of All Files Changed

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `relay-server/package.json` | Modify | Add `@cloudflare/blindrsa-ts` |
| 2 | `GroceryApp/package.json` | Modify | Add `@cloudflare/blindrsa-ts` |
| 3 | `relay-server/tokens/blind-rsa-keygen.js` | **NEW** | Key generation script |
| 4 | `relay-server/server.js` | Modify | Add key loading, `/relay/request-token`, `/relay/public-key` |
| 5 | `relay-server/pool/pool-server.js` | **REWRITE** | Blind RSA verify, fail-closed, async handler |
| 6 | `relay-server/tokens/used-tokens-store.js` | **NEW** | Persisted spent-set to JSON file |
| 7 | `relay-server/tokens/token-verifier.js` | Delete/Archive | Replaced by Blind RSA + used-tokens-store |
| 8 | `relay-server/tokens/token-issuer.js` | Delete/Archive | Replaced by `/relay/request-token` |
| 9 | `src/pricing/tokens.ts` | **REWRITE** | Blind RSA using library, relay auth |
| 10 | `src/pricing/contribute.ts` | Minor Modify | Import updated tokens module |
| 11 | `src/types/index.ts` | Minor Modify | Remove `tokenIssuerUrl` |
| 12 | `src/config/settings.ts` | Minor Modify | Remove `tokenIssuerUrl` default |
