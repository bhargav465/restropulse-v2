/**
 * JWT Token Service
 * Handles token generation and verification
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'restropulse-dev-secret-change-in-production';
const ACCESS_TOKEN_EXPIRY = '15m';  // 15 minutes
const REFRESH_TOKEN_EXPIRY = '7d';  // 7 days

export interface TokenPayload {
    userId: string;
    phone: string;
    restaurantId: string;
    role: string;
    type: 'access' | 'refresh';
}

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
}

/**
 * Generate access and refresh tokens for a user
 */
export function generateTokens(userId: string, phone: string, restaurantId: string, role: string): TokenPair {
    const payload: TokenPayload = { userId, phone, restaurantId, role, type: 'access' };

    const accessToken = jwt.sign(
        { ...payload } as TokenPayload,
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    const refreshToken = jwt.sign(
        { ...payload, type: 'refresh' } as TokenPayload,
        JWT_SECRET,
        { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    return { accessToken, refreshToken };
}

/**
 * Verify and decode a token
 */
export function verifyToken(token: string): TokenPayload | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
        return decoded;
    } catch (error) {
        return null;
    }
}

/**
 * Refresh an access token using a valid refresh token
 */
export function refreshAccessToken(refreshToken: string): string | null {
    const payload = verifyToken(refreshToken);

    if (!payload || payload.type !== 'refresh') {
        return null;
    }

    const refreshPayload: TokenPayload = {
        userId: payload.userId,
        phone: payload.phone,
        restaurantId: payload.restaurantId,
        role: payload.role,
        type: 'access',
    };

    const accessToken = jwt.sign(
        refreshPayload,
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    return accessToken;
}
