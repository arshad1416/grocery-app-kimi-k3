/**
 * Flyer Price Extraction — Qwen VL Max Client (OpenAI-compatible)
 *
 * Sends an image to the Qwen VL Max API for vision-based price extraction.
 * Uses OpenAI-compatible chat completion format.
 *
 * Handles 401 (auth error), 429 (rate limit with retry), and 500 (server error).
 * Returns empty array on any unrecoverable error.
 *
 * @module qwen-client
 */

const http = require('http');
const https = require('https');

const QWEN_API_KEY = process.env.QWEN_API_KEY || '';
const QWEN_BASE_URL = process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-vl-max';
const TIMEOUT_MS = parseInt(process.env.QWEN_TIMEOUT_MS || '60000', 10);
const MAX_RETRIES = 3;

/**
 * Check if Qwen extraction is available (API key configured).
 *
 * @returns {boolean}
 */
function isQwenEnabled() {
  return !!QWEN_API_KEY;
}

/**
 * Compute data URI from base64 image data.
 *
 * @param {string} imageBase64
 * @param {string} format
 * @returns {string}
 */
function toDataUri(imageBase64, format) {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${imageBase64}`;
}

/**
 * Send an image to Qwen VL Max for price extraction.
 *
 * @param {string} imageBase64 - Base64-encoded image data
 * @param {string} imageFormat - Image format (e.g. 'jpeg', 'png')
 * @returns {Promise<Array<{itemName: string, price: number, unit: string, quantity: number, confidence: number, saleInfo: object|null}>>}
 */
async function extractWithQwen(imageBase64, imageFormat) {
  const { SYSTEM_PROMPT } = require('./prompt');
  const { parseResponse } = require('./parse-response');

  if (!QWEN_API_KEY) {
    console.warn('[qwen] QWEN_API_KEY not configured');
    return [];
  }

  const dataUri = toDataUri(imageBase64, imageFormat);

  const payload = JSON.stringify({
    model: QWEN_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: SYSTEM_PROMPT },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 2048,
  });

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(QWEN_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${QWEN_API_KEY}`,
        },
        body: payload,
        timeout: TIMEOUT_MS,
      });

      // Handle auth errors — no retry
      if (response.status === 401) {
        console.warn('[qwen] Authentication failed (401) — check QWEN_API_KEY');
        return [];
      }

      // Handle rate limiting — retry with backoff
      if (response.status === 429) {
        console.warn(`[qwen] Rate limited (429) — attempt ${attempt}/${MAX_RETRIES}`);
        lastError = new Error('Rate limited');
        if (attempt < MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await sleep(delay);
          continue;
        }
        return [];
      }

      // Handle server errors — retry with backoff
      if (response.status >= 500) {
        console.warn(`[qwen] Server error (${response.status}) — attempt ${attempt}/${MAX_RETRIES}`);
        lastError = new Error(`Server error: ${response.status}`);
        if (attempt < MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await sleep(delay);
          continue;
        }
        return [];
      }

      if (!response.ok) {
        console.warn(`[qwen] HTTP ${response.status}: ${response.statusText}`);
        return [];
      }

      const data = await response.json();

      // OpenAI-compatible format: data.choices[0].message.content
      const rawText = data?.choices?.[0]?.message?.content || '';
      if (!rawText.trim()) {
        console.warn('[qwen] Empty response content');
        return [];
      }

      return parseResponse(rawText);
    } catch (err) {
      console.warn(`[qwen] Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await sleep(delay);
        continue;
      }
    }
  }

  console.warn(`[qwen] All ${MAX_RETRIES} attempts failed`);
  return [];
}

/**
 * Fetch wrapper with timeout support.
 * Uses native http/https modules.
 *
 * @param {string} url
 * @param {object} options - { method, headers, body, timeout }
 * @returns {Promise<{ok: boolean, status: number, statusText: string, json: () => Promise<object>, text: () => Promise<string>}>}
 */
function fetchWithTimeout(url, options) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'POST',
      headers: options.headers || {},
      timeout: options.timeout || TIMEOUT_MS,
    };

    const req = transport.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage || '',
          json: async () => JSON.parse(body),
          text: async () => body,
        });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Promise-based sleep.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { extractWithQwen, isQwenEnabled };
