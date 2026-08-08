/**
 * Blind-token malleability regression suite (audit finding C1).
 *
 * The v2 wire token is "v2.<base64(signature(256) || nonce(32))>". Verification
 * runs over the DECODED bytes, but single-use enforcement used to run over the
 * RAW STRING. `Buffer.from(s, 'base64')` is lenient — base64url (`+/` → `-_`)
 * and whitespace/newline injection all decode to the SAME 288 bytes while
 * producing different strings — so one signed payload had unlimited distinct
 * spent-set keys, i.e. unlimited free replays.
 *
 * These tests drive the REAL pool-server handler (not a mirrored copy like
 * tokens/__tests__/e2e-contribution.test.js) so they cannot drift from it.
 *
 * Requests are synthesised as mock req/res rather than going over a socket:
 * a bare LF cannot survive a real HTTP header, and that is one of the variants
 * this finding is about.
 *
 * Run:
 *   NODE_OPTIONS=--experimental-vm-modules npx jest --forceExit relay-server/token-malleability.test.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const { UsedTokensStore } = require('./tokens/used-tokens-store');
const { PoolStore } = require('./pool/store');

const TEMP_STORE_FILE = path.join(__dirname, '__test_malleability_used_tokens__.json');

let suite;
let keypair;
let poolServer; // required lazily — reads ISSUER_PUBLIC_KEY at module load
let usedTokensStore;
let store;

/** Export a CryptoKey as an SPKI PEM (what ISSUER_PUBLIC_KEY holds). */
async function exportSpkiPem(publicKey) {
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', publicKey));
  const b64 = spki.toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----\n`;
}

/** Mint a real, valid v2 token (canonical base64). */
async function mintToken() {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);

  const { blindedMsg, inv } = await suite.blind(keypair.publicKey, nonce);
  const blindSignature = await suite.blindSign(keypair.privateKey, new Uint8Array(blindedMsg));
  const signature = await suite.finalize(
    keypair.publicKey,
    nonce,
    new Uint8Array(blindSignature),
    inv
  );

  const combined = new Uint8Array(signature.length + 32);
  combined.set(signature, 0);
  combined.set(nonce, signature.length);

  return {
    wireToken: 'v2.' + Buffer.from(combined).toString('base64'),
    nonce,
    nonceHex: Buffer.from(nonce).toString('hex'),
  };
}

/**
 * POST /api/pool/contribute through the real handler.
 * @returns {Promise<{ status: number, body: object }>}
 */
function contribute(wireToken, bodyOverrides = {}) {
  const payload = JSON.stringify({
    storeId: 'test-store',
    itemName: 'milk',
    price: 4.99,
    flyerWeek: '2026-W22',
    validTo: Date.now() + 86_400_000,
    ...bodyOverrides,
  });

  const req = Readable.from([payload]);
  req.method = 'POST';
  req.url = '/api/pool/contribute';
  req.headers = { authorization: `Bearer ${wireToken}`, 'content-type': 'application/json' };

  return new Promise((resolve, reject) => {
    let status = null;
    const res = {
      setHeader() {},
      writeHead(code) {
        status = code;
        return res;
      },
      end(chunk) {
        try {
          resolve({ status, body: chunk ? JSON.parse(chunk) : {} });
        } catch (err) {
          reject(err);
        }
      },
    };
    // handlePoolRequest dispatches to an async handler without awaiting it;
    // the mock res.end above is what actually signals completion.
    poolServer.handlePoolRequest(req, res, store);
  });
}

beforeAll(async () => {
  const { BlindRSA, Params } = await import('@cloudflare/blindrsa-ts');
  suite = new BlindRSA(Params.RSABSSA_SHA384_PSS_Randomized);
  keypair = await suite.generateKey({
    name: 'RSA-PSS',
    modulusLength: 2048,
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
  });

  // pool-server reads ISSUER_PUBLIC_KEY at module load — set it before require.
  process.env.ISSUER_PUBLIC_KEY = await exportSpkiPem(keypair.publicKey);
  poolServer = require('./pool/pool-server');

  try { fs.unlinkSync(TEMP_STORE_FILE); } catch {}
  usedTokensStore = new UsedTokensStore({ storeFile: TEMP_STORE_FILE });
  await usedTokensStore.loadOnStartup();
  poolServer.setUsedTokensStore(usedTokensStore);

  store = new PoolStore();
}, 60000);

afterAll(async () => {
  if (usedTokensStore) await usedTokensStore.shutdown();
  try { fs.unlinkSync(TEMP_STORE_FILE); } catch {}
});

describe('C1 — blind-token single-use must be keyed on the signed value', () => {
  it('keys the spent set on the nonce, not on the transport string', async () => {
    const { wireToken, nonceHex } = await mintToken();

    expect((await contribute(wireToken)).status).toBe(200);

    // The discriminating assertion: the spent-set key must be the SIGNED value.
    // Keying on the raw string is what makes every re-encoding a free replay.
    expect(usedTokensStore.isUsed(nonceHex)).toBe(true);
  });

  it('rejects a byte-identical replay of the canonical token', async () => {
    const { wireToken } = await mintToken();

    expect((await contribute(wireToken)).status).toBe(200);

    const replay = await contribute(wireToken, { itemName: 'eggs', price: 3.49 });
    expect(replay.status).toBe(403);
    expect(replay.body.error).toMatch(/already been used|Non-canonical/i);
  });

  it('rejects a base64url re-encoding of a spent token', async () => {
    const { wireToken } = await mintToken();
    expect((await contribute(wireToken)).status).toBe(200);

    // Same 288 signed bytes, different string: `+` → `-`, `/` → `_`.
    const b64url = 'v2.' + wireToken.slice(3).replace(/\+/g, '-').replace(/\//g, '_');
    expect(b64url).not.toBe(wireToken);
    expect(Buffer.from(b64url.slice(3), 'base64').equals(Buffer.from(wireToken.slice(3), 'base64')))
      .toBe(true);

    const replay = await contribute(b64url, { itemName: 'bread', price: 2.99 });
    expect(replay.status).toBe(403);
  });

  it('rejects whitespace- and newline-injected re-encodings of a spent token', async () => {
    const { wireToken } = await mintToken();
    expect((await contribute(wireToken)).status).toBe(200);

    const encoded = wireToken.slice(3);
    const variants = [
      'v2.' + encoded.slice(0, 10) + ' ' + encoded.slice(10),
      'v2.' + encoded.slice(0, 10) + '\n' + encoded.slice(10),
      'v2.' + encoded.slice(0, 10) + '\r\n' + encoded.slice(10),
      'v2.' + encoded.slice(0, 10) + '\t' + encoded.slice(10),
    ];

    for (const variant of variants) {
      // Every variant decodes to the same signed bytes — Buffer's base64
      // decoder silently drops whitespace.
      expect(Buffer.from(variant.slice(3), 'base64').equals(Buffer.from(encoded, 'base64')))
        .toBe(true);

      const replay = await contribute(variant, { itemName: 'butter', price: 5.99 });
      expect(replay.status).toBe(403);
    }
  });

  it('still accepts a genuinely fresh token', async () => {
    const { wireToken } = await mintToken();
    const response = await contribute(wireToken, { itemName: 'yogurt', price: 1.99 });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('still rejects a token spent under the legacy raw-string key', async () => {
    const { wireToken, nonceHex } = await mintToken();

    // Simulate an on-disk entry written by the pre-fix scheme, which keyed the
    // spent set on the canonical wire string. Legacy entries were always
    // written from a canonical string, so the hardened parseToken never
    // prevents this arm from matching.
    expect(usedTokensStore.checkAndMark(wireToken)).toBe(true);
    expect(usedTokensStore.isUsed(nonceHex)).toBe(false);

    const response = await contribute(wireToken, { itemName: 'cheese', price: 7.99 });
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/already been used/i);
  });
});
