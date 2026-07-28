# Group Key Rotation — Known Limitation (v1.0)

## Summary

The shared family symmetric key used for encrypting grocery data **does not
rotate** when a family member is removed or a device is lost. This is a known
cryptographic limitation in the v1.0 release.

## What This Means

### Current Behavior
- The family key is established during the initial pairing / invite flow
- All members share the same symmetric key for encrypting and decrypting
  grocery data (XChaCha20-Poly1305)
- The key is distributed to new members via anonymous sealing
  (`crypto_box_seal`) during the invite flow

### The Gap
When a member is **removed** from the family:
- Their device still holds the family key in `expo-secure-store`
- They could theoretically decrypt future sync payloads if they capture them
  from the relay server (the sync payloads are encrypted with the family key)

When a device is **lost** or compromised:
- The attacker has the family key in the device's secure storage
- All future and past sync payloads encrypted with that key are vulnerable

### What Is NOT Affected
- **Local data at rest**: Sensitive fields in WatermelonDB are encrypted with
  the master key (derived from the family passphrase), not the family key
  directly. The master key is stored in `expo-secure-store`.
- **Transport security**: The relay server does not see plaintext grocery data.
  All payloads are end-to-end encrypted before leaving the device.
- **Invite tokens**: Each invite is Ed25519-signed with a one-time nonce and
  7-day expiry. Used invites are tracked server-side.

## Why This Is Hard to Fix

Proper key rotation in a multi-device group requires:

1. **Key agreement protocol**: All online devices must agree on a new key
   simultaneously (atomic rotation)
2. **Offline device handling**: Devices that are offline during rotation must
   be brought up to date when they reconnect (forward secrecy requires they
   can't derive the new key from the old one)
3. **Data re-encryption**: All existing encrypted data must be re-encrypted
   with the new key, or the system must support multiple active keys

This is the domain of **Messaging Layer Security (MLS)** — an IETF standard
(RFC 9420) designed exactly for this problem. MLS provides:
- Forward secrecy (compromising a current key doesn't reveal past data)
- Post-compromise security (compromising one key doesn't reveal future data
  after re-keying)
- Asynchronous operations (handles offline devices gracefully)

## Mitigation (v1.0)

For the initial release, the following mitigations are in place:

1. **Remove member = revoke invite**: The `leaveFamily()` function clears
   local membership data. While this doesn't rotate the key, it removes the
   member's access to the sync channel.
2. **Device secure enclave**: Keys are stored in `expo-secure-store` which
   uses the platform's hardware-backed keychain (iOS Secure Enclave / Android
   Keystore).
3. **Limited attack surface**: An attacker needs both the relay token AND the
   family key to decrypt sync payloads. The relay token is bound to a single
   device and expires after 30 days.

## Fix Path (v1.1)

### Option A: MLS (Recommended)
Implement RFC 9420 MLS for the family group. This is the gold standard for
group key management. Libraries:
- `@aspect-build/mls` (JavaScript/TypeScript)
- `openmls` (Rust — could be bridged via native modules)

### Option B: Simple Re-Keying Event (Simpler, Less Robust)
When a member is removed or a device is reported lost:
1. Remaining admin device generates a new family key
2. New key is distributed to all remaining devices via the existing
   `crypto_box_seal` key exchange
3. All devices re-encrypt their local data with the new key
4. Old sync payloads on the relay are invalidated (the relay doesn't store
   them, but they may exist in transit)

This doesn't provide forward secrecy but eliminates the "removed member can
still decrypt" gap.

### Option C: Per-Device Encryption Keys (Hybrid)
Each device encrypts with its own key. Family sharing is implemented via a
key server that distributes per-recipient encrypted copies. Rotation = revoke
the compromised device's key without affecting others.

## Timeline

- **v1.0**: Current state — document limitation, mitigate with secure storage
- **v1.1**: Implement Option B (simple re-keying) as a fast-follow
- **v2.0**: Implement MLS for full forward and post-compromise security

## References

- [RFC 9420 — Messaging Layer Security](https://datatracker.ietf.org/doc/rfc9420/)
- [Signal Protocol Double Ratchet](https://signal.org/docs/specifications/doubleratchet/)
- [Key Rotation Log (relay-server)](../relay-server/KEY-ROTATION.md)
