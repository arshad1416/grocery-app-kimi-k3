/**
 * Flyer Price Extraction — HTTP Server Handler
 *
 * Wires together the extraction pipeline with authentication and rate limiting.
 * POST /api/extract/flyer handler with:
 *   - Bearer token authentication (relayToken against enrolledDevices)
 *   - Per-device rate limiting (10 extracts/min)
 *   - Max payload 10MB
 *   - Routes to Qwen or Ollama based on QWEN_API_KEY env
 *   - Always returns parsed/validated output, never raw AI text
 *
 * @module extract-server
 */

const url = require('url');
const { collectBody } = require('../lib/collect-body');

// ─── Rate Limiting ──────────────────────────────────────────────────────────

/** Map<relayToken, { count: number, windowStart: number }> */
const extractRateLimiters = new Map();
const EXTRACT_RATE_LIMIT = parseInt(process.env.EXTRACT_RATE_LIMIT || '10', 10);
const EXTRACT_RATE_WINDOW_MS = 60_000; // 1 minute

/**
 * Check per-enrollment extract rate limit.
 *
 * Keyed on the server-minted relayToken, matching checkTokenRateLimit in
 * server.js (audit H11). A deviceId is chosen by the client at enrollment, so
 * two enrollments can assert the same one and share — or collide over — a
 * budget. The relayToken is minted by the relay and is 1:1 with an enrollment,
 * which is the only identifier here the client cannot pick.
 *
 * @param {string} relayToken - Server-minted enrollment token, never a
 *   client-supplied deviceId.
 * @returns {boolean} true if allowed
 */
function checkExtractRateLimit(relayToken) {
  const now = Date.now();
  let limiter = extractRateLimiters.get(relayToken);

  if (!limiter || now - limiter.windowStart > EXTRACT_RATE_WINDOW_MS) {
    limiter = { count: 1, windowStart: now };
    extractRateLimiters.set(relayToken, limiter);
    return true;
  }

  limiter.count++;
  if (limiter.count > EXTRACT_RATE_LIMIT) {
    return false;
  }

  return true;
}

/**
 * Clean expired extract rate limiters (called periodically).
 */
function cleanExtractRateLimiters() {
  const now = Date.now();
  for (const [relayToken, limiter] of extractRateLimiters) {
    if (now - limiter.windowStart > EXTRACT_RATE_WINDOW_MS * 2) {
      extractRateLimiters.delete(relayToken);
    }
  }
}

// Clean every 5 minutes
setInterval(cleanExtractRateLimiters, 5 * 60_000);

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * Handle POST /api/extract/flyer.
 *
 * @param {object} req - HTTP request
 * @param {object} res - HTTP response
 * @param {Map<string, object>} enrolledDevices - Map of relayToken → enrollment
 */
async function handleExtractRequest(req, res, enrolledDevices) {
  res.setHeader('Content-Type', 'application/json');

  // 1. Authenticate via Bearer token
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Missing or invalid Authorization header. Expected: Bearer <relayToken>' }));
    return;
  }

  const relayToken = authHeader.slice('Bearer '.length).trim();
  const enrollment = enrolledDevices.get(relayToken);

  if (!enrollment) {
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Invalid relay token' }));
    return;
  }

  // Check token expiry
  if (Date.now() > enrollment.expiresAt) {
    enrolledDevices.delete(relayToken);
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Relay token has expired' }));
    return;
  }

  // 2. Rate limit check (10 extracts/min per enrollment, keyed on the
  //    server-minted relayToken rather than the client-chosen deviceId — H11)
  if (!checkExtractRateLimit(relayToken)) {
    res.writeHead(429);
    res.end(JSON.stringify({
      error: `Extract rate limit exceeded. Max ${EXTRACT_RATE_LIMIT} extracts per minute per device.`,
    }));
    return;
  }

  // 3. Parse body with size limit
  const body = await collectBody(req, 10 * 1024 * 1024); // 10MB max
  if (body === null) {
    res.writeHead(413);
    res.end(JSON.stringify({ error: 'Request body too large (max 10MB)' }));
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const { image, format } = parsed;

  if (!image || typeof image !== 'string') {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'image field is required (base64 string)' }));
    return;
  }

  const imageFormat = (typeof format === 'string' && format.match(/^(jpeg|png|webp|gif)$/i))
    ? format.toLowerCase()
    : 'jpeg';

  // 4. Route to appropriate extraction backend
  let prices;
  try {
    if (process.env.QWEN_API_KEY) {
      const { extractWithQwen } = require('./qwen-client');
      prices = await extractWithQwen(image, imageFormat);
    } else {
      const { extractWithOllama } = require('./ollama-client');
      prices = await extractWithOllama(image, imageFormat);
    }
  } catch (err) {
    console.warn(`[extract] Extraction error: ${err.message}`);
    // Ensure prices is always an array on error
    prices = [];
  }

  // 5. Return parsed/validated output — never raw AI response
  res.writeHead(prices.length > 0 ? 200 : 422);
  res.end(JSON.stringify({ prices }));
}

// collectBody used to live here; it is now the shared lib/collect-body.js so
// every body-buffering endpoint routes through one audited implementation.

module.exports = { handleExtractRequest };
