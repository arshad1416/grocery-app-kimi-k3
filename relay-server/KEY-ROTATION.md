# Key Rotation Log

## Rotation #1 — 2026-05-30

### Reason

The original issuer keypair was committed to git history and is publicly recoverable from the repository. All keys generated prior to this rotation are considered **burned** and must not be used.

### What Was Done

1. Deleted the old keypairs from `keys/issuer-private-key.pem` and `keys/issuer-public-key.pem`
2. Generated a new 2048-bit RSA keypair using the Blind RSA scheme (RSABSSA-SHA384-PSS-Randomized):
   ```bash
   cd relay-server && node tokens/blind-rsa-keygen.js
   ```
3. Updated `.gitignore` to ensure `keys/` and `*.log` are excluded from future commits

### Impact

- **All outstanding relay tokens** signed with the old key are **invalid** after this rotation.
- **All pool verifiers** must be updated with the new public key (`keys/issuer-public-key.pem`).
- Clients must request new tokens from the issuer.

### How to Rotate Again

1. Delete the old key files:
   ```bash
   rm relay-server/keys/issuer-private-key.pem relay-server/keys/issuer-public-key.pem
   ```
2. Generate new keys:
   ```bash
   cd relay-server && node tokens/blind-rsa-keygen.js
   ```
3. Distribute the new public key to all pool verifiers.
4. Update this log with the date and reason.
