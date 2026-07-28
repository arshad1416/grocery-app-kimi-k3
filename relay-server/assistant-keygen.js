#!/usr/bin/env node

/**
 * Voice-Assistant RSA Keypair Generator (run OUT OF BAND).
 *
 * Generates the RSA-4096 keypair used for voice-assistant account linking:
 * clients seal the family key to the PUBLIC key; the assistant webhook uses
 * the PRIVATE key to decrypt it transiently while answering a voice request.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ CRITICAL KEY CUSTODY                                                       │
 * │                                                                           │
 * │   PUBLIC key  → provision to the RELAY only                               │
 * │                 (ASSISTANT_PUBLIC_KEY env, or keys/assistant-public-key.pem)│
 * │                                                                           │
 * │   PRIVATE key → provision to the assistant WEBHOOK only                   │
 * │                 (ASSISTANT_PRIVATE_KEY on the Cloud Function / Lambda)     │
 * │                                                                           │
 * │   NEVER put the private key on the relay. The relay stores all ciphertext │
 * │   and the sealed family keys; keeping the private key off it is what makes │
 * │   the relay unable to read any linked family's data.                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Usage:  node assistant-keygen.js
 * Env:    KEY_DIR (output dir, default <relay-server>/keys)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(process.env.KEY_DIR || path.join(__dirname, 'keys'));
const PUB_PATH = path.join(OUT_DIR, 'assistant-public-key.pem');
// Deliberately NOT named assistant-private-key.pem, so it can never be picked
// up by a relay path expecting that name.
const PRIV_PATH = path.join(OUT_DIR, 'assistant-private-key.WEBHOOK-ONLY.pem');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

if (fs.existsSync(PUB_PATH)) {
  console.log(`[assistant-keygen] Public key already exists at ${PUB_PATH}. Delete it to regenerate.`);
  process.exit(0);
}

console.log('[assistant-keygen] Generating RSA-4096 keypair…');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

fs.writeFileSync(PUB_PATH, publicKey, 'utf-8');
fs.writeFileSync(PRIV_PATH, privateKey, { encoding: 'utf-8', mode: 0o600 });

console.log('');
console.log(`[assistant-keygen] PUBLIC  key → ${PUB_PATH}`);
console.log('[assistant-keygen]   Provision to the RELAY (ASSISTANT_PUBLIC_KEY or leave at this path).');
console.log('');
console.log(`[assistant-keygen] PRIVATE key → ${PRIV_PATH}`);
console.log('[assistant-keygen]   Provision to the WEBHOOK ONLY (ASSISTANT_PRIVATE_KEY).');
console.log('[assistant-keygen]   Do NOT copy it to the relay. Delete this local file once provisioned.');
