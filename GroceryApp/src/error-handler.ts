// ─── Global Error Handler + Polyfills ────────────────────────────────────────
// This module has ZERO imports so it evaluates immediately when imported.
// It must be the FIRST import in index.ts to catch errors during evaluation
// of other modules (e.g. react-native-libsodium JSI install crashing).
//
// ErrorUtils is a global provided by React Native before any JS runs.
// Using globalThis avoids any import that would be hoisted past this code.

// ─── Global polyfills for isomorphic-webcrypto / lib0 compatibility ─────────
// lib0/random → lib0/webcrypto → global crypto / isomorphic-webcrypto
//
// On Hermes (RN's JS engine), browser globals like `navigator` and `document`
// don't exist, and `window` may not be defined either. isomorphic-webcrypto
// accesses these during module evaluation — missing globals throw a TypeError
// that crashes the app before React loads. Pre-populating fixes this.
// Also wires Hermes's native `crypto` to `window.crypto` so the correct
// implementation is used rather than a polyfill.

// 1. Provide `window` global
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = {};
}

// 2. Provide `navigator` — needed by isomorphic-webcrypto/browser.js
if (typeof (globalThis as any).navigator === 'undefined') {
  (globalThis as any).navigator = { userAgent: 'ReactNative' };
}

// 3. Provide `document` (minimal stub for isomorphic-webcrypto checks)
if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = { documentMode: undefined };
}

// 4. Wire native Hermes crypto to window.crypto (if Hermes provides it)
//    Hermes on RN 0.85+ provides globalThis.crypto with getRandomValues.
//    isomorphic-webcrypto's browser.js exports window.crypto, so we need
//    that to point at Hermes's native implementation.
if ((globalThis as any).crypto) {
  (globalThis as any).window.crypto = (globalThis as any).crypto;
} else {
  // Fallback: provide an empty crypto object so module evaluation doesn't crash
  (globalThis as any).window.crypto = {};
}

// 5. Ensure window.navigator is set (isomorphic-webcrypto/react-native.js checks it)
if (typeof (globalThis as any).window.navigator === 'undefined') {
  (globalThis as any).window.navigator = (globalThis as any).navigator;
}

const _globalErrorHandler = (error: any, isFatal?: boolean) => {
  const msg = error?.message ?? String(error);
  console.error(`[GlobalError] fatal=${isFatal}:`, error);
};

if (typeof (globalThis as any).ErrorUtils !== 'undefined') {
  (globalThis as any).ErrorUtils.setGlobalHandler(_globalErrorHandler);
}
