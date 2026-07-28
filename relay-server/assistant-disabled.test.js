/**
 * Pins the v1 security default: cloud voice-assistant integration is DISABLED
 * unless the relay operator explicitly opts in with ASSISTANT_INTEGRATION=true.
 * Linking would upload an RSA-encrypted family master key that the relay can
 * decrypt, so the endpoints must not exist on a default deployment.
 */

const TEST_PORT = 9399;
process.env.PORT = String(TEST_PORT);
process.env.RELAY_PORT = String(TEST_PORT);
process.env.POOL_PORT = String(TEST_PORT + 1);
process.env.RELAY_STATE_FILE = './test-relay-state-assistant-disabled.json';
process.env.STATE_FILE = './test-relay-state-assistant-disabled.json'; // for the cleanup helpers
delete process.env.ASSISTANT_INTEGRATION;

const fs = require('fs');

beforeAll(async () => {
  if (fs.existsSync(process.env.STATE_FILE)) {
    fs.unlinkSync(process.env.STATE_FILE);
  }
  require('./server.js');
  await new Promise((resolve) => setTimeout(resolve, 1500));
});

afterAll(() => {
  if (fs.existsSync(process.env.STATE_FILE)) {
    fs.unlinkSync(process.env.STATE_FILE);
  }
});

describe('Voice assistant integration disabled by default', () => {
  const baseUrl = `http://localhost:${TEST_PORT}`;

  const gatedEndpoints = [
    { method: 'GET', url: '/api/assistant/public-key' },
    { method: 'GET', url: '/api/assistant/list-data' },
    { method: 'GET', url: '/oauth/authorize?client_id=x&redirect_uri=y&state=z&response_type=code' },
    { method: 'GET', url: '/oauth/status?pairingCode=123456' },
    { method: 'POST', url: '/api/oauth/pair' },
    { method: 'POST', url: '/oauth/token' },
    { method: 'POST', url: '/api/assistant/submit-update' },
  ];

  for (const { method, url } of gatedEndpoints) {
    test(`${method} ${url.split('?')[0]} returns 404 without opt-in`, async () => {
      const res = await fetch(`${baseUrl}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/disabled/i);
    });
  }

  test('health endpoint still works', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });
});
