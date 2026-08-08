/**
 * H11 at the extract endpoint — the extract budget must be keyed on the
 * *enrollment*, not on the client-chosen deviceId.
 *
 * `/enroll` stores `deviceId` verbatim from the request body: nothing signs it
 * and nothing binds it to a key. Keying a budget on that string lets one client
 * reach into another enrollment's bucket simply by claiming the same deviceId —
 * which is a denial of the victim's extracts, not merely a cheaper quota for the
 * attacker. The relayToken is minted by the relay at /enroll and is 1:1 with an
 * enrollment, so it is the only identifier here the caller cannot pick.
 *
 * server.js keys checkTokenRateLimit on relayToken for the same reason; this
 * suite pins the sibling call site in extract/extract-server.js so the two
 * cannot drift apart again.
 *
 * Run:
 *   NODE_OPTIONS=--experimental-vm-modules npx jest --forceExit extract/extract-rate-limit-binding.test.js
 */

const { Readable } = require('stream');
const { handleExtractRequest } = require('./extract-server');

const EXTRACT_RATE_LIMIT = parseInt(process.env.EXTRACT_RATE_LIMIT || '10', 10);

/** An enrolledDevices map holding two live enrollments that claim the SAME deviceId. */
function twoEnrollmentsSharingADeviceId() {
  const farFuture = Date.now() + 3_600_000;
  return new Map([
    ['relay-token-A', { deviceId: 'shared-device-id', expiresAt: farFuture }],
    ['relay-token-B', { deviceId: 'shared-device-id', expiresAt: farFuture }],
  ]);
}

/**
 * Drive one POST /api/extract/flyer and resolve its status code.
 *
 * The body is deliberately not a valid extract payload: this suite is about
 * whether the request survives the rate-limit gate, so anything downstream of
 * that gate may reject it. The only status we ever assert on is 429.
 */
function extract(enrolledDevices, relayToken) {
  const req = Readable.from(['{}']);
  req.method = 'POST';
  req.url = '/api/extract/flyer';
  req.headers = {
    authorization: `Bearer ${relayToken}`,
    'content-type': 'application/json',
  };

  return new Promise((resolve, reject) => {
    let status = null;
    const res = {
      setHeader() {},
      writeHead(code) { status = code; },
      end() { resolve(status); },
    };
    handleExtractRequest(req, res, enrolledDevices).catch(reject);
  });
}

describe('extract rate limit is keyed on the enrollment, not the deviceId', () => {
  it('exhausting one enrollment does not exhaust another that claims the same deviceId', async () => {
    const enrolled = twoEnrollmentsSharingADeviceId();

    // Burn relay-token-A's whole window.
    for (let i = 0; i < EXTRACT_RATE_LIMIT; i++) {
      await extract(enrolled, 'relay-token-A');
    }
    await expect(extract(enrolled, 'relay-token-A')).resolves.toBe(429);

    // relay-token-B is a different enrollment. It asserts the identical
    // deviceId, so under the old deviceId keying it shared A's exhausted
    // bucket and this came back 429 — one client denying another's extracts.
    await expect(extract(enrolled, 'relay-token-B')).resolves.not.toBe(429);
  });

  it('still rejects an unknown or expired relay token before any rate limiting', async () => {
    const enrolled = twoEnrollmentsSharingADeviceId();
    enrolled.set('expired-token', { deviceId: 'whoever', expiresAt: Date.now() - 1 });

    await expect(extract(enrolled, 'never-enrolled')).resolves.toBe(403);
    await expect(extract(enrolled, 'expired-token')).resolves.toBe(403);
  });
});
