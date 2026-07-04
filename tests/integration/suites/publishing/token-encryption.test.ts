import { describe, it, expect } from 'vitest';
import { requireSecrets } from '../../helpers/secrets.js';

const secrets = requireSecrets('publishing-encryption', ['ENCRYPTION_KEY']);

describe('Instagram token encryption round-trip', () => {
  it('encrypts and decrypts a token via the publishing package', async () => {
    process.env.ENCRYPTION_KEY = secrets.ENCRYPTION_KEY;
    const { encrypt, decrypt } = await import('../../../../packages/publishing/src/encryption.js');
    const token = `EAA${secrets.ENCRYPTION_KEY.slice(0, 20)}LONGTOKEN`;
    const stored = encrypt(token);
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/);
    expect(decrypt(stored)).toBe(token);
  });

  it('stored tokens are non-deterministic (random IV per call)', async () => {
    process.env.ENCRYPTION_KEY = secrets.ENCRYPTION_KEY;
    const { encrypt } = await import('../../../../packages/publishing/src/encryption.js');
    const t = 'same_token_value';
    expect(encrypt(t)).not.toBe(encrypt(t));
  });
});
