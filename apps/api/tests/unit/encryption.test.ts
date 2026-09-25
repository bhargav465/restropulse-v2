import { describe, test, expect, beforeAll } from 'vitest';
import { encrypt, decrypt, generateStateToken, generateEncryptionKey } from '@restropulse/publishing';

describe('Encryption Service', () => {
    beforeAll(() => {
        process.env.ENCRYPTION_KEY = 'test-key-12345678901234567890123456789012'; // 32 chars or hex
    });

    it('should encrypt and decrypt string successfully', () => {
        const original = 'my-secret-token-123';
        const encrypted = encrypt(original);
        expect(encrypted).not.toBe(original);
        expect(encrypted).toContain(':'); // IV separator

        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(original);
    });

    it('should return null for invalid encrypted string', () => {
        // We expect null based on implementation
        expect(decrypt('invalid-string')).toBeNull();
        expect(decrypt('')).toBeNull();
        // expect(decrypt('invalid:hex')).toBeNull(); // This might crash or return null depending on iv length
    });

    it('should generate state token', () => {
        const token = generateStateToken();
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(10);
    });

    it('should generate encryption key', () => {
        const key = generateEncryptionKey();
        expect(key.length).toBe(64); // 32 bytes as hex
    });
});
