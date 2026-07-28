/**
 * Jest Integration Test for Voice Assistant E2EE Integration.
 */

const TEST_PORT = 9299;
process.env.PORT = String(TEST_PORT);
process.env.RELAY_PORT = String(TEST_PORT);
process.env.POOL_PORT = String(TEST_PORT + 1);
// NOTE: server.js reads RELAY_STATE_FILE (STATE_FILE was a long-standing bug
// that made test runs write enrollment junk into the tracked relay-state.json)
process.env.RELAY_STATE_FILE = './test-relay-state.json';
process.env.STATE_FILE = './test-relay-state.json'; // kept for the cleanup helpers below
// This suite tests the opt-in voice-assistant integration, which is disabled
// by default in production (see ASSISTANT_INTEGRATION in server.js).
process.env.ASSISTANT_INTEGRATION = 'true';
// The relay no longer generates the assistant keypair (it must never hold the
// private key). Provision a throwaway PUBLIC key so the public-key endpoint
// returns 200; the private key lives only in the webhook, which these tests
// don't run (they pass an opaque fake encryptedMasterKey).
process.env.ASSISTANT_PUBLIC_KEY = require('crypto').generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
}).publicKey;

const fs = require('fs');
const path = require('path');
const http = require('http');

let serverInstance = null;

beforeAll(async () => {
  // Clean up previous test files
  if (fs.existsSync(process.env.STATE_FILE)) {
    fs.unlinkSync(process.env.STATE_FILE);
  }
  const updatesFile = path.join(__dirname, 'data', 'encrypted-updates.json');
  if (fs.existsSync(updatesFile)) {
    fs.unlinkSync(updatesFile);
  }

  // Load and start server
  require('./server.js');
  // Wait 1.5s for server bind
  await new Promise((resolve) => setTimeout(resolve, 1500));
});

afterAll(async () => {
  // Clean up test files
  if (fs.existsSync(process.env.STATE_FILE)) {
    fs.unlinkSync(process.env.STATE_FILE);
  }
  const updatesFile = path.join(__dirname, 'data', 'encrypted-updates.json');
  if (fs.existsSync(updatesFile)) {
    fs.unlinkSync(updatesFile);
  }
  
  // Close HTTP server connection
  // We can access it from the global/loaded module or trigger graceful shutdown
  // server.js handles SIGTERM/SIGINT by closing the server. We can trigger close directly
  // or simply let jest forceExit.
});

describe('Voice Assistant E2EE Integration', () => {
  const baseUrl = `http://localhost:${TEST_PORT}`;
  let pairingCode = '';
  let authCode = '';
  let accessToken = '';
  const familyId = 'family-test-uuid-999';
  const encryptedMasterKey = 'base64-encrypted-key-for-jest';

  test('GET /api/assistant/public-key', async () => {
    const res = await fetch(`${baseUrl}/api/assistant/public-key`);
    expect(res.status).toBe(200);
    const key = await res.text();
    expect(key).toContain('-----BEGIN PUBLIC KEY-----');
  });

  test('GET /oauth/authorize HTML code retrieval', async () => {
    const authUrl = `${baseUrl}/oauth/authorize?client_id=alexa-client&redirect_uri=https://oauth.amazon.com/cb&state=jest-state&response_type=code`;
    const res = await fetch(authUrl);
    expect(res.status).toBe(200);
    const html = await res.text();
    const codeMatch = html.match(/class="code">(\d{6})<\/div>/);
    expect(codeMatch).not.toBeNull();
    pairingCode = codeMatch[1];
  });

  test('GET /oauth/status (Unlinked)', async () => {
    const res = await fetch(`${baseUrl}/oauth/status?pairingCode=${pairingCode}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.linked).toBe(false);
  });

  test('POST /api/oauth/pair (Mobile Escrow)', async () => {
    const res = await fetch(`${baseUrl}/api/oauth/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode,
        familyId,
        encryptedMasterKey
      })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test('GET /oauth/status (Linked)', async () => {
    const res = await fetch(`${baseUrl}/oauth/status?pairingCode=${pairingCode}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.linked).toBe(true);
    expect(data.redirectUri).toContain('code=');
    
    const redirectUrl = new URL(data.redirectUri);
    authCode = redirectUrl.searchParams.get('code');
    expect(authCode).toBeTruthy();
  });

  test('POST /oauth/token (Exchange Code)', async () => {
    const res = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: 'https://oauth.amazon.com/cb',
        client_id: 'alexa-client'
      })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.access_token).toBeTruthy();
    expect(data.token_type).toBe('Bearer');
    accessToken = data.access_token;
  });

  test('GET /api/assistant/list-data (empty)', async () => {
    const res = await fetch(`${baseUrl}/api/assistant/list-data`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.encryptedMasterKey).toBe(encryptedMasterKey);
    expect(data.updates).toEqual({});
  });

  test('POST /api/assistant/submit-update', async () => {
    const testUpdate = {
      ciphertext: 'jest-cipher',
      iv: 'jest-iv',
      tag: 'jest-tag'
    };
    const res = await fetch(`${baseUrl}/api/assistant/submit-update`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        listId: 'list-jest-id',
        payload: testUpdate
      })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test('GET /api/assistant/list-data (with updates)', async () => {
    const res = await fetch(`${baseUrl}/api/assistant/list-data`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.updates['list-jest-id']).toBeDefined();
    expect(data.updates['list-jest-id'].length).toBe(1);
    expect(data.updates['list-jest-id'][0].ciphertext).toBe('jest-cipher');
  });
});
