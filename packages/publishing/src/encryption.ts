/**
 * Encryption Service
 * Uses Node's native crypto module for AES-256-CBC encryption of sensitive tokens
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Get encryption key from environment variable
 * Key must be 32 bytes (64 hex characters) for AES-256
 */
function getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error('ENCRYPTION_KEY environment variable is not set');
    }

    // If key is hex string (64 chars), convert to buffer
    if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
        return Buffer.from(key, 'hex');
    }

    // If key is plain text, hash it to get 32 bytes
    return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt a string value
 * @param text - Plain text to encrypt
 * @returns Encrypted string in format: iv:encryptedData (both hex encoded)
 */
export function encrypt(text: string): string {
    if (!text) return '';

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Return IV and encrypted data together
    return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an encrypted string
 * @param encryptedText - Encrypted string in format: iv:encryptedData
 * @returns Decrypted plain text or null if failed
 */
export function decrypt(encryptedText: string): string | null {
    if (!encryptedText || !encryptedText.includes(':')) return null;

    try {
        const key = getEncryptionKey();
        const [ivHex, encrypted] = encryptedText.split(':');

        if (!ivHex || !encrypted) return null;

        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch {
        return null;
    }
}

/**
 * Generate a random encryption key (for initial setup)
 * @returns 64-character hex string suitable for ENCRYPTION_KEY env var
 */
export function generateEncryptionKey(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a CSRF state token for OAuth
 * @returns Random 32-character hex string
 */
export function generateStateToken(): string {
    return crypto.randomBytes(16).toString('hex');
}
