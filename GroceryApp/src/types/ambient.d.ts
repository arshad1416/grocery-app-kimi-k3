/**
 * Ambient declarations.
 *
 * `global`: react-native-iap ships raw TypeScript sources (its package main
 * points at src/index.ts), so tsc type-checks them as part of this program.
 * Its debug util reads the React Native `global` object, and Expo's tsconfig
 * base provides no ambient declaration for it (skipLibCheck only covers
 * .d.ts files, not shipped .ts sources). Hermes provides `global` at runtime.
 */
declare var global: typeof globalThis & Record<string, unknown>;
