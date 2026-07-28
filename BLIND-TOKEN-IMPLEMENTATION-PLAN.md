# Blind-Signed Contribution Token System

## Implementation Plan for Owl Alpha

**Solves:** N2 (IP isolation) + N4 (abuse control) **together**

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CONTRIBUTION FLOW WITH BLIND TOKENS                                   │
│                                                                         │
│  ┌──────────┐    1. POST /request-token     ┌──────────────┐           │
│  │          │     { blinded: "hmac(...)" }   │              │           │
│  │  CLIENT  │ ────────────────────────────── ▶  TOKEN       │           │
│  │  (app)   │                                │  ISSUER      │           │
│  │          │    ◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │  (sees IP)   │           │
│  │          │    2. { signedBlinded: "..." }  │  rate-limits │           │
│  │          │                                │  by IP       │           │
│  │          │    3. Client unblinds token     │  never sees  │           │
│  │          │       → gets (token, sig)       │  payload     │           │
│  │          │                                └──────────────┘           │
│  │          │                                                           │
│  │          │    4. POST /api/pool/contribute ┌──────────────┐           │
│  │          │     Authorization: Bearer token  │              │           │
│  │          │     { storeId, itemName, ... }   │  POOL        │           │
│  │          │ ────────────────────────────── ▶  │  SERVER      │           │
│  │          │                                │  (sees        │           │
│  │          │    ◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │   payload)    │           │
│  │          │    5. 200 OK                    │  verifies    │           │
│  └──────────┘                                │   signature  │           │
│                                              │  never sees  │           │
│   KEY PROPERTIES:                            │   IP         │           │
│   • Issuer sees IP but NOT payload           └──────────────┘           │
│   • Pool sees payload but NOT IP                                        │
│   • Client needs both to contribute                                     │
│   • Self-host users skip token issuer entirely                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## File-by-File Implementation

### SERVER SIDE

---

### 1. NEW FILE: `relay-server/tokens/token-issuer.js`

**Purpose:** Standalone HTTP server for blind token issuance. Rate-limits by IP, blindly signs tokens, never sees the contribution payload.

```javascript
/**
 * Token Issuer — Blind-Signed Contribution Token Server
 *
 * POST /request-token
 *   Request body: { blinded: "<base64-hmac>" }
 *   Rate limit: 10 tokens/min per IP
 *   Response:    { signedBlinded: "<base64-hmac>" }
 *
 * Blind signing scheme (v1, HMAC-based):
 *   - Client generates a random 32-byte nonce
 *   - Client computes: blinded = HMAC-SHA256(key=nonce, message="contribution-token-v1")
 *   - Client sends blinded to issuer
 *   - Issuer computes: signedBlinded = HMAC-SHA256(key=ISSUER_SECRET, message=blinded)
 *   - Client receives signedBlinded
 *   - Client derives: token = HMAC-SHA256(key=nonce, message=signedBlinded)
 *   - Token is the contribution credential
 *
 * v1 APPROXIMATION NOTE:
 *   This is NOT formal Privacy Pass or OHTTP. The HMAC-based scheme provides
 *   practical unlinkability: the issuer sees H(nonce) which reveals nothing
 *   about the nonce itself, and the final token requires knowledge of both
 *   the nonce and the signed blinded value. For v2, replace with formal
 *   Privacy Pass (VOPRF) or OHTTP.
 *
 * Environment variables:
 *   TOKEN_ISSUER_PORT      (default: 3001)
 *   TOKEN_ISSUER_SECRET    (auto-generated if not set, persists in file)
 *   TOKEN_ISSUER_SECRET_FILE (default: ./token-issuer-secret.key)
 *   TOKEN_RATE_LIMIT       (default: 10 tokens/min per IP)
 *   TOKEN_TTL_MS           (default: 86400000 = 24 hours)
 */

// Dependencies: none beyond Node.js built-ins (crypto, http)
// No npm packages needed — uses only crypto.createHmac
```

**Required behaviors:**

| Endpoint | Method | Auth | Rate Limit | Description |
|----------|--------|------|------------|-------------|
| `/request-token` | POST | None | 10/min per IP | Accepts `{ blinded }`, returns `{ signedBlinded }` |
| `/health` | GET | None | None | Returns `{ status: "ok" }` |

**Implementation details:**
- Generate ISSUER_SECRET on first run (32 random bytes via `crypto.randomBytes`), persist to file
- HMAC-SHA256 for all operations
- Per-IP rate limiting: in-memory Map with 1-minute sliding windows
- Periodic cleanup of expired rate limiters (every 5 min)
- CORS headers: `Access-Control-Allow-Origin: *`
- Token expiry: issuer includes expiry in the response, encoded as HMAC(ISSUER_SECRET, blinded + ":" + expiry) to prevent tampering
- Response body: `{ signedBlinded: "<base64>", expiresAt: <epoch_ms> }`

---

### 2. NEW FILE: `relay-server/tokens/token-verifier.js`

**Purpose:** Token verification functions used by pool-server to validate attached contribution tokens.

```javascript
/**
 * Token Verifier — Blind-Signed Contribution Token Verification
 *
 * verifyToken(token, issuerPublicKey):
 *   - token: the full token string from Authorization header
 *   - Returns { valid: boolean, expiresAt?: number }
 *
 * Used by pool-server on POST /api/pool/contribute
 * Pool server initializes with the shared ISSUER_SECRET at startup
 * (same secret as token-issuer, shared via env var or config)
 */

const TOKEN_VERSION = 'v1';
const TOKEN_SEPARATOR = '.';

/**
 * Parse and verify a contribution token.
 *
 * Token format (v1):  "v1.<base64token>.<base64sig>"
 * Where sig = HMAC(ISSUER_SECRET, token + ":" + expiresAt)
 *
 * @param {string} tokenStr - The full Authorization Bearer token
 * @param {string} issuerSecret - Shared HMAC secret (same as issuer)
 * @param {Set<string>} usedTokens - Set of already-used tokens (single-use enforcement)
 * @returns {{ valid: boolean, error?: string, expiresAt?: number }}
 */
function verifyToken(tokenStr, issuerSecret, usedTokens) { ... }

module.exports = { verifyToken };
```

**Verification logic:**
1. Split token by `.` — must have 3 parts: `[version, tokenPayload, signature]`
2. Check version is `v1`, reject unknown versions
3. Check token not in `usedTokens` Set (replay/single-use protection)
4. Recompute: `expectedSig = HMAC(issuerSecret, tokenPayload)`
5. Constant-time compare: `crypto.timingSafeEqual(expectedSig, providedSig)`
6. Extract expiry from decoded tokenPayload, reject if expired
7. Add token to `usedTokens` Set on success
8. Return `{ valid: true }` or `{ valid: false, error: "..." }`

---

### 3. MODIFY: `relay-server/pool/pool-server.js`

**Changes required:**

| Change | What | Why |
|--------|------|-----|
| **Remove** | Per-IP rate limiter (lines 13-64) | Moves to token issuer; pool should not see IPs |
| **Remove** | `clientIp` extraction and `checkIpRateLimit` call (lines 130-137) | Pool no longer reads client IP — this is the N2 fix |
| **Add** | Import `verifyToken` from `../tokens/token-verifier` | Token verification |
| **Add** | `usedTokens` Set + cleanup interval | Single-use enforcement |
| **Add** | `ISSUER_SECRET` from env or config | Shared secret with token issuer |
| **Add** | Token verification in POST handler before validation | Gate contribution on valid token |
| **Keep** | CORS, body parsing, validation, store logic | Unchanged |

**Modified handlePoolRequest flow:**
```
POST /api/pool/contribute:
  1. Parse Authorization header
  2. If no token or token starts with "selfhost-" → skip verification (self-host mode)
  3. Call verifyToken(token, issuerSecret, usedTokens)
  4. If invalid → 401 { error: "Invalid or expired contribution token" }
  5. If valid → proceed with body validation → store → 200
```

**Self-host bypass:** When `ISSUER_SECRET` env var is not set, pool operates in "open" mode (no token required). This lets self-host users skip the token system entirely.

**Environment variable:** `ISSUER_SECRET` — shared between token-issuer and pool-server.

---

### CLIENT SIDE

---

### 4. NEW FILE: `src/pricing/tokens.ts`

**Purpose:** Client-side blind token protocol. Requests tokens from the issuer, unblinds them, caches them, and provides them to the contribution pipeline.

```typescript
/**
 * Contribution Tokens — Blind-Signed Token Protocol (v1, HMAC-based)
 *
 * The client obtains blind-signed tokens from a separate token issuer endpoint.
 * Tokens are single-use, expire after 24 hours, and are cached in memory.
 *
 * v1 APPROXIMATION:
 *   This uses HMAC-SHA256 for blind signing rather than formal Privacy Pass
 *   (VOPRF). The protocol provides practical unlinkability:
 *     - Issuer sees H(nonce) which reveals nothing about the nonce
 *     - Final token requires knowledge of both nonce and issuer's HMAC
 *   Upgrade to formal Privacy Pass / OHTTP in v2.
 *
 * Flow:
 *   1. Generate random 32-byte nonce
 *   2. Blind: blinded = HMAC(nonce, "contribution-token-v1")
 *   3. Send to issuer: POST { blinded }
 *   4. Receive: { signedBlinded, expiresAt }
 *   5. Unblind: token = HMAC(nonce, signedBlinded)
 *   6. Token format: "v1.<base64(token)>.<base64(HMAC(issuerSecret, token))>"
 *      (Note: client doesn't have issuerSecret — the "signature" part is
 *       calculated differently. See detailed protocol below.)
 */

import { getSettings } from '../config/settings';

const TOKEN_CACHE_KEY = 'contribution_token';
const MIN_TOKEN_REFRESH_MS = 300_000; // 5 min before expiry, refresh early
const REQUEST_TIMEOUT_MS = 10_000;

// In-memory token cache
interface CachedToken {
  token: string;        // Full Authorization: Bearer value
  expiresAt: number;    // Epoch ms
}

let tokenCache: CachedToken | null = null;

/**
 * Get the token issuer URL from settings.
 * Falls back to poolUrl + "/request-token" if tokenIssuerUrl not set.
 * Returns null if neither is configured (self-host mode).
 */
function getTokenIssuerUrl(): string | null { ... }

/**
 * Generate a blinded token request.
 * Returns { blinded: string, nonce: Uint8Array }
 * blinded = HMAC-SHA256(key=nonce, msg="contribution-token-v1")
 */
async function generateBlindedRequest(): Promise<{ blinded: string, nonce: Uint8Array }> { ... }

/**
 * Unblind the issuer's response to produce the final token.
 * finalToken = HMAC-SHA256(key=nonce, msg=signedBlinded)
 * Token wire format: "v1.<base64(finalToken)>.<base64(expiry_sig)>"
 * where expiry_sig = HMAC(issuerSecret, finalToken + ":" + expiresAt)
 * (Pool server will verify using the shared ISSUER_SECRET)
 */
function unblindToken(signedBlinded: string, nonce: Uint8Array, expiresAt: number): string { ... }

/**
 * Request a fresh contribution token from the issuer.
 * Rate-limited (10/min per IP) by the issuer server.
 */
export async function requestContributionToken(): Promise<string | null> { ... }

/**
 * Get a cached contribution token, or request a new one.
 * Returns null if tokenIssuerUrl is not configured (self-host mode).
 */
export async function getContributionToken(): Promise<string | null> { ... }

/**
 * Clear the cached token (e.g. on 403 rejection).
 */
export function clearContributionTokenCache(): void { ... }
```

**Detailed HMAC blind signing protocol:**

The protocol is a simplified blind signature scheme:

1. **Client generates nonce:** 32 random bytes via `crypto.getRandomValues(new Uint8Array(32))`

2. **Client blinds:**
   ```
   blindedPayload = HMAC-SHA256(nonce, "contribution-token-v1")
   ```
   This hides the nonce from the issuer. The issuer sees `blindedPayload` but
   cannot learn `nonce` from it (HMAC preimage resistance).

3. **Client sends to issuer:**
   ```json
   POST /request-token
   { "blinded": "<base64(blindedPayload)>" }
   ```

4. **Issuer signs blindly:**
   ```
   signedBlinded = HMAC-SHA256(issuerSecret, blindedPayload)
   expiresAt = now + 24h
   expiryProof = HMAC-SHA256(issuerSecret, signedBlinded + ":" + expiresAt)
   ```
   Returns: `{ signedBlinded: "<base64>", expiresAt: <epoch_ms>, expiryProof: "<base64>" }`

5. **Client unblinds:**
   ```
   unblindedToken = HMAC-SHA256(nonce, signedBlinded)
   ```
   This is the final token. The client knows `nonce` so it can compute it.
   The issuer cannot link `unblindedToken` back to `blindedPayload` because
   it doesn't know `nonce`.

6. **Wire format:**
   ```
   v1.<base64(unblindedToken)>.<base64(expiryProof)>
   ```
   This goes in the `Authorization: Bearer <token>` header.

7. **Pool verification:**
   Pool receives the token, splits it, recomputes `HMAC(issuerSecret, unblindedToken + ":" + expiresAt)` using its own `issuerSecret`, and compares.

**Unlinkability guarantee:**
- Issuer sees `blindedPayload = H(nonce)` — learns nothing about the nonce
- Pool sees `unblindedToken = H(nonce, H(secret, H(nonce)))` — can verify the signature, but cannot link back to the blinded request
- Only the client knows both `nonce` and `signedBlinded`, so only the client can produce a valid `unblindedToken`
- The HMAC sandwich (nonce → blinded → signed → unblinded) ensures the issuer and pool cannot correlate their views

---

### 5. MODIFY: `src/pricing/contribute.ts`

**Changes:**

| Location | Change | Detail |
|----------|--------|--------|
| `sendContribution()` | Add Authorization header | Attach `Bearer <token>` from `getContributionToken()` |
| `sendContribution()` | Handle 401/403 | Clear token cache, retry once |
| Import | Add `getContributionToken`, `clearContributionTokenCache` | From `./tokens` |

**Modified `sendContribution`:**
```typescript
async function sendContribution(price: ContributedFlyerPrice): Promise<boolean> {
  const baseUrl = getHttpRelayUrl();
  const url = `${baseUrl}/api/pool/contribute`;

  // Obtain a contribution token
  const token = await getContributionToken();
  if (!token) {
    // Self-host mode — no token needed, pool accepts without auth
    return sendWithoutToken(url, price);
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(price),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 401 || response.status === 403) {
      // Token rejected — clear cache, get new one, retry once
      clearContributionTokenCache();
      const newToken = await getContributionToken();
      if (newToken) {
        const retryResponse = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${newToken}`,
          },
          body: JSON.stringify(price),
          signal: AbortSignal.timeout(10_000),
        });
        return retryResponse.ok;
      }
      return false;
    }

    return response.ok;
  } catch {
    return false;
  }
}
```

---

### 6. MODIFY: `src/types/index.ts`

**Add to `AppSettings`:**
```typescript
export interface AppSettings {
  // ... existing fields ...

  /** Separate pool server URL for contribution transport isolation */
  poolUrl?: string;

  /** NEW: Token issuer URL for blind-signed contribution tokens */
  tokenIssuerUrl?: string;
}
```

---

### 7. MODIFY: `src/config/settings.ts`

**Add default:**
```typescript
const DEFAULT_SETTINGS: AppSettings = {
  // ... existing defaults ...
  poolUrl: '',
  tokenIssuerUrl: '',  // NEW: empty = self-host, skip token system
};
```

---

### 8. MODIFY: `relay-server/server.js`

**Changes:**

| Location | Change |
|----------|--------|
| pool server creation (lines 503-508) | Add `ISSUER_SECRET` env var passthrough to pool handler if configured |
| New env var read | `ISSUER_SECRET` — shared secret for token verification |

---

### 9. MODIFY: `docker-compose.yml`

**Add token issuer service:**
```yaml
services:
  relay:
    # ... existing config ...
    environment:
      # ... existing vars ...
      - ISSUER_SECRET=${ISSUER_SECRET:-}  # Optional: set for managed deployments

  token-issuer:
    build:
      context: ./relay-server
      dockerfile: Dockerfile
    image: groceryapp-token-issuer:latest
    container_name: groceryapp-token-issuer
    restart: unless-stopped
    ports:
      - "3001:3001"
    command: node tokens/token-issuer.js
    environment:
      - NODE_ENV=production
      - TOKEN_ISSUER_PORT=3001
      - TOKEN_ISSUER_SECRET=${ISSUER_SECRET:-}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    networks:
      - groceryapp-network
```

---

### 10. MODIFY: `relay-server/Dockerfile`

Add token-issuer entry point (if using multistage or separate entrypoint).
For v1, simplest approach: the same Docker image can run either server or issuer depending on `command`.

---

## TEST PLAN

### Server Tests (Jest, in `relay-server/tokens/__tests__/`)

| Test | Description |
|------|-------------|
| `token-issuer.test.js` | |
| `POST /request-token returns signed blinded token` | Send blinded payload, expect `{ signedBlinded, expiresAt, expiryProof }` |
| `rate limits by IP` | Send 11 requests from same IP, 11th gets 429 |
| `different IPs have independent rate limits` | Send 10 from IP-A, 10 from IP-B, all succeed |
| `rejects invalid request body` | Missing `blinded` field → 400 |
| `returns CORS headers` | OPTIONS preflight → 204 with headers |
| `token-verifier.test.js` | |
| `verifyToken accepts valid token` | Create valid token, verify returns `{ valid: true }` |
| `verifyToken rejects invalid signature` | Tamper with signature → `{ valid: false }` |
| `verifyToken rejects replayed token` | Verify same token twice → second fails |
| `verifyToken rejects expired token` | Token with past `expiresAt` → `{ valid: false }` |
| `verifyToken rejects malformed token string` | Wrong version, wrong parts count → `{ valid: false }` |
| `pool-server-token.test.js` | |
| `contribute requires valid token` | POST without Authorization header → 401 |
| `contribute accepts valid token` | POST with valid token → 200 |
| `contribute rejects replayed token` | Same token twice → 200 then 401 |
| `self-host mode (no ISSUER_SECRET) skips verification` | No ISSUER_SECRET → POST succeeds without token |

### Client Tests (Jest, in `GroceryApp/__tests__/`)

| Test | Description |
|------|-------------|
| `tokens.test.ts` | |
| `generateBlindedRequest returns blinded + nonce` | Check nonce is 32 bytes, blinded is base64 string |
| `unblindToken produces expected format` | Mock signedBlinded, verify output format |
| `requestContributionToken returns token string` | Mock fetch, verify cached token |
| `requestContributionToken returns null when no URL configured` | tokenIssuerUrl empty → null (self-host) |
| `getContributionToken returns cached token` | Request once, then get returns same token |
| `contribute.test.ts` (extend) | |
| `sendContribution attaches Authorization header` | Mock fetch, check headers include Bearer token |
| `sendContribution retries on 401` | First fetch returns 401, second returns 200 |
| `sendContribution fails after retry` | Both attempts return 401 → returns false |

---

## ENVIRONMENT VARIABLES

| Variable | Default | Service | Description |
|----------|---------|---------|-------------|
| `TOKEN_ISSUER_PORT` | `3001` | token-issuer | HTTP listen port |
| `TOKEN_ISSUER_SECRET` | (auto-gen) | token-issuer | HMAC signing key |
| `TOKEN_ISSUER_SECRET_FILE` | `./token-issuer-secret.key` | token-issuer | Persists auto-gen secret |
| `TOKEN_RATE_LIMIT` | `10` | token-issuer | Max tokens/min per IP |
| `TOKEN_TTL_MS` | `86400000` | token-issuer | Token validity (24h) |
| `ISSUER_SECRET` | (none) | pool-server | Shared secret; not set = self-host mode (no token required) |

---

## IMPLEMENTATION ORDER

### Phase 1: Core Infrastructure (1 session)
1. Create `relay-server/tokens/token-issuer.js`
2. Create `relay-server/tokens/token-verifier.js`
3. Create `relay-server/tokens/__tests__/token-issuer.test.js`
4. Create `relay-server/tokens/__tests__/token-verifier.test.js`
5. Verify tests pass

### Phase 2: Pool Integration (1 session)
1. Modify `relay-server/pool/pool-server.js` to remove IP rate limiter
2. Add token verification to POST handler
3. Add `usedTokens` Set with periodic cleanup
4. Add `ISSUER_SECRET` env var support
5. Update `relay-server/server.js` to pass ISSUER_SECRET to pool handler
6. Verify pool-server-token tests pass

### Phase 3: Client Integration (1 session)
1. Create `src/pricing/tokens.ts`
2. Modify `src/pricing/contribute.ts`
3. Add `tokenIssuerUrl` to `src/types/index.ts`
4. Add default to `src/config/settings.ts`
5. Create `__tests__/tokens.test.ts`
6. Extend `__tests__/contribute.test.ts`
7. Verify `tsc --noEmit` and Jest pass

### Phase 4: Deployment (1 session)
1. Add token-issuer service to `docker-compose.yml`
2. Update Dockerfile for token-issuer entrypoint
3. Update deployment docs
4. End-to-end test: client → issuer → client → pool flow

---

## SECURITY CONSIDERATIONS

1. **ISSUER_SECRET must be the same** on both token-issuer and pool-server. In managed deployments, set via environment variable. In auto-gen mode, generate once and share out-of-band.

2. **Token wire format** includes expiry in the signed payload, preventing replay of expired tokens. The pool should also prune expired tokens from the `usedTokens` Set.

3. **usedTokens Set growth** is bounded by token TTL (24h). At 10 tokens/min/IP with N IPs, max entries = 10 × 60 × 24 × N = 14,400 × N. Prune entries older than TTL every 5 minutes. For large deployments, switch to Redis-backed Set.

4. **HMAC-SHA256 vs real Privacy Pass:** The v1 scheme provides unlinkability through the nonce blinding layer, but HMAC is deterministic (same nonce → same blinded). The client generates a fresh nonce per request, so this is fine. Real Privacy Pass (VOPRF) provides stronger guarantees (provable unlinkability). Upgrade path documented in code.

5. **Self-host bypass:** When `ISSUER_SECRET` is not set on the pool server, it operates in open mode. Self-host users on their own LAN don't need IP isolation (no untrusted ISP watching), so this is safe.

6. **No identity, no deviceId, no account** anywhere in the token flow. The token is purely cryptographic proof of rate-limited access, not identity.

---

## UPGRADE PATH (v2)

- Replace HMAC-based blind signing with formal [Privacy Pass VOPRF](https://privacypass.github.io/) (Oblivious Pseudorandom Function)
- Replace HTTP pool transport with [Oblivious HTTP (OHTTP)](https://datatracker.ietf.org/doc/draft-ietf-ohai-ohttp/) for formal IP-hiding
- Replace HMAC with Ed25519 blind signatures using a pairing-based VOPRF (e.g., [draft-irtf-cfrg-voprf](https://datatracker.ietf.org/doc/draft-irtf-cfrg-voprf/))
- Replace in-memory usedTokens Set with Redis or similar for horizontal scaling

The v1 HMAC scheme is a pragmatic approximation that provides the correct security properties for initial deployment while keeping complexity low.
