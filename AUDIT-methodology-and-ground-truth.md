# Orchestrator-verified ground truth (independent of subagents)

Verified directly by the orchestrator against clean clones. Where a subagent
finding conflicts with anything here, **this file wins** — these were checked
against pristine clones with commands shown.

## 1. Repo relationship: independent lineages, NOT fork-and-drift

- `git merge-base` between the two `main` branches returns **nothing**.
- **0 SHAs in common** between the two `main` branches.
- pantryrun: root `7d4148e` (2026-07-27 23:38), HEAD `a0d11a4` (2026-08-08 12:52), **17 commits**, 1 author.
- grocery-app: root `630e58c` (2026-05-28 23:02), HEAD `f11a4b3` (2026-07-28 23:05), **162 commits**, 2 author identities.

Never describe one as "N commits behind" the other.

pantryrun's root commit is literally `chore: establish A/B/C comparison baseline`, and the two
repos worked the **same problems in parallel on 2026-07-28** (both did StopHop→PantryRun rename,
both did an iOS prebuild, both did a credential purge, within hours of each other). This reads as a
deliberate A/B track, not an abandoned fork. pantryrun continued 11 days past grocery-app's last commit.

## 2. CONTAMINATION WARNING — an artifact I introduced, not a repo property

I ran `git fetch ../grocery-app main:ga-main` inside the `scratchpad/pantryrun` clone during
orientation. That injected grocery-app's 162 commits **and 22 tags** into the pantryrun working clone.

**Any subagent finding that pantryrun contains grocery-app history, carries tags v1.00–v1.28, or has
121 commits unreachable from main, is a FALSE POSITIVE caused by me.** It must be struck from the report.

Proof from a pristine re-clone (`scratchpad/pr-clean`):
- `git ls-remote https://github.com/arshad1416/pantryrun.git` → **only `refs/heads/main`, zero tags**.
- clean clone: `rev-list --all --count` = **17**, `git tag` = **empty**.
- grocery-app remote genuinely has **22 tags**; pantryrun has **0**.

Contamination was removed from `scratchpad/pantryrun` (`branch -D ga-main`, all tags deleted,
`reflog expire`, `gc --prune=now`) → back to 17 commits, `630e58c` no longer present.
The dimension-2 agent independently noticed the stray `ga-main` ref and re-scoped its scan to `main`.

Identical tag names resolving to identical SHAs across repos was **also** this artifact.

## 3. Secret exposure: both repos are clean of live credentials

> **Partially superseded — see AUDIT report §2.** This section was written *before* the
> workflow returned, and its framing of the two histories was wrong in both directions.
> The corrected finding: grocery-app's history **was** rewritten (the `git-filter-repo`
> marker `***REMOVED-REVOKED-TURSO-TOKEN***` survives in **18 blobs**, which I confirmed
> directly), and pantryrun's squashed baseline **never carried the credential at all**.
> So "grocery-app has 162 unrewritten commits" below is incorrect — disregard it.
> The scan *results* in this section stand unchanged; only the narrative around them was wrong.

gitleaks (default ruleset, allowlist bypassed via `[extend] useDefault = true`) over full history:

| repo | commits scanned | findings | verdict |
|---|---|---|---|
| pantryrun (clean clone) | 17 | 2 | both false positives |
| grocery-app | 164 | 2 | both false positives |

Both repos flag the **same two files**, and both are false positives:
- `SECURITY.md:33` — crypto documentation prose (AEAD/KDF/Argon2id description), no secret.
- `GroceryApp/__tests__/ac17-scannable-qr.test.ts:8` — literal fixture `const token = 'abc123-def456'`.

Targeted credential hunt across **all** reachable history:
- pantryrun: **no** `libsql://` URLs, **no** JWT-shaped blobs. Purge claim holds for visible history.
- grocery-app: one JWT-shaped string in `GroceryApp/__tests__/settings-schema.test.ts:29`.
  **Not a real credential** — 44 chars total, header decodes to `{"alg":"EdDSA"}` (the Turso header
  shape) but the payload is undecodable garbage. Paired with placeholder `https://example-db.turso.io`.
  It is a deliberate synthetic fixture.
- grocery-app `GOAL_PROMPT_NOTES.md` mentions a `libsql://stophop-…` **hostname** (not a credential)
  in prose explaining DB naming. Hostname disclosure only; low severity at most.

Caveat: this proves nothing about what was exposed *before* the rewrites — only that neither repo's
**current reachable history** carries a live secret. GitHub-side dangling objects are out of scope here.

## 4. Legacy-credential pruning: both have it, opposite designs

Both repos wipe credentials that earlier builds persisted into SecureStore. The designs differ:

- **pantryrun** `GroceryApp/src/config/settings.ts:140` `stripRemovedFields()` — **denylist**:
  deletes any key with prefix `turso`. Misses any future/other abandoned credential field.
- **grocery-app** `GroceryApp/src/config/settings.ts:191` `pruneUnknownSettings()` — **allowlist**:
  keeps only the 25 keys in `KNOWN_SETTINGS_KEYS` (line 145), drops everything else, re-persists only
  when something was removed. Strictly stronger: catches *any* abandoned field, not just `turso*`.

grocery-app's allowlist has a real failure mode — add a field to `AppSettings` but forget
`KNOWN_SETTINGS_KEYS` and it is silently pruned off every device on next launch. grocery-app guards
exactly that with `__tests__/settings-schema.test.ts`, which cross-checks the two lists.
**pantryrun has no equivalent guard test** (no `pruneUnknownSettings`/`KNOWN_SETTINGS_KEYS` in its src).

Consistency check passed: `tursoEnabled` IS in grocery-app's allowlist (line 169) while `tursoUrl`
and `tursoToken` are not — so the flag survives and the two credential fields are pruned. Intended.

Posture difference worth noting: grocery-app `DEFAULT_SETTINGS` sets **`tursoEnabled: true`**
(settings.ts:48); pantryrun removed the Turso path entirely. grocery-app moved the catalog behind the
relay in `c1cc04c`, so this likely means relay-backed catalog rather than direct client DB access —
dimension 6 should confirm which.

## 5. Relay-server: grocery-app lacks pantryrun's hardening commit

pantryrun `7fb69b5` ("fix 7 launch-blocking defects", +869/−191 across 13 files) has **no counterpart**
in grocery-app. Files that commit added which are **absent from grocery-app/relay-server/**:
`lib/collect-body.js`, `hardening.test.js`, `verify-hardening.js`.

grocery-app has relay files pantryrun lacks: `catalog/` (Turso-backed catalog server) and `catalog.test.js`.

Whether grocery-app independently fixed the same 7 defects some other way is dimension 1's job —
absence of the files is not by itself proof the defects are present.

## 6. Byte-identical files despite heavy divergence

`README.md` (4009 B) and `BLIND-TOKEN-IMPLEMENTATION-PLAN.md` (24209 B) are byte-identical across both
repos while 110 shared files differ. At most one README can be accurate about its own repo.

## Known filename renames — do NOT report as coverage gaps

`persist-error-surfacing` ~ `persist-failure-surfacing`; `recovery-first-run` ~ `first-run-recovery-backup`;
`free-tier-posture` ~ `v1-free-posture`; `turso-gated-off` ~ `catalog-gate`; `StopHop` ~ `PantryRun`.

---

# Orchestrator re-verification of the headline findings

After the 15-agent workflow returned, the orchestrator independently re-derived the
top findings rather than taking them on trust. Results below. All five held.

## C1 — blind-token malleability (CRITICAL, both repos): CONFIRMED EMPIRICALLY

Code path confirmed by reading both files: signature verification runs over the decoded
bytes (`_blindRsaSuite.verify(_publicKey, parsed.signature, parsed.nonce)`), while
single-use enforcement receives the raw transport string
(`usedTokensStore.checkAndMark(tokenStr)`) — pantryrun `pool/pool-server.js:252,280`,
grocery-app `pool/pool-server.js:261,289`. `parseToken` decodes with
`Buffer.from(encoded, 'base64')` (pantryrun `:107`), which Node accepts leniently.

Executed against 288 random bytes (256-byte signature ‖ 32-byte nonce):

| token string variant | decodes to identical 288 B | spent-set key |
|---|---|---|
| standard base64 | yes | `f639d243dd636e2e` |
| base64url (`+/` → `-_`) | yes | `e17813d5ad98c7a5` |
| padding stripped | yes | `f639d243dd636e2e` |
| whitespace injected mid-string | yes | `61d0454df7108047` |
| newline injected | yes | `ee61b0e0cd2932bc` |

Five distinct strings, one signed payload, **four distinct spent-set keys**. Each
non-colliding variant is a free replay. (Standard and padding-stripped coincide only
because 288 is divisible by 3, so the encoding carries no `=` padding.)

## C5 — pantryrun offline-edit loss (CRITICAL, pantryrun): CONFIRMED EMPIRICALLY

The NaN chain reproduces exactly as the report describes. With `abytes === undefined`:
`cipherWithTag.length - abytes` is `NaN`; `slice(0, NaN)` returns a **0-length** array;
`slice(NaN)` returns the **whole 80-byte** buffer. Base64 of the empty array is `""`,
which is falsy, so `offline-queue-store.ts:97`
(`if (!payload?.ciphertext || !payload?.iv || !payload?.tag) continue;`) drops the row.
`offline-queue-store.ts` is **byte-identical between the repos**, so the guard is not the
differentiator — line 433 is.

Corroboration for the runtime premise the workflow could not execute (no `node_modules`):
pantryrun's own `src/crypto/index.ts:61` already hardcodes `const ABYTES = 16;` with the
same rationale, and uses it at `:214-215`. The author had already concluded the constant
is unavailable on device; `y-websocket.ts:433` was simply missed. grocery-app fixed the
same line at `:441` with an eight-line comment naming the exact failure mode.

## C2 — grocery-app relay cannot boot (CRITICAL, grocery-app): CONFIRMED

`relay-server/Dockerfile` copies exactly two sources — `package.json` (`:15`) and
`server.js` (`:20`). `server.js` has module-scope requires of `./tokens/used-tokens-store`
(`:26`), `./pool/store` (`:237`), `./pool/pool-server` (`:238`) and `./seed-pool` (`:239`).
None of those paths enter the image. pantryrun's Dockerfile is an explicit allowlist at
`:25-29` (`server.js seed-pool.js encrypted-store.js` plus `lib/ tokens/ pool/ extract/`).

## H4 — `/stats` (grocery-app): CONFIRMED

grocery-app `server.js:688` writes `200` immediately with no auth check and enumerates
per-family `deviceIds` (12-char prefixes). pantryrun `server.js:809` removes the CORS
header, requires `Bearer`, validates against `enrolledDevices` with an expiry check, and
returns aggregate counts only — no per-family enumeration.

## H6 — gitleaks allowlist hole (grocery-app): CONFIRMED EMPIRICALLY

gitleaks OR-combines `paths` and `regexes` inside one `[[allowlists]]` block unless
`matchCondition = "AND"` is set, so `paths = ['''^GroceryApp/__tests__/''']` exempts the
whole directory. Tested by planting an identical Turso-shaped JWT in two locations of a
throwaway repo carrying grocery-app's real `.gitleaks.toml`:

| location | grocery-app config | default rules |
|---|---|---|
| `evil-at-root.ts` | **detected** | detected |
| `GroceryApp/__tests__/evil.test.ts` | **suppressed** | detected |

A live credential committed anywhere under `GroceryApp/__tests__/` passes grocery-app's
CI secret scan silently. This is why step 4 of Tier 0 says strip the `paths` keys *before*
porting the config — copying it as-is imports the hole into pantryrun.

## Verification scoreboard

| finding | severity | repos | orchestrator verdict | method |
|---|---|---|---|---|
| C1 token malleability | critical | both | CONFIRMED | executed |
| C5 offline-edit loss | critical | pantryrun | CONFIRMED | executed + corroborated |
| C2 relay cannot boot | critical | grocery-app | CONFIRMED | code read |
| H4 `/stats` exposure | high | grocery-app | CONFIRMED | code read |
| H6 gitleaks hole | high | grocery-app | CONFIRMED | executed |

Workflow totals: 15 agents, 0 errors, 7 dimensions, **56 findings survived adversarial
verification, 3 refuted** (11 critical / 11 high / 13 medium / 14 low / 7 info).

---

# Post-audit findings discovered during the fix phase

Found only because dependencies were actually installed. A static audit could not have reached these.

## N1 — `react-native-iap` is imported but undeclared (was: critical, now fixed by G5)

`src/config/entitlements.ts:314,373` do `await import('react-native-iap')`. The package appears in
neither `package.json` nor `node_modules`. Because the import is lazy the app boots normally and throws
the instant a user taps Upgrade or Restore — the entire Plus tier, the product's paid differentiator,
was dead in the build already in Play closed testing. It was also the single failing suite in the repo
(`entitlements.test.ts` failed to compile).

## N2 — `crypto_scalarmult_base` is absent on device (latent, same class as C5)

`src/identity/family.ts:424` calls `sodium.crypto_scalarmult_base(deviceSecretKey)` inside
`decryptKeyFromDevice`, to derive the device public key that `crypto_box_seal_open` needs.

Verified against the installed package:
- **absent** from `lib/typescript/lib.native.d.ts` (the on-device surface)
- present only in the JS-only `lib/typescript/lib.d.ts:94`
- `typeof require('react-native-libsodium').crypto_scalarmult_base` → `undefined`

So on device this call throws. **Severity is latent, not critical: `decryptKeyFromDevice` currently has
zero callers in `src/`.** It is an exported identity API that will throw the moment the multi-device
family-key handoff flow is wired up.

The fix is not a polyfill — `src/identity/device.ts:133` already exposes `getDevicePublicKey()` from the
stored keypair, so deriving the public key from the secret key is unnecessary. Pass the stored public key.

This is why the L9 native-API-fidelity guard must NOT waive `crypto_scalarmult_base`: the waiver would
make the guard ship green over a live instance of the exact bug class it exists to catch.

## Ownership gaps the fan-out could not route itself

Recorded so they are not lost between goals:

- **H11 (token rate limiting keyed on a self-asserted deviceId)** — assigned to G1, but the two handlers
  live in `relay-server/server.js`, which G2 owns. G1 correctly refused to edit a file it did not own and
  reported it instead. Needs an explicit owner.
- **N2 above** — `src/identity/family.ts` is owned by no goal this round.
- **L4 / L5** (sync-vs-master key separation never applied; `verifyAndGetMasterKey` returns the key
  without checking the passphrase on the recovery path) — cross-cutting `src/crypto` + `src/identity`
  changes, deliberately deferred out of the parallel round to avoid two agents fighting over crypto files.
