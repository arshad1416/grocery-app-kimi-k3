/**
 * Shared streaming-capped body collector.
 *
 * Lifted from extract/extract-server.js so every endpoint that buffers a
 * request body shares ONE implementation to audit. The pre-fix pattern
 * (`let body = ''; req.on('data', c => body += c)` with a size check only in
 * the 'end' handler) buffers the entire body in memory before rejecting it —
 * a trivial remote OOM against a 256M-capped container.
 *
 * This implementation:
 *  - pre-checks Content-Length before reading anything,
 *  - counts bytes as they arrive,
 *  - calls req.destroy() the moment the cap is exceeded (no draining).
 *
 * @param {import('http').IncomingMessage} req - HTTP request
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

module.exports = { collectBody };
