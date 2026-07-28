module.exports = {
  globalSetup: './jest.global-setup.js',
  testEnvironment: 'node',
  transform: {},
  transformIgnorePatterns: [],
  testTimeout: 30000,
  globals: {},
};
process.env.NODE_OPTIONS = process.env.NODE_OPTIONS || '';
if (!process.env.NODE_OPTIONS.includes('--experimental-vm-modules')) {
  process.env.NODE_OPTIONS += ' --experimental-vm-modules';
}
