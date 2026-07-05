import { describe, it, expect, beforeEach } from 'vitest';
import { encrypt, decrypt, generateStateToken } from '@restropulse/publishing';

describe('encryption service', () => {
    beforeEach(() => {
        process.env.ENCRYPTION_KEY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    });

    it('encrypts and decrypts text', () => {
        const plainText = 'sample-token-value';
        const encryptedText = encrypt(plainText);

        expect(encryptedText).not.toEqual(plainText);
        expect(encryptedText.includes(':')).toBe(true);
        expect(decrypt(encryptedText)).toEqual(plainText);
    });

    it('returns null for invalid encrypted input', () => {
        expect(decrypt('')).toBeNull();
        expect(decrypt('invalid')).toBeNull();
    });

    it('generates random state token', () => {
        const tokenOne = generateStateToken();
        const tokenTwo = generateStateToken();

        expect(tokenOne).not.toEqual(tokenTwo);
        expect(tokenOne.length).toBeGreaterThan(10);
    });
});
