/**
 * Assistant key custody — the relay must NEVER generate or hold the assistant
 * RSA private key (the fix for the earlier zero-knowledge break, where the
 * relay generated the keypair and could decrypt any linked family's key).
 *
 * Pins:
 *  - With integration ON but no public key provisioned, the public-key
 *    endpoint fails CLOSED (503) instead of minting a keypair.
 *  - Booting the relay does not write an assistant private key to disk.
 */

const path = require('path');
const fs = require('fs');

const TEST_PORT = 9499;
process.env.PORT = String(TEST_PORT);
process.env.RELAY_PORT = String(TEST_PORT);
process.env.POOL_PORT = String(TEST_PORT + 1);
process.env.RELAY_STATE_FILE = './test-relay-state-custody.json';
process.env.ASSISTANT_INTEGRATION = 'true';
delete process.env.ASSISTANT_PUBLIC_KEY;
// Point at a path that does not exist so nothing is loaded either.
process.env.ASSISTANT_PUBLIC_KEY_PATH = path.join(__dirname, 'keys', 'no-such-assistant-public.pem');

const LEGACY_PRIVATE_KEY_PATH = path.join(__dirname, 'keys', 'assistant-private-key.pem');

beforeAll(async () => {
  if (fs.existsSync(process.env.RELAY_STATE_FILE)) fs.unlinkSync(process.env.RELAY_STATE_FILE);
  // Remove any stale private key from an older run so the assertion proves THIS
  // boot didn't create one.
  if (fs.existsSync(LEGACY_PRIVATE_KEY_PATH)) fs.unlinkSync(LEGACY_PRIVATE_KEY_PATH);
  require('./server.js');
  await new Promise((r) => setTimeout(r, 1500));
});

afterAll(() => {
  if (fs.existsSync(process.env.RELAY_STATE_FILE)) fs.unlinkSync(process.env.RELAY_STATE_FILE);
});

describe('Assistant key custody', () => {
  const baseUrl = `http://localhost:${TEST_PORT}`;

  test('public-key endpoint fails closed (503) when no public key is provisioned', async () => {
    // Also make a request so any lazy key generation would have been triggered.
    const res = await fetch(`${baseUrl}/api/assistant/public-key`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not provisioned/i);
  });

  test('relay never writes an assistant private key to disk', () => {
    expect(fs.existsSync(LEGACY_PRIVATE_KEY_PATH)).toBe(false);
  });

  test('a provisioned public key is served (200) and stays public-only', async () => {
    const { generateKeyPairSync } = require('crypto');
    const { publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    process.env.ASSISTANT_PUBLIC_KEY = publicKey;

    const res = await fetch(`${baseUrl}/api/assistant/public-key`);
    expect(res.status).toBe(200);
    const pem = await res.text();
    expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(pem).not.toContain('PRIVATE KEY');
    delete process.env.ASSISTANT_PUBLIC_KEY;
  });
});
