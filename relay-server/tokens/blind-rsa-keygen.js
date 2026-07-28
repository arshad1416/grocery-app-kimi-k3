#!/usr/bin/env node

/**
 * Blind RSA Key Generation Script
 *
 * Generates an RSA keypair (2048-bit) for the RFC 9474 Blind RSA token system.
 * Exports the private key as PEM (for the issuer) and the public key as PEM
 * (for the pool verifier and clients).
 *
 * The generated keys use RSABSSA-SHA384-PSS-Randomized per the standard.
 *
 * Usage:
 *   node tokens/blind-rsa-keygen.js
 *
 * Environment variables:
 *   KEY_DIR       Directory to write keys (default: <relay-server>/keys)
 *   MODULUS_BITS  RSA modulus size in bits (default: 2048)
 */

const fs = require('fs');
const path = require('path');

const KEY_DIR = path.resolve(process.env.KEY_DIR || path.join(__dirname, '..', 'keys'));
const MODULUS_BITS = parseInt(process.env.MODULUS_BITS || '2048', 10);

const PRIVATE_KEY_PATH = path.join(KEY_DIR, 'issuer-private-key.pem');
const PUBLIC_KEY_PATH = path.join(KEY_DIR, 'issuer-public-key.pem');

/**
 * Convert an ArrayBuffer to a PEM-formatted string.
 */
function arrayBufferToPem(buf, label) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = Buffer.from(binary, 'binary').toString('base64');
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

async function main() {
  // Ensure key directory exists
  if (!fs.existsSync(KEY_DIR)) {
    fs.mkdirSync(KEY_DIR, { recursive: true });
    console.log(`[keygen] Created directory: ${KEY_DIR}`);
  }

  // Check if keys already exist
  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    console.log(`[keygen] Keys already exist at ${KEY_DIR}`);
    console.log(`[keygen] To regenerate, delete: ${PRIVATE_KEY_PATH} and ${PUBLIC_KEY_PATH}`);
    return;
  }

  console.log(`[keygen] Generating ${MODULUS_BITS}-bit RSA keypair (this may take a moment)...`);

  // Dynamic import because blindrsa-ts is ESM
  const { BlindRSA } = await import('@cloudflare/blindrsa-ts');

  const keyPair = await BlindRSA.generateKey({
    modulusLength: MODULUS_BITS,
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537
    hash: 'SHA-384',
  });

  // Export private key as PKCS#8 PEM
  const rawPrivateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const privateKeyPem = arrayBufferToPem(rawPrivateKey, 'PRIVATE KEY');
  fs.writeFileSync(PRIVATE_KEY_PATH, privateKeyPem, 'utf-8');
  console.log(`[keygen] Private key written to: ${PRIVATE_KEY_PATH}`);

  // Export public key as SPKI PEM
  const rawPublicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeyPem = arrayBufferToPem(rawPublicKey, 'PUBLIC KEY');
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKeyPem, 'utf-8');
  console.log(`[keygen] Public key written to: ${PUBLIC_KEY_PATH}`);

  console.log(`\n[keygen] Key generation complete!`);
  console.log(`[keygen] Set these environment variables:`);
  console.log(`  ISSUER_PRIVATE_KEY_PATH=${PRIVATE_KEY_PATH}`);
  console.log(`  ISSUER_PUBLIC_KEY_PATH=${PUBLIC_KEY_PATH}`);
}

main().catch((err) => {
  console.error('[keygen] Error:', err);
  process.exit(1);
});
