import { describe, it, expect } from 'vitest';
import { requireSecrets } from '../../helpers/secrets.js';

const secrets = requireSecrets('auth-jwt', ['JWT_SECRET']);

describe('JWT sign / verify', () => {
  it('signs and verifies an access token', async () => {
    process.env.JWT_SECRET = secrets.JWT_SECRET;
    const { generateTokens, verifyToken } = await import('../../../../apps/api/src/services/jwt.js');
    const userId = 'u_integration_test';
    const { accessToken } = generateTokens(userId, '+910000000000', undefined as any, 'RESTAURANT_OWNER');
    const payload = verifyToken(accessToken);
    expect(payload?.userId).toBe(userId);
  });

  it('generates a non-empty refresh token', async () => {
    process.env.JWT_SECRET = secrets.JWT_SECRET;
    const { generateTokens } = await import('../../../../apps/api/src/services/jwt.js');
    const { refreshToken } = generateTokens('u_test', '+910000000000', undefined as any, 'RESTAURANT_OWNER');
    expect(typeof refreshToken).toBe('string');
    expect(refreshToken.length).toBeGreaterThan(20);
  });
});
