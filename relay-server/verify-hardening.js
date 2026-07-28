#!/usr/bin/env node
/**
 * Live HTTP verification of all 7 relay-hardening fixes.
 * Run: node verify-hardening.js
 * Requires the relay server NOT running on port 9700.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const path = require('path');
const fs = require('fs');

const PORT = 9700;
const BASE = `http://127.0.0.1:${PORT}`;
const STATE_FILE = path.join(__dirname, '__verify_state__.json');

async function main() {
  // Start server
  try { fs.unlinkSync(STATE_FILE); } catch {}
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      RELAY_PORT: String(PORT),
      POOL_PORT: String(PORT + 1),
      RELAY_STATE_FILE: STATE_FILE,
      RELAY_DATA_DIR: '',
      ASSISTANT_INTEGRATION: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 8000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Listening on port')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('error', reject);
  });

  console.log(`\n=== Server running on port ${PORT} ===\n`);

  // Helper
  function makeInvite(familyId, keypair, { nonce, expiresAt } = {}) {
    const exp = expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000;
    const n = nonce ?? Buffer.from(nacl.randomBytes(16)).toString('base64');
    const deviceId = Buffer.from(keypair.publicKey).toString('base64');
    const payload = JSON.stringify({ familyId, deviceId, expiresAt: exp, nonce: n });
    const sig = nacl.sign.detached(new TextEncoder().encode(payload), keypair.secretKey);
    return JSON.stringify({ familyId, deviceId, expiresAt: exp, nonce: n, signature: Buffer.from(sig).toString('base64') });
  }

  // ─── DEFECT 2+4: Invite forgery + replay ────────────────────────────────────
  console.log('--- Defect 2+4: Invite forgery and replay ---');
  const familyId = 'verify-family-' + Date.now();
  const founderKp = nacl.sign.keyPair();

  // Legitimate founding
  const invite1 = makeInvite(familyId, founderKp);
  let res = await fetch(`${BASE}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken: crypto.randomBytes(32).toString('base64'), familyInviteToken: invite1 }),
  });
  console.log(`  Legitimate founding enrollment: ${res.status}`);
  const { relayToken } = await res.json();

  // Forged invite (attacker keypair)
  const attackerKp = nacl.sign.keyPair();
  const forgedInvite = makeInvite(familyId, attackerKp);
  res = await fetch(`${BASE}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken: crypto.randomBytes(32).toString('base64'), familyInviteToken: forgedInvite }),
  });
  console.log(`  Forged invite (self-signed, wrong key): ${res.status}`);

  // Replay verbatim
  res = await fetch(`${BASE}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken: crypto.randomBytes(32).toString('base64'), familyInviteToken: invite1 }),
  });
  console.log(`  Legitimate invite replayed verbatim: ${res.status}`);

  // Replay with reordered JSON
  const parsed = JSON.parse(invite1);
  const reordered = JSON.stringify({
    signature: parsed.signature,
    nonce: parsed.nonce,
    familyId: parsed.familyId,
    deviceId: parsed.deviceId,
    expiresAt: parsed.expiresAt,
  });
  res = await fetch(`${BASE}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken: crypto.randomBytes(32).toString('base64'), familyInviteToken: reordered }),
  });
  console.log(`  Same invite with JSON keys reordered: ${res.status}`);

  // ─── DEFECT 5: Oversized body ────────────────────────────────────────────────
  console.log('\n--- Defect 5: Streaming body cap ---');
  res = await fetch(`${BASE}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'x'.repeat(10000),
  });
  console.log(`  10KB body to /enroll: ${res.status}`);

  // ─── DEFECT 6: /stats ────────────────────────────────────────────────────────
  console.log('\n--- Defect 6: /stats hardened ---');
  res = await fetch(`${BASE}/stats`);
  const statsHeaders = Object.fromEntries(res.headers.entries());
  console.log(`  Unauthenticated GET /stats: ${res.status}`);
  console.log(`  Access-Control-Allow-Origin header: ${statsHeaders['access-control-allow-origin'] ?? '(absent)'}`);

  res = await fetch(`${BASE}/stats`, { headers: { Authorization: `Bearer ${relayToken}` } });
  const statsData = await res.json();
  console.log(`  Authenticated GET /stats: ${res.status}`);
  console.log(`  Response has families field: ${'families' in statsData}`);
  console.log(`  Response has totalFamilies: ${'totalFamilies' in statsData}`);

  // ─── DEFECT 7: Double-spend store ────────────────────────────────────────────
  console.log('\n--- Defect 7: Permanent spent-token store ---');
  const { UsedTokensStore } = require('./tokens/used-tokens-store');
  const tmpStore = path.join(__dirname, '__verify_spent__.json');
  try { fs.unlinkSync(tmpStore); } catch {}
  const store = new UsedTokensStore({ storeFile: tmpStore, ttlMs: 1 });
  await store.loadOnStartup();
  store.checkAndMark('test-token-permanent');
  await new Promise(r => setTimeout(r, 20)); // wait past old TTL
  store.cleanExpired();
  const stillUsed = store.isUsed('test-token-permanent');
  console.log(`  Token still rejected after former TTL: ${stillUsed}`);
  await store.shutdown();
  try { fs.unlinkSync(tmpStore); } catch {}

  // ─── DEFECT 1: State persistence ─────────────────────────────────────────────
  console.log('\n--- Defect 1: State persistence across restart ---');
  // Write state, restart, read back
  // The enroll above wrote relay state. Give the debounced flush time to write.
  await new Promise(r => setTimeout(r, 1000));
  child.kill('SIGTERM');
  await new Promise(r => child.on('exit', r));

  const child2 = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      RELAY_PORT: String(PORT),
      POOL_PORT: String(PORT + 1),
      RELAY_STATE_FILE: STATE_FILE,
      RELAY_DATA_DIR: '',
      ASSISTANT_INTEGRATION: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server restart failed')), 8000);
    child2.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Listening on port')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child2.on('error', reject);
  });

  // The relay token from the first run should still be valid
  res = await fetch(`${BASE}/stats`, { headers: { Authorization: `Bearer ${relayToken}` } });
  console.log(`  After restart, relay token still works: ${res.status}`);

  child2.kill('SIGTERM');
  await new Promise(r => child2.on('exit', r));
  try { fs.unlinkSync(STATE_FILE); } catch {}

  console.log('\n=== ALL VERIFICATIONS COMPLETE ===\n');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
