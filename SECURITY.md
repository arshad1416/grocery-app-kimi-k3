# Security Policy

StopHop (GroceryApp) is an end-to-end-encrypted family grocery app. Security
reports are very welcome.

## Reporting a Vulnerability

- Preferred: open a **GitHub Security Advisory** (Security → Advisories →
  Report a vulnerability) on this repository.
- Or email **security@groceryapp.app**.
- Please do not open public issues for vulnerabilities before a fix ships.

You can expect an acknowledgement within 7 days. There is no paid bounty
program at this time; credit is given in release notes unless you prefer
otherwise.

## Scope

- `GroceryApp/` — React Native client (crypto in `src/crypto/`,
  `src/identity/`, sync encryption in `src/sync/y-websocket.ts`)
- `relay-server/` — zero-knowledge sync relay, RFC 9474 blind-RSA token
  issuer, anonymous price pool
- Threat model: `GroceryApp/docs/threat-model.md` (read this first — several
  limitations, e.g. no forward secrecy and honest-but-curious relay
  assumptions, are documented there and are known)

## Cryptography Overview (for reviewers)

- AEAD: XChaCha20-Poly1305 (libsodium), fresh random 24-byte nonce per
  message, per-field AAD context binding
- KDF: Argon2id13 (MODERATE: ops=3, mem=256MB) for passphrases; 128-bit
  recovery seed → BLAKE2b for recovery phrases (BIP39 wordlist)
- Identity: Curve25519 device keys, Ed25519-signed invites,
  `crypto_box_seal` for family-key handoff
- Anonymous contributions: RFC 9474 RSABSSA-SHA384-PSS-Randomized
  (`@cloudflare/blindrsa-ts`), issuer/pool key separation, fail-closed pool
