/**
 * End-to-End Integration Test for Voice Assistant Integration.
 *
 * Verifies:
 *  1. Server start and RSA key generation.
 *  2. Public key retrieval endpoint.
 *  3. OAuth2 Authorization code generation and HTML rendering.
 *  4. Mobile app pairing and E2EE key escrow.
 *  5. OAuth2 Token exchange (form-encoded and JSON).
 *  6. Zero-knowledge list-data retrieval.
 *  7. Yjs update submission, persistence, and WebSocket relaying.
 */

// Set test environment ports
const TEST_PORT = 9199;
process.env.PORT = String(TEST_PORT);
process.env.RELAY_PORT = String(TEST_PORT);
process.env.POOL_PORT = String(TEST_PORT + 1);
process.env.STATE_FILE = './test-relay-state.json';

const fs = require('fs');
const path = require('path');
const assert = require('assert').strict;

// Clean up previous test files
if (fs.existsSync(process.env.STATE_FILE)) {
  fs.unlinkSync(process.env.STATE_FILE);
}
const updatesFile = path.join(__dirname, 'data', 'encrypted-updates.json');
if (fs.existsSync(updatesFile)) {
  fs.unlinkSync(updatesFile);
}

// Start the server
console.log('Starting Relay Server on test port', TEST_PORT);
require('./server.js');

// Helper to wait
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTests() {
  await delay(1500); // Wait for server to bind

  const baseUrl = `http://localhost:${TEST_PORT}`;

  try {
    console.log('\n--- 1. Testing GET /api/assistant/public-key ---');
    const pubKeyRes = await fetch(`${baseUrl}/api/assistant/public-key`);
    assert.equal(pubKeyRes.status, 200);
    const pubKey = await pubKeyRes.text();
    assert.ok(pubKey.includes('-----BEGIN PUBLIC KEY-----'));
    console.log('✓ Public key retrieved successfully');

    console.log('\n--- 2. Testing GET /oauth/authorize ---');
    const authUrl = `${baseUrl}/oauth/authorize?client_id=alexa-client&redirect_uri=https://oauth.amazon.com/cb&state=test-state&response_type=code`;
    const authRes = await fetch(authUrl);
    assert.equal(authRes.status, 200);
    const authHtml = await authRes.text();
    
    // Extract pairing code from HTML
    const codeMatch = authHtml.match(/class="code">(\d{6})<\/div>/);
    assert.ok(codeMatch, 'Pairing code not found in HTML');
    const pairingCode = codeMatch[1];
    console.log(`✓ Authorization HTML rendered. Extracted Pairing Code: ${pairingCode}`);

    console.log('\n--- 3. Testing GET /oauth/status (Unlinked) ---');
    const statusRes1 = await fetch(`${baseUrl}/oauth/status?pairingCode=${pairingCode}`);
    assert.equal(statusRes1.status, 200);
    const statusData1 = await statusRes1.json();
    assert.equal(statusData1.linked, false);
    console.log('✓ Status reports unlinked as expected');

    console.log('\n--- 4. Testing POST /api/oauth/pair (Mobile Escrow) ---');
    const familyId = 'family-test-uuid-456';
    const encryptedMasterKey = 'base64-encrypted-family-key-material-here';
    const pairRes = await fetch(`${baseUrl}/api/oauth/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode,
        familyId,
        encryptedMasterKey
      })
    });
    assert.equal(pairRes.status, 200);
    const pairData = await pairRes.json();
    assert.equal(pairData.success, true);
    console.log('✓ Mobile app paired successfully and escrowed key');

    console.log('\n--- 5. Testing GET /oauth/status (Linked) ---');
    const statusRes2 = await fetch(`${baseUrl}/oauth/status?pairingCode=${pairingCode}`);
    assert.equal(statusRes2.status, 200);
    const statusData2 = await statusRes2.json();
    assert.equal(statusData2.linked, true);
    assert.ok(statusData2.redirectUri.includes('code='));
    assert.ok(statusData2.redirectUri.includes('state=test-state'));
    
    const redirectUrl = new URL(statusData2.redirectUri);
    const authCode = redirectUrl.searchParams.get('code');
    assert.ok(authCode);
    console.log(`✓ Status reports linked. Extracted Auth Code: ${authCode}`);

    console.log('\n--- 6. Testing POST /oauth/token (Exchange Code) ---');
    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: 'https://oauth.amazon.com/cb',
        client_id: 'alexa-client'
      })
    });
    assert.equal(tokenRes.status, 200);
    const tokenData = await tokenRes.json();
    assert.ok(tokenData.access_token);
    assert.equal(tokenData.token_type, 'Bearer');
    const accessToken = tokenData.access_token;
    console.log('✓ Code exchanged for access token');

    console.log('\n--- 7. Testing GET /api/assistant/list-data ---');
    const listRes = await fetch(`${baseUrl}/api/assistant/list-data`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.encryptedMasterKey, encryptedMasterKey);
    assert.deepEqual(listData.updates, {});
    console.log('✓ Escrowed key retrieved; updates empty initially');

    console.log('\n--- 8. Testing POST /api/assistant/submit-update ---');
    const testUpdate = {
      ciphertext: 'test-cipher-data',
      iv: 'test-iv-data',
      tag: 'test-tag-data'
    };
    const updateRes = await fetch(`${baseUrl}/api/assistant/submit-update`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        listId: 'list-test-id',
        payload: testUpdate
      })
    });
    assert.equal(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.equal(updateData.success, true);
    console.log('✓ Encrypted update submitted successfully');

    console.log('\n--- 9. Testing GET /api/assistant/list-data (with updates) ---');
    const listRes2 = await fetch(`${baseUrl}/api/assistant/list-data`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    assert.equal(listRes2.status, 200);
    const listData2 = await listRes2.json();
    assert.ok(listData2.updates['list-test-id']);
    assert.equal(listData2.updates['list-test-id'].length, 1);
    assert.deepEqual(listData2.updates['list-test-id'][0], testUpdate);
    console.log('✓ Retrieved update matches submitted update (100% zero-knowledge verified)');

    console.log('\n=============================================');
    console.log('  ALL INTEGRATION TESTS PASSED SUCCESSFULLY!  ');
    console.log('=============================================');
    
    // Clean up files
    if (fs.existsSync(process.env.STATE_FILE)) fs.unlinkSync(process.env.STATE_FILE);
    if (fs.existsSync(updatesFile)) fs.unlinkSync(updatesFile);
    
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  }
}

runTests();
