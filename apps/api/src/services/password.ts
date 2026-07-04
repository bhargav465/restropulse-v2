/**
 * Password hashing service for storefront customer accounts.
 * Uses bcryptjs (pure JS, no native build step).
 */

import bcrypt from 'bcryptjs';

/** Salt rounds for bcrypt. Constant by design — not env-configurable. */
export const BCRYPT_SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
}
