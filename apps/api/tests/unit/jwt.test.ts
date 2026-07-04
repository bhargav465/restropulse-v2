
import { describe, test, expect } from 'vitest';
import { generateTokens, verifyToken, refreshAccessToken } from '../../src/services/jwt.js';
import jwt from 'jsonwebtoken';

describe('JWT Service', () => {
    const userId = 'user-123';
    const phone = '1234567890';
    const restaurantId = "r1";

    describe('generateTokens', () => {
        it('should generate access and refresh tokens', () => {
            const tokens = generateTokens(userId, phone, restaurantId, 'OWNER');

            expect(tokens.accessToken).toBeDefined();
            expect(tokens.refreshToken).toBeDefined();

            const decodedAccess = jwt.decode(tokens.accessToken) as any;
            const decodedRefresh = jwt.decode(tokens.refreshToken) as any;

            expect(decodedAccess.userId).toBe(userId);
            expect(decodedAccess.type).toBe('access');
            expect(decodedRefresh.userId).toBe(userId);
            expect(decodedRefresh.type).toBe('refresh');
        });
    });

    describe('verifyToken', () => {
        it('should verify valid token', () => {
            const { accessToken } = generateTokens(userId, phone, restaurantId, 'OWNER');
            const decoded = verifyToken(accessToken);

            expect(decoded).toBeTruthy();
            expect(decoded?.userId).toBe(userId);
        });

        it('should return null for invalid token', () => {
            const decoded = verifyToken('invalid-token');
            expect(decoded).toBeNull();
        });
    });

    describe('refreshAccessToken', () => {
        it('should issue new access token with valid refresh token', () => {
            const { refreshToken } = generateTokens(userId, phone, restaurantId, 'OWNER');
            const newAccessToken = refreshAccessToken(refreshToken);

            expect(newAccessToken).toBeDefined();
            const decoded = verifyToken(newAccessToken!);
            expect(decoded?.type).toBe('access');
            expect(decoded?.userId).toBe(userId);
        });

        it('should return null for invalid refresh token', () => {
            const result = refreshAccessToken('invalid-token');
            expect(result).toBeNull();
        });

        it('should return null for access token passed as refresh token', () => {
            const { accessToken } = generateTokens(userId, phone, restaurantId, 'OWNER');
            const result = refreshAccessToken(accessToken);
            expect(result).toBeNull();
        });
    });
});
