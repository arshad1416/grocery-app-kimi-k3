/**
 * Used Tokens Store — Persisted spent-set for single-use token enforcement.
 *
 * Provides checkAndMark(tokenStr) to atomically check-and-mark a token as used.
 * Persists to disk with debounced writes.
 *
 * DESIGN (double-spend closure — see GOAL_PROMPT_NOTES.md):
 * Spent records are kept PERMANENTLY, compacted by storing a SHA-256 hash of
 * the token instead of the token string. The token format (v2.<base64> =
 * 256-byte RSA signature || 32-byte client-chosen blinded nonce) carries no
 * expiry, no issuance timestamp and no epoch identifier, so the verifier has
 * no way to reject a token for being old — which means ANY finite TTL on the
 * spent set reopens a double-spend window the moment a record is pruned. The
 * former 24h TTL did exactly that. Hashing keeps the permanent set compact
 * (32 bytes of entropy per record instead of ~390 chars of token string) and
 * means the store never holds a spendable token value at rest.
 *
 * The ttlMs option is retained for construction compatibility but NO LONGER
 * causes spent records to be pruned; cleanExpired() is a deliberate no-op.
 *
 * Usage:
 *   const store = new UsedTokensStore();
 *   await store.loadOnStartup();
 *   const isNew = await store.checkAndMark(tokenStr);  // false if already used
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_STORE_FILE = path.join(__dirname, '..', 'used-tokens.json');
const DEBOUNCE_WRITE_MS = 500; // 500ms

/** SHA-256 hex digest of a token string (the stored key). */
function hashToken(tokenStr) {
  return crypto.createHash('sha256').update(tokenStr, 'utf-8').digest('hex');
}

/** Whether a persisted key already looks like a SHA-256 hex hash. */
function isHashedKey(key) {
  return /^[0-9a-f]{64}$/.test(key);
}

class UsedTokensStore {
  /**
   * @param {object} options
   * @param {string} [options.storeFile] - Path to the JSON store file
   * @param {number} [options.ttlMs] - Accepted for compatibility; spent
   *   records are permanent and are NOT pruned (see module doc).
   * @param {number} [options.cleanupIntervalMs] - Accepted for compatibility;
   *   no cleanup timer runs because nothing expires.
   */
  constructor(options = {}) {
    this.storeFile = options.storeFile || DEFAULT_STORE_FILE;
    this.ttlMs = options.ttlMs || null; // informational only — never prunes

    /** Map<sha256(tokenStr) hex, firstSpentAt timestamp> */
    this._tokens = new Map();
    this._saveTimeout = null;
    this._loaded = false;
  }

  /**
   * Load the store from disk. Must be called before using the store.
   * Legacy entries keyed on the raw token string are migrated to hashes.
   * Nothing is pruned on load — spent means spent, forever.
   * @returns {Promise<void>}
   */
  async loadOnStartup() {
    try {
      if (fs.existsSync(this.storeFile)) {
        const raw = fs.readFileSync(this.storeFile, 'utf-8');
        const data = JSON.parse(raw);
        let loaded = 0;
        let migrated = 0;
        for (const [key, ts] of Object.entries(data)) {
          if (isHashedKey(key)) {
            this._tokens.set(key, ts);
          } else {
            // Legacy raw-token entry from the pre-hash format
            this._tokens.set(hashToken(key), ts);
            migrated++;
          }
          loaded++;
        }
        console.log(
          `[used-tokens] Loaded ${loaded} entries (migrated ${migrated} legacy) from ${this.storeFile}`
        );
        if (migrated > 0) {
          this._saveSync();
        }
      } else {
        console.log(`[used-tokens] No store file found at ${this.storeFile}, starting fresh`);
      }
    } catch (err) {
      console.warn(`[used-tokens] Failed to load store: ${err.message}. Starting fresh.`);
    }
    this._loaded = true;
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

    const key = hashToken(tokenStr);
    if (this._tokens.has(key)) {
      return false; // Already used
    }

    this._tokens.set(key, Date.now());
    this._debouncedSave();
    return true;
  }

  /**
   * Check if a token has been used (without marking).
   * @param {string} tokenStr
   * @returns {boolean}
   */
  isUsed(tokenStr) {
    return this._tokens.has(hashToken(tokenStr));
  }

  /**
   * Get the number of stored tokens.
   * @returns {number}
   */
  size() {
    return this._tokens.size;
  }

  /**
   * Deliberate no-op. Spent-token records are permanent: the token format
   * has no expiry the verifier can check, so pruning a record makes the
   * token spendable again. Kept so existing callers/tests don't break.
   * @returns {number} Always 0.
   */
  cleanExpired() {
    return 0;
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
   * Flush pending writes.
   */
  async shutdown() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
    }
    this._saveSync();
  }
}

module.exports = { UsedTokensStore };
