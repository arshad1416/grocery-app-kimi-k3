/**
 * Flyer Price Extraction — Ollama VL Client
 *
 * Sends an image (as base64) to a local Ollama instance for vision-based
 * price extraction. Uses the qwen2.5-vl:7b model by default.
 *
 * Handles connection failures, timeouts, and empty responses gracefully —
 * returns an empty array on any error.
 *
 * @module ollama-client
 */

const http = require('http');
const https = require('https');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-vl:7b';
const TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || '120000', 10); // 120s for CPU VL

/**
 * Check if Ollama extraction should be used (no QWEN_API_KEY set).
 *
 * @returns {boolean}
 */
function isOllamaEnabled() {
  return !process.env.QWEN_API_KEY;
}

/**
 * Send an image to the local Ollama instance for VL-based price extraction.
 *
 * @param {string} imageBase64 - Base64-encoded image data
 * @param {string} imageFormat - Image format (e.g. 'jpeg', 'png')
 * @returns {Promise<Array<{itemName: string, price: number, unit: string, quantity: number, confidence: number, saleInfo: object|null}>>}
 */
async function extractWithOllama(imageBase64, imageFormat) {
  const { SYSTEM_PROMPT } = require('./prompt');
  const { parseResponse } = require('./parse-response');

  const payload = JSON.stringify({
    model: OLLAMA_MODEL,
    prompt: SYSTEM_PROMPT,
    images: [imageBase64],
    stream: false,
    options: {
      temperature: 0.1,
      top_p: 0.9,
    },
  });

  try {
    const response = await fetchWithTimeout(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      timeout: TIMEOUT_MS,
    });

    if (!response.ok) {
      console.warn(`[ollama] HTTP ${response.status}: ${response.statusText}`);
      return [];
    }

    const data = await response.json();

    // Ollama returns { response: "..." } for non-streaming
    const rawText = data.response || '';
    if (!rawText.trim()) {
      console.warn('[ollama] Empty response from Ollama');
      return [];
    }

    return parseResponse(rawText);
  } catch (err) {
    console.warn(`[ollama] Error: ${err.message}`);
    return [];
  }
}

/**
 * Fetch wrapper with timeout support.
 * Uses native http/https modules to support older Node.js versions.
 *
 * @param {string} url
 * @param {object} options - { method, headers, body, timeout }
 * @returns {Promise<Response>}
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

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        console.warn('[ollama] Connection refused — is Ollama running?');
      }
      reject(err);
    });

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

module.exports = { extractWithOllama, isOllamaEnabled };
