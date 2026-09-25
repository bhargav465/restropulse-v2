import { describe, it, expect } from 'vitest';
import { requireSecrets } from '../../helpers/secrets.js';

const secrets = requireSecrets('auth-encryption', ['ENCRYPTION_KEY']);

describe('AES-256-CBC encryption round-trip', () => {
  it('encrypts and decrypts a token using the real ENCRYPTION_KEY', async () => {
    process.env.ENCRYPTION_KEY = secrets.ENCRYPTION_KEY;
    const { encrypt, decrypt } = await import('../../../../packages/publishing/src/encryption.js');
    const plaintext = 'EAAxxxxxx_fake_instagram_token_for_testing';
    const encrypted = encrypt(plaintext);
    expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertext on each call (random IV)', async () => {
    process.env.ENCRYPTION_KEY = secrets.ENCRYPTION_KEY;
    const { encrypt } = await import('../../../../packages/publishing/src/encryption.js');
    const token = 'same-plaintext';
    expect(encrypt(token)).not.toBe(encrypt(token));
  });

  it('returns null when decrypting with a wrong key', async () => {
    process.env.ENCRYPTION_KEY = secrets.ENCRYPTION_KEY;
    const { encrypt } = await import('../../../../packages/publishing/src/encryption.js');
    const encrypted = encrypt('test-token');
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    const { decrypt: decryptWrong } = await import('../../../../packages/publishing/src/encryption.js');
    expect(decryptWrong(encrypted)).toBeNull();
    process.env.ENCRYPTION_KEY = secrets.ENCRYPTION_KEY;
  });
});
