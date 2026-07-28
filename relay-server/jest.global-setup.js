/**
 * Jest global setup — ensure a dev Blind RSA issuer keypair exists.
 *
 * The token tests read keys/issuer-private-key.pem and keys/issuer-public-key.pem.
 * Keys are gitignored (never committed), so a fresh checkout has none.
 * blind-rsa-keygen.js is idempotent: it skips generation if keys already exist.
 */
const { execFileSync } = require('child_process');
const path = require('path');

module.exports = async function globalSetup() {
  execFileSync(process.execPath, [path.join(__dirname, 'tokens', 'blind-rsa-keygen.js')], {
    stdio: 'inherit',
  });
};
