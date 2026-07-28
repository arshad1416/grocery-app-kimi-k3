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

// ─── Rate Limiting ──────────────────────────────────────────────────────────

/** Map<deviceId, { count: number, windowStart: number }> */
const extractRateLimiters = new Map();
const EXTRACT_RATE_LIMIT = parseInt(process.env.EXTRACT_RATE_LIMIT || '10', 10);
const EXTRACT_RATE_WINDOW_MS = 60_000; // 1 minute

/**
 * Check per-device extract rate limit.
 *
 * @param {string} deviceId
 * @returns {boolean} true if allowed
 */
function checkExtractRateLimit(deviceId) {
  const now = Date.now();
  let limiter = extractRateLimiters.get(deviceId);

  if (!limiter || now - limiter.windowStart > EXTRACT_RATE_WINDOW_MS) {
    limiter = { count: 1, windowStart: now };
    extractRateLimiters.set(deviceId, limiter);
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
  for (const [deviceId, limiter] of extractRateLimiters) {
    if (now - limiter.windowStart > EXTRACT_RATE_WINDOW_MS * 2) {
      extractRateLimiters.delete(deviceId);
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

  const deviceId = enrollment.deviceId;

  // 2. Rate limit check (10 extracts/min per device)
  if (!checkExtractRateLimit(deviceId)) {
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

/**
 * Collect the body of an HTTP request with a max size limit.
 *
 * @param {object} req - HTTP request
 * @param {number} maxBytes - Maximum allowed body size
 * @returns {Promise<string|null>} Body string, or null if size exceeded
 */
function collectBody(req, maxBytes) {
  return new Promise((resolve) => {
    if (req.headers['content-length'] && parseInt(req.headers['content-length'], 10) > maxBytes) {
      resolve(null);
      return;
    }

    let body = '';
    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy(); // Stop receiving data
        resolve(null);
        return;
      }
      body += chunk;
    });

    req.on('end', () => resolve(body));

    req.on('error', () => resolve(null));
  });
}

module.exports = { handleExtractRequest };
