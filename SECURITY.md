# Security Policy

PantryRun (source directory `GroceryApp/`) is a family grocery app whose list
content is end-to-end encrypted. Security reports are very welcome.

## Reporting a Vulnerability

- Open a **GitHub Security Advisory** (Security → Advisories → Report a
  vulnerability) on this repository. This is the only channel we monitor;
  there is no security email address.
- Please do not open public issues for vulnerabilities before a fix ships.

You can expect an acknowledgement within 7 days. There is no paid bounty
program at this time; credit is given in release notes unless you prefer
otherwise.

## Scope

- `GroceryApp/` — React Native client (crypto in `src/crypto/`,
  `src/identity/`, sync encryption in `src/sync/y-websocket.ts`)
- `relay-server/` — content-blind sync relay, RFC 9474 blind-RSA token
  issuer, anonymous price pool. "Content-blind" is deliberate wording: the
  relay only ever handles ciphertext for list data, but it does see and
  persist routing metadata (familyId, listId, deviceId, relay tokens,
  enrollment state, connection timing and update sizes), and the optional
  flyer-extract endpoint receives the flyer image in plaintext. Do not read
  "zero-knowledge" into it.
- Threat model: `GroceryApp/docs/threat-model.md` (read this first — several
  limitations, e.g. no forward secrecy and honest-but-curious relay
  assumptions, are documented there and are known)
- Group key rotation is not implemented; see
  `GroceryApp/docs/key-rotation-known-issue.md` before reporting it

## Cryptography Overview (for reviewers)

- AEAD: XChaCha20-Poly1305 (libsodium), fresh random 24-byte nonce per
  message. AAD context binding: stored fields bind to a per-field context
  string (`src/storage/hydrate.ts`), sync updates bind to the `listId`
  (`src/sync/y-websocket.ts`)
- KDF: Argon2id13 (MODERATE: ops=3, mem=256MiB — `OPSLIMIT`/`MEMLIMIT` in
  `src/crypto/index.ts`) for passphrases; 128-bit recovery seed → BLAKE2b
  (`crypto_generichash(32, seed)`, `src/identity/recovery.ts`) for the master
  key, with the seed itself rendered as a 12-word BIP39-*style* mnemonic (the
  standard 2048-word English wordlist and a SHA-256 checksum, but not a BIP32
  derivation path)
- Note for auditors: `src/crypto/index.ts` hardcodes the tag length
  (`ABYTES = 16`) rather than reading it from the binding, because
  `react-native-libsodium`'s native surface does not export
  `crypto_aead_xchacha20poly1305_ietf_ABYTES`. The value is correct for
  Poly1305; the constant is deliberate, not an oversight
- Identity — **two distinct keys, both reachable through a field named
  `deviceId`**; do not conflate them:
  - The **canonical deviceId** is the base64 X25519 public key from
    `crypto_box_keypair` (`src/identity/device.ts:55,63`). This is what
    `getDeviceId()` returns, what `FamilyMembership.deviceId` stores
    (`src/identity/family.ts`, `acceptFamilyInvite` / `ensureFamilyMembership`),
    and what is sent to the relay at enrollment (`src/screens/PairingScreen.tsx:121` →
    `enrollWithRelay`), so it is the identifier the relay sees and persists.
  - Invites carry a **separate Ed25519 identity**, derived deterministically
    from the same box secret via `crypto_sign_seed_keypair`
    (`src/identity/family.ts`, `createFamilyInvite`). Inside an invite-token
    payload the `deviceId` field is that Ed25519 public key, and
    `verifyFamilyInvite` uses it directly as the `crypto_sign_verify_detached`
    key — no re-derivation.
  - Consequence for reviewers: an invite signature will **not** verify against
    the relay-visible deviceId — that value is a Curve25519 (X25519) point,
    not the Ed25519 signing key.
- Family-key handoff uses `crypto_box_seal` / `crypto_box_seal_open` against
  the joining device's X25519 public key (`src/identity/family.ts`,
  `encryptKeyForDevice` / `decryptKeyFromDevice`)
- Anonymous contributions: RFC 9474 RSABSSA-SHA384-PSS-Randomized
  (`@cloudflare/blindrsa-ts`), issuer/pool key separation, fail-closed pool
