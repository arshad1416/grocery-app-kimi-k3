/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { 
      tsconfig: 'tsconfig.test.json',
      useESM: false 
    }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$|@nozbe/watermelondb|yjs|libsodium-wrappers|expo-secure-store))',
  ],
  moduleNameMapper: {
    '^expo-secure-store$': '<rootDir>/__mocks__/expo-secure-store.ts',
    '^@nozbe/watermelondb$': '<rootDir>/__mocks__/watermelondb.ts',
    '^@nozbe/watermelondb/(.*)$': '<rootDir>/__mocks__/watermelondb.ts',
    '^react-native-libsodium$': '<rootDir>/__mocks__/react-native-libsodium.js',
  },
};