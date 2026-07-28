/**
 * Mock for react-native-libsodium.
 * Delegates to libsodium-wrappers (pure JS/WASM) for testing.
 * 
 * In tests, the test file's beforeAll() calls `await sodium.ready` on
 * libsodium-wrappers, which initializes the same singleton instance
 * that this mock re-exports.
 */
const sodium = require('libsodium-wrappers');
module.exports = sodium;
