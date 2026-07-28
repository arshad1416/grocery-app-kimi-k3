/**
 * Used Tokens Store — Persisted spent-set for single-use token enforcement.
 *
 * Provides checkAndMark(tokenStr) to atomically check-and-mark a token as used.
 * Persists to disk with debounced writes and compaction.
 * Cleans entries older than 24h TTL on a periodic interval.
 *
 * Usage:
 *   const store = new UsedTokensStore();
 *   await store.loadOnStartup();
 *   const isNew = await store.checkAndMark(tokenStr);  // false if already used
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_STORE_FILE = path.join(__dirname, '..', 'used-tokens.json');
const DEFAULT_TTL_MS = 86_400_000; // 24 hours
const DEFAULT_CLEANUP_INTERVAL_MS = 3_600_000; // 1 hour
const DEBOUNCE_WRITE_MS = 500; // 500ms

class UsedTokensStore {
  /**
   * @param {object} options
   * @param {string} [options.storeFile] - Path to the JSON store file
   * @param {number} [options.ttlMs] - Time-to-live for entries (default: 24h)
   * @param {number} [options.cleanupIntervalMs] - Cleanup interval (default: 1h)
   */
  constructor(options = {}) {
    this.storeFile = options.storeFile || DEFAULT_STORE_FILE;
    this.ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    this.cleanupIntervalMs = options.cleanupIntervalMs || DEFAULT_CLEANUP_INTERVAL_MS;

    /** Map<tokenStr, timestamp> */
    this._tokens = new Map();
    this._saveTimeout = null;
    this._cleanupTimer = null;
    this._loaded = false;
  }

  /**
   * Load the store from disk. Must be called before using the store.
   * @returns {Promise<void>}
   */
  async loadOnStartup() {
    try {
      if (fs.existsSync(this.storeFile)) {
        const raw = fs.readFileSync(this.storeFile, 'utf-8');
        const data = JSON.parse(raw);
        const now = Date.now();
        let loaded = 0;
        let pruned = 0;
        for (const [token, ts] of Object.entries(data)) {
          if (now - ts < this.ttlMs) {
            this._tokens.set(token, ts);
            loaded++;
          } else {
            pruned++;
          }
        }
        console.log(
          `[used-tokens] Loaded ${loaded} entries (pruned ${pruned} expired) from ${this.storeFile}`
        );
      } else {
        console.log(`[used-tokens] No store file found at ${this.storeFile}, starting fresh`);
      }
    } catch (err) {
      console.warn(`[used-tokens] Failed to load store: ${err.message}. Starting fresh.`);
    }
    this._loaded = true;

    // Start periodic cleanup
    this._startCleanup();
    return;
  }

  /**
   * Check if a token is already used and mark it if not.
   * Returns true if the token is new (was not used before), false if already used.
   * @param {string} tokenStr
   * @returns {boolean}
   */
  checkAndMark(tokenStr) {
    if (!this._loaded) {
      throw new Error('UsedTokensStore not loaded. Call loadOnStartup() first.');
    }

    if (this._tokens.has(tokenStr)) {
      return false; // Already used
    }

    this._tokens.set(tokenStr, Date.now());
    this._debouncedSave();
    return true;
  }

  /**
   * Check if a token has been used (without marking).
   * @param {string} tokenStr
   * @returns {boolean}
   */
  isUsed(tokenStr) {
    return this._tokens.has(tokenStr);
  }

  /**
   * Get the number of stored tokens.
   * @returns {number}
   */
  size() {
    return this._tokens.size;
  }

  /**
   * Remove entries older than TTL.
   * @returns {number} Number of entries cleaned
   */
  cleanExpired() {
    const now = Date.now();
    let cleaned = 0;
    for (const [token, ts] of this._tokens) {
      if (now - ts > this.ttlMs) {
        this._tokens.delete(token);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[used-tokens] Cleaned ${cleaned} expired entries`);
      this._saveSync();
    }
    return cleaned;
  }

  /**
   * Save the store to disk synchronously (immediate).
   */
  _saveSync() {
    try {
      const dir = path.dirname(this.storeFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this._tokens);
      fs.writeFileSync(this.storeFile, JSON.stringify(data), 'utf-8');
    } catch (err) {
      console.warn(`[used-tokens] Failed to save store: ${err.message}`);
    }
  }

  /**
   * Debounced save — batches multiple checkAndMark calls into a single write.
   */
  _debouncedSave() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
    }
    this._saveTimeout = setTimeout(() => {
      this._saveTimeout = null;
      this._saveSync();
    }, DEBOUNCE_WRITE_MS);
  }

  /**
   * Start the periodic cleanup timer.
   */
  _startCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }
    this._cleanupTimer = setInterval(() => {
      this.cleanExpired();
    }, this.cleanupIntervalMs);

    // Allow the timer to not prevent process exit
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  /**
   * Stop the cleanup timer and flush writes.
   */
  async shutdown() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
    }
    this._saveSync();
  }
}

module.exports = { UsedTokensStore };
