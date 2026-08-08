# Threat Model — GroceryApp

## Assets Protected
- Grocery list content (items, quantities, notes, categories)
- Price query habits (what you buy, where you shop)
- Family membership graph (who's in your family)
- Device identity keys (private keys that authenticate devices)

## Adversary Model

### 1. Relay Server Operator (honest-but-curious)
- Sees: encrypted ciphertext, opaque deviceId, familyId, listId, timestamps
- Cannot read: item names, quantities, notes, prices, family member identities
- Could: correlate usage patterns by timing/lists accessed (metadata leak)
- Mitigation: all content encrypted client-side; relay only routes ciphertext
- **Persistence**: the relay is not purely ephemeral — it persists ciphertext
  updates and enrollment state to disk so offline devices can catch up.
  Stored updates are aged out after a retention window (`UPDATE_TTL_MS`,
  default 30 days). Everything persisted is ciphertext or opaque tokens;
  a relay disk image never contains plaintext list content.
- **Flyer extraction caveat**: the optional flyer-scan feature sends the
  flyer image itself (EXIF-stripped, but readable by the relay) to the
  extract endpoint. It is NOT end-to-end encrypted. TLS protects it only
  when the relay URL is `wss://`; the shipped default is `ws://localhost`
  (`src/config/settings.ts:32`), so on the default path the image crosses
  the network in the clear. See `src/pricing/relay-extractor.ts` and the
  AC-11 scope note.
- **Voice-assistant key custody**: the relay holds ONLY the assistant RSA
  public key, never the private key (generated out of band by
  `assistant-keygen.js`, private half provisioned only to the webhook). The
  relay cannot decrypt the sealed family keys it stores. The webhook — a
  separate trust domain — transiently decrypts list content while answering a
  voice request; that exposure is inherent to any cloud voice assistant and is
  disclosed, not claimed away. (Feature disabled in v1 regardless.)

### 2. Network Eavesdropper
- Sees: encrypted WebSocket traffic between client and relay
- Cannot read: any content (TLS + end-to-end encryption)
- Mitigation: TLS between client and relay; XChaCha20-Poly1305 between devices

### 3. Compromised Device
- Sees: plaintext list content, device keys, family encryption key
- Can: read, modify, delete list items; impersonate the device
- Mitigation: device OS encryption (iOS Keychain / Android Keystore); family key rotation
- Unmitigated: a compromised device has full access — trust your family members

### 4. Instacart / Third-Party Price API (managed tier only)
- Sees: item names and store IDs (only if Instacart adapter is implemented and enabled)
- Can: build purchase profiles of users
- Mitigation: Instacart adapter is opt-in, gated behind managed tier, clearly disclosed

### 5. Scraped Website Operators (self-host only)
- Sees: grocery website traffic from your self-hosted scraper
- Can: identify your IP address, see which items you're price-checking
- Mitigation: scraping adapter is isolated, flagged, self-host only, and requires explicit enable

## Trust Assumptions
- libsodium is correctly implemented (XChaCha20-Poly1305, Argon2id, Ed25519)
- Device OS encryption protects WatermelonDB at rest
- Family members are trusted with the shared encryption key
- The relay server routes messages correctly (no dropping/misrouting)
- TLS is properly configured between clients and relay

## Boundaries (Out of Scope)
- Side-channel attacks (timing, power analysis)
- Physical device theft (covered by device OS security)
- Compromised npm packages (supply chain — use lockfiles and audit)
- Wireless/Bluetooth attacks on local relay
- Social engineering attacks on family members

## Mitigations Summary
- **Encryption at rest**: libsodium XChaCha20-Poly1305, keys in expo-secure-store
- **Encryption in transit**: XChaCha20-Poly1305 end-to-end, plus TLS whenever
  the relay URL is `wss://`. The default relay URL is `ws://localhost`
  (`src/config/settings.ts:32`), so a LAN self-host has no TLS layer — the
  payload is still ciphertext, but the routing metadata below is on the wire
  in the clear
- **Content-blind relay**: relay sees only ciphertext *plus* routing metadata
  (familyId, listId, deviceId, timing, size), and persists it. Not
  zero-knowledge — see the operator section above
- **Per-field AAD binding**: each encrypted field is bound to its context (list, field type)
- **No PII**: device ID is an opaque public key; no email, phone, or name anywhere
- **Passwordless**: Ed25519 keypairs for authentication; no passwords to leak
- **Opt-in pricing**: pricing is off by default, with privacy disclosure on first enable
- **Isolated scraping**: scraping adapter is self-host only, clearly flagged, isolated
- **Key recovery**: 12-word BIP39-*style* recovery phrase (standard 2048-word
  wordlist and SHA-256 checksum, no BIP32 derivation — `src/identity/recovery.ts`)
  + social re-invite
- **No analytics**: zero third-party analytics or ad SDKs

## Known Gaps
- **Metadata leakage**: relay server can see which devices talk to which lists (timing correlation)
- **No forward secrecy**: if a device key is compromised, past messages are decryptable
- **Key rotation**: no mechanism to rotate the family encryption key without re-creating the family
- **Supply chain**: libsodium-wrappers, yjs, and other dependencies could be compromised upstream
- **Denial of service**: a malicious family member could corrupt shared Yjs documents
- **Active-attacker relay (malicious, not just curious)**: the threat model assumes an
  honest-but-curious relay. A fully malicious relay could substitute public keys during
  enrollment and receive the sealed family key (machine-in-the-middle on the invite
  flow). Mitigation today is the out-of-band QR handoff (invites are scanned in person
  and Ed25519-signed by the inviter); full mitigation (key fingerprint verification UI
  or MLS) is deferred past v1.
- **No envelope versioning**: `EncryptedData {ciphertext, iv, tag}` carries no version
  byte. If crypto parameters ever change, old ciphertexts are indistinguishable from
  new ones — any future algorithm migration must add versioning first.
- **Ed25519 signing keys are derived from the device Curve25519 secret** (first 32
  bytes as seed). Cross-primitive key derivation is not ideal hygiene; acceptable here
  because the seed is hashed inside Ed25519 keygen, but a future device-identity
  redesign should use independent keys.