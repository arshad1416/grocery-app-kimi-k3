// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// No more Node.js built-in shim hacks — libsodium is now native JSI (not WASM).
// metro-shim.js is kept as a no-op safety net but is no longer wired in.

module.exports = config;
