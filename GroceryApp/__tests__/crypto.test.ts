/**
 * Crypto layer tests — libsodium XChaCha20-Poly1305 + Argon2id KDF
 */
import sodium from 'libsodium-wrappers';
import {
  initCrypto, deriveKeyFromPassphrase, encrypt, decrypt,
  generateUUID, generateSalt, setupMasterKey, getMasterKey,
  verifyAndGetMasterKey, clearMasterKey, hasMasterKey, deriveSyncKey,
} from '../src/crypto/index';
import * as SecureStore from 'expo-secure-store';

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

beforeAll(async () => {
  await sodium.ready;
  await initCrypto();
});

describe('Key Derivation', () => {
  const passphrase = 'test-family-passphrase';
  let salt: Uint8Array;

  beforeAll(async () => {
    salt = await generateSalt();
  });

  test('produces consistent key for same passphrase+salt', async () => {
    const key1 = await deriveKeyFromPassphrase(passphrase, salt);
    const key2 = await deriveKeyFromPassphrase(passphrase, salt);
    expect(key1).toEqual(key2);
  });

  test('produces different key for different passphrase', async () => {
    const salt2 = await generateSalt();
    const key1 = await deriveKeyFromPassphrase('passphrase-a', salt);
    const key2 = await deriveKeyFromPassphrase('passphrase-b', salt2);
    expect(key1).not.toEqual(key2);
  });

  test('NFKC normalization handles unicode', async () => {
    const key1 = await deriveKeyFromPassphrase('caf\u00e9', salt);
    const key2 = await deriveKeyFromPassphrase('caf\u0065\u0301', salt);
    expect(key1).toEqual(key2);
  });
});

describe('Encrypt/Decrypt', () => {
  let key: Uint8Array;

  beforeAll(async () => {
    key = await deriveKeyFromPassphrase('test', await generateSalt());
  });

  test('encrypt produces different ciphertext each time', async () => {
    const a = await encrypt('hello', key);
    const b = await encrypt('hello', key);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
    expect(a.iv).not.toEqual(b.iv);
  });

  test('encrypt/decrypt round-trip with AAD', async () => {
    const ct = await encrypt('milk', key, 'grocery_item.name');
    const pt = await decrypt(ct, key, 'grocery_item.name');
    expect(pt).toBe('milk');
  });

  test('decrypt with wrong AAD fails', async () => {
    const ct = await encrypt('secret', key, 'field_a');
    await expect(decrypt(ct, key, 'field_b')).rejects.toThrow();
  });

  test('decrypt with wrong key fails', async () => {
    const ct = await encrypt('data', key);
    const wrongKey = await deriveKeyFromPassphrase('wrong', await generateSalt());
    await expect(decrypt(ct, wrongKey)).rejects.toThrow();
  });

  test('encrypt/decrypt empty string', async () => {
    const ct = await encrypt('', key);
    const pt = await decrypt(ct, key);
    expect(pt).toBe('');
  });

  test('encrypt/decrypt long text', async () => {
    const long = 'a'.repeat(10000);
    const ct = await encrypt(long, key);
    const pt = await decrypt(ct, key);
    expect(pt).toBe(long);
  });
});

describe('UUID Generation', () => {
  test('generates valid UUID v4', async () => {
    const uuid = await generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  test('generates unique IDs', async () => {
    const ids = await Promise.all(Array.from({ length: 100 }, () => generateUUID()));
    expect(new Set(ids).size).toBe(100);
  });
});

describe('Sync Key Derivation', () => {
  let masterKey: Uint8Array;

  beforeAll(async () => {
    masterKey = await deriveKeyFromPassphrase('test', await generateSalt());
  });

  test('deriveSyncKey produces consistent key', async () => {
    const k1 = await deriveSyncKey(masterKey);
    const k2 = await deriveSyncKey(masterKey);
    expect(k1).toEqual(k2);
  });

  test('deriveSyncKey produces different key than master', async () => {
    const syncKey = await deriveSyncKey(masterKey);
    expect(syncKey).not.toEqual(masterKey);
  });
});

describe('Master Key Management', () => {
  const passphrase = 'family-secret';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('setupMasterKey stores key', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    await setupMasterKey(passphrase);
    // Setup stores the key — grab it for the mock
    const keyCall = (SecureStore.setItemAsync as jest.Mock).mock.calls[0];
    const storedVal = keyCall[1];
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedVal);

    const stored = await getMasterKey();
    expect(stored).toBeInstanceOf(Uint8Array);
    expect(stored!.length).toBe(32);
  });

  test('verifyAndGetMasterKey succeeds with correct passphrase', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    await setupMasterKey(passphrase);
    // Setup stores the key — grab it for the mock
    const keyCall = (SecureStore.setItemAsync as jest.Mock).mock.calls[0];
    const storedVal = keyCall[1];
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedVal);

    const result = await verifyAndGetMasterKey(passphrase);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  test('hasMasterKey returns correct state', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    expect(await hasMasterKey()).toBe(false);
    await setupMasterKey(passphrase);
    // Re-mock after setup
    const keyCall = (SecureStore.setItemAsync as jest.Mock).mock.calls[0];
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(keyCall[1]);
    expect(await hasMasterKey()).toBe(true);
  });

  test('clearMasterKey removes key', async () => {
    await clearMasterKey();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
  });
});