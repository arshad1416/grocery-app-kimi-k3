# Closing the 4 Remaining Gaps — Practical Recommendations

## Priority Ranking (by impact)

1. **Unit tests for price-store merge + stop-optimizer** — lowest cost, fastest payoff, 0 blockers
2. **Vision extractor** — highest user-facing value, biggest build item
3. **IP-strip proxy / OHTTP** — privacy improvement, can ship without
4. **Professional crypto review** — important but can wait for v1.x

---

## Gap 1: Vision Extractor (Real AI Extraction)

### Recommended approach: **Server-side via the relay, with a "self-host Ollama" path**

Specifically:
- The relay server gets a new optional sub-service: `/extract` endpoint on a configurable port
- The client sends the EXIF-stripped image (already handled by `stripExif()` in `flyer-pipeline.ts` — the privacy contract is satisfied) to the relay's extract endpoint
- The extract endpoint dispatches to the configured backend:
  - **Self-host (free)**: relay proxies to a local Ollama instance running Qwen2.5-VL 7B. Configured via `OLLAMA_URL=http://localhost:11434` env var on the relay. Docker Compose gets an optional `ollama` service.
  - **Managed (paid)**: relay proxies to Qwen VL Max API (Alibaba Cloud), with Claude fallback via `CLAUDE_API_KEY` for low-confidence pages.
- The extractors implement the `FlyerExtractor` interface on both client and server sides
- For self-host, the extract runs locally and images never leave your home network

### Why this approach

1. **The privacy contract is already satisfied.** `stripExif()` runs client-side before any network call. The image that reaches the relay has no EXIF metadata — no GPS, camera model, timestamp. This is the critical privacy boundary, and it's already in the code.

2. **On-device ML is impractical for this use case.** Running Qwen2.5-VL (even 7B) on a phone requires >8GB RAM, 3+ second inference even on optimized hardware, and drains battery. The user experience would be terrible — the camera stays open showing a spinner while the model thinks. Server-side extraction takes 1–3 seconds on modest hardware.

3. **The relay already exists.** Adding an `/extract` endpoint to the existing relay server (which already handles WebSocket sync, enrollment, token issuance, and pool endpoints) is the most natural place. Alternatively, it can be a separate container (extract service in Docker Compose) for better isolation and scaling.

4. **Swappable via config.** The `FlyerExtractor` interface already supports this. A `RelayExtractor` class simply POSTs to the relay's extract endpoint. A `LocalOllamaExtractor` class (for development) calls Ollama directly.

### MVP (the 20% that gets 80% of value)

1. Build `RelayFlyerExtractor` client class that POSTs the EXIF-stripped image URI to the relay's `/extract` endpoint
2. On the relay, add a minimal `/extract` endpoint that sends the image to Qwen VL Max API (Alibaba — ~$0.005/image) or Ollama
3. Parse the JSON response into `ScannedFlyerPrice[]` array
4. Wire it into the pipeline via the `FlyerExtractor` interface

**Do NOT build in v1:**
- Claude escalation for low-confidence pages (add in v2)
- Multi-page flyer parsing (just handle single pages)
- PDF flyer support (image captures only)
- Crowd-sourced training data collection

### What it costs

- **Effort**: ~3-5 days of focused work (client extractor class + relay endpoint + parsing)
- **Money**: ~$0.005/image for Qwen VL Max, or $0 (self-host with Ollama on existing hardware)
- **Complexity**: Moderate. The relay gets one more endpoint. The client swaps one line (`new MockExtractor()` → `new RelayExtractor(config)`).

### What it blocks

**Can ship without it.** The mock extractor is wired in; the app works end-to-end with manual price entry. This feature is the big-value-add for flyer scanning, not a blocking dependency.

---

## Gap 2: IP-Strip Proxy / OHTTP for Community Pool

### Recommended approach: **Option (c) — Separate origin + honest documentation for v1. Plan OHTTP for v2.**

Specifically:
- Deploy the token issuer and pool server on a **separate origin** (e.g., `token.groceryapp.example.com` and `pool.groceryapp.example.com`) so they're already isolated by browser Same-Origin Policy
- Document clearly: *"The pool server sees your IP address in TCP connections. In a future release, OHTTP will proxy through an independent relay operator. For self-host deployments, the IP never leaves your network. For community pool use, treat this as an honest 'family-grade privacy' — not anonymity."*
- For v2, implement full OHTTP (RFC 9458) with a third-party relay operator

### Why this approach

1. **Full OHTTP (option a) is premature complexity.** It requires (a) finding/operating an independent relay operator, (b) implementing the OHTTP protocol stack on client and server, (c) dealing with the performance overhead of multi-hop proxying. This is 2-3 weeks of work for something that doesn't block shipping.

2. **IP-strip reverse proxy (option b) is theater.** The relay server operator can trivially log IPs before stripping them. A reverse proxy that "promises" not to log is an operational promise, not a technical guarantee. It adds complexity without real privacy improvement over option (c).

3. **A separate origin (option c) is honest and practical.** The token issuer on one domain, pool server on another — same TCP/IP visibility, but at least they're not trivially linked by cookie/localStorage. Users self-hosting get full IP privacy. Community pool users get honest disclosure.

4. **Accepting current state (option d) is reasonable for launch** but the separate origin is trivially cheap to implement and gives a slightly better story.

### What it costs

- **Effort**: ~2 hours to configure DNS + nginx/Caddy for separate origins. ~30 minutes to write the documentation.
- **Money**: Zero (both origins can run on the same VPS with different subdomains).
- **Complexity**: Negligible.

### What it blocks

**Does not block shipping.** Self-host users have no IP concern. Community pool users are buying into a managed service; honest disclosure covers the gap. OHTTP can be added in a future release when there's a sufficient user base to justify the investment.

---

## Gap 3: Unit Tests for Price-Store Merge and Stop-Optimizer Math

### Recommended approach: **Write 20 targeted tests covering edge cases. ~2 hours of work.**

The two functions under test:

### 3a. `loadPricesForAllStores` (in `price-store.ts`, lines 146–181)

This is a Zustand store action. It iterates over `storeIds`, calls `priceRegistry.getAllPrices()` for each, and merges results into both `prices` (flat map) and `perStorePrices` (nested map).

**Tests that matter (not tautologies):**

| # | Test | Why it matters | Tautology risk |
|---|------|----------------|----------------|
| 1 | **Empty storeIds array** → state unchanged | Silent bug if the action doesn't return early | Low — verifies no-op path |
| 2 | **Single store, single item** → correct merge into both `prices` and `perStorePrices` | Basic round-trip | **Yes, borderline** — but validates the data structure shape |
| 3 | **Multiple stores, overlapping items** → `prices` has latest; `perStorePrices` has per-store breakdown | Critical for stop-optimizer correctness | Low — this is the main use case |
| 4 | **One store returns results, another returns empty** → partial merge still works | Common real-world scenario | Low |
| 5 | **All stores return empty** → no state change | Edge case with real-world relevance | **Yes, minor** |
| 6 | **Item appears in store A but not store B** → store B has no entry for that item, store A does | Correctness of per-store data | Low |
| 7 | **`pricingOptedIn` is false** → early return, no API calls | Privacy gate | Low — validates privacy contract |
| 8 | **Exception in one store's fetch** → other stores still merge, error state set | Resilience | Low |
| 9 | **Zero-price items** → included in results (price zero is valid, e.g., free item) | Edge case | Low — subtle bug risk |
| 10 | **Concurrent calls to `loadPricesForAllStores`** → no race condition in state | Multi-list scenario | Low |

**Tests that ARE tautologies (skip):**
- "distributive property of merge" — testing that `{ ...a, ...b }` works as expected
- "item name matches itself" — testing `priceMap.get(item.name)`
- "storeIds map correctly" — testing `.map()` behavior

### 3b. `computeStopProposals` (in `stop-optimizer.ts`)

This is a pure function. No mocks needed — just pass `items`, `perStorePrices`, `storeNameMap` and assert on the output.

**Tests that matter:**

| # | Test | Why it matters | Tautology risk |
|---|------|----------------|----------------|
| 1 | **Fewer than 2 stores** → returns `[]` | Early return guard | Low |
| 2 | **2 stores, simple prices** → single cheapest is 1-stop, adding second reduces cost | Core algorithm correctness | Low |
| 3 | **Multiple items, different stores cheapest per item** → greedy picks correct sequence | Algorithm correctness | Low |
| 4 | **Adding a store doesn't reduce cost** → algorithm stops early | Optimization correctness | Low |
| 5 | **All items cheapest at one store** → only 1-stop proposal returned | Algorithm shouldn't add stores that don't help | Low |
| 6 | **Zero-price items** → included in calculations | Edge case | Low |
| 7 | **Items not found at any store** → skipped in total cost | Real-world scenario | Low |
| 8 | **Sort ties** → stable ordering, deterministic results | Determinism expectation | **Minor** |
| 9 | **Single item, multiple stores** → correct 1-stop total | Minimal case | **Yes, borderline** |
| 10 | **Large number of stores** → algorithm completes in reasonable time | Performance | Low — but set a time limit, not a value assertion |

**Tests that ARE tautologies (skip):**
- "`Math.min` returns the minimum" — testing JavaScript primitives
- "filter removes duplicates" — testing `.some()` behavior
- "`Object.keys()` returns keys" — testing built-in functions

### Test structure recommendation

Create two test files:
- `src/pricing/__tests__/price-store-merge.test.ts` — tests `loadPricesForAllStores` in isolation by instantiating the store and mocking `priceRegistry.getAllPrices`
- `src/pricing/__tests__/stop-optimizer.test.ts` — pure function tests for `computeStopProposals`

### What it costs

- **Effort**: ~2 hours total (1 hour for price-store, 1 hour for stop-optimizer)
- **Money**: Zero
- **Complexity**: Near-zero. Pure function testing and Zustand store mocking are well-understood patterns.

### What it blocks

**Does not block shipping.** These functions are currently working (no known bugs) and low security risk. Tests reduce the risk of regression during future changes. The biggest risk is an edge case with zero-price items causing a `NaN` propagation in `savingsVsOneStop` calculation — worth a specific test.

---

## Gap 4: Professional Crypto Review

### Recommended approach: **Accept the risk for v1 + publish for open-source community audit**

Specifically:
1. **For v1 launch**: Accept the current state. The cryptosystem choices are standard and well-audited pieces:
   - Blind RSA tokens use `@cloudflare/blindrsa-ts` (Cloudflare-audited implementation of RFC 9474)
   - Ed25519 signatures use `tweetnacl` (Bernstein's audited implementation, used in WhatsApp, Signal)
   - Encryption envelope uses XChaCha20-Poly1305 via `tweetnacl.secretbox` (standard, audited)
   - The HMAC-based blind token scheme (v1 approximation) is documented as such in the implementation plan
2. **Publish the repo publicly** (it's already on GitHub per README) with a `SECURITY.md` that invites responsible disclosure
3. **Set up a GitHub Security Advisory workflow** for vulnerability reporting
4. **For v1.1 (or when first external contributor joins)**: Budget $3K–$5K for a focused audit of exactly two things:
   - The blind RSA token flow (issuer → client → pool, focusing on the unlinkability guarantee)
   - The encryption envelope format and key derivation

### Why this approach

1. **A professional audit is $15K–$50K** for a meaningful scope. For a family app that stores no PII (by design — see `ac12-no-pii.test.ts`), this is disproportionate. The realistic threat is someone gaining access to your grocery list — not a nation-state attack.

2. **The pieces are already well-audited building blocks.** The risk isn't in `tweetnacl.secretbox` — it's in how the pieces are wired together. A focused review of the wiring is worthwhile but not pre-launch critical.

3. **Bug bounty programs** require public engagement, a clear scope, and usually $500+ per valid finding. For a family app with no paying users, this is premature. GitHub's Security Advisory workflow achieves the same discovery channel at zero cost.

4. **"Accept and fix as found"** is the pragmatic default for any v1. The app has no user authentication, no payment processing, no personal data exposure. The worst crypto failure is someone eavesdropping on your shared grocery list — which is inconvenient, not catastrophic.

### What it costs

- **v1 cost**: $0 (accept risk, document honestly)
- **v1.1 cost**: $3K–$5K (focused audit of blind RSA flow + encryption envelope)
- **Ongoing**: 30 min to set up `SECURITY.md` and advisory workflow

### What it blocks

**Does not block shipping.** The app is designed for family use. The encryption is defense-in-depth. Even without the relay's encryption, a self-hosted relay on local network has negligible attack surface. Ship v1, get real-world usage, then audit before inviting external contributors.

---

## Summary: Shipping Order

| Gap | Ship blocker? | When to do | Assigned to |
|-----|--------------|------------|-------------|
| **3. Tests** (price-store + stop-optimizer) | No | **Next** (~2 hours) | Developer |
| **1. Vision extractor** | No | **This sprint** (3-5 days) | Developer + ML engineer |
| **2. IP-strip proxy** | No | **Before community pool launch** (~2 hours) | DevOps |
| **4. Crypto review** | No | **v1.1** (after first 100 users) | External auditor + security team |

### Recommended immediate actions (in order):

1. **Write the 20 tests** for price-store merge and stop-optimizer (2 hours, done today)
2. **Build the `RelayFlyerExtractor`** class + relay `/extract` endpoint with Ollama backend (3-5 days)
3. **Deploy token issuer + pool on separate subdomains** with docs (2 hours)
4. **Set up SECURITY.md + GitHub Advisory** workflow (30 min)
5. **Launch v1** (family self-host + invite-only community pool)
6. **Budget for blind RSA + encryption audit** before v1.1 (plan for $3-5K)
