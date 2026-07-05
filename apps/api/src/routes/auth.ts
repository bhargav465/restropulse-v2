import express, { Request, Response } from 'express';
import { findUserByEmail, findUserByPhone, findUserById, createUser, findUserByFirebaseUid, updateUser, getOtpChallengesCollection } from '@restropulse/db';
import { AuthResponse, LoginRequest, OtpRequest, OtpVerifyRequest } from '@restropulse/shared';
import { generateTokens, verifyToken, refreshAccessToken } from '../services/jwt.js';
import { verifyFirebaseToken, isFirebaseInitialized } from '../services/firebase-admin.js';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { createLogger } from '@restropulse/telemetry/server';
import { hashForCorrelation } from '@restropulse/telemetry';

const log = createLogger('auth');

const router = express.Router();

// Generate 6-digit OTP (for development fallback)
function generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ============================================
// Firebase Authentication (Primary - Production)
// ============================================

/**
 * Verify Firebase ID token and create/login user
 * This is the primary authentication method for production
 */
router.post('/firebase', handle(async (req: Request, res: Response) => {
    const { idToken } = req.body;

    if (!idToken) {
        return res.status(400).json({
            success: false,
            message: 'Firebase ID token required'
        });
    }

    // Verify the Firebase token
    const decodedToken = await verifyFirebaseToken(idToken);

    if (!decodedToken) {
        return res.status(401).json({
            success: false,
            message: 'Invalid Firebase token'
        });
    }

    const { uid, phone_number: phone } = decodedToken;

    if (!phone) {
        return res.status(400).json({
            success: false,
            message: 'Phone number not found in token'
        });
    }

    // Find user by Firebase UID or phone
    let user = await findUserByFirebaseUid(uid);

    if (!user) {
        // Check if user exists with this phone (migrating from old auth)
        user = await findUserByPhone(phone);

        if (user) {
            // Link existing user to Firebase UID
            user = await updateUser(user.id, { firebaseUid: uid });
        } else {
            // Create new user - use phone-based unique email placeholder
            user = await createUser({
                name: 'Restaurant Owner',
                email: `${phone.replace('+', '')}@phone.restropulse.local`,
                phone,
                firebaseUid: uid,
                role: 'OWNER',
                restaurantId: ''
            });
        }
    }

    if (!user) {
        return res.status(500).json({
            success: false,
            message: 'Failed to create or find user'
        });
    }

    // Generate our own JWT tokens for API authorization
    const tokens = generateTokens(user.id, phone, user.restaurantId, user.role);

    res.json({
        success: true,
        user,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        restaurantId: user.restaurantId,
        message: 'Login successful'
    });
}));

// ============================================
// Fallback OTP Authentication (Development)
// ============================================

// Send OTP endpoint (fallback for development when Firebase is not available)
router.post('/send-otp', handle(async (req: Request<{}, {}, OtpRequest>, res: Response) => {
    const { phone } = req.body;

    if (!phone || !/^\+91\d{10}$/.test(phone)) {
        return res.status(400).json({
            success: false,
            message: 'Valid Indian phone number required (+91XXXXXXXXXX)'
        });
    }

    // Generate OTP
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store OTP in DB (upsert by phone to replace any existing challenge)
    const col = getOtpChallengesCollection();
    await col.deleteMany({ phone });
    await col.insertOne({ phone, otp, expiresAt, attempts: 0 });

    // Log OTP for development
    log.debug({ phoneHash: hashForCorrelation(phone) }, 'OTP generated');

    res.json({
        success: true,
        message: 'OTP sent successfully',
        // Include OTP in development for testing
        ...(process.env.NODE_ENV !== 'production' && { devOtp: otp })
    });
}));

// Verify OTP and login
router.post('/verify-otp', handle(async (req: Request<{}, {}, OtpVerifyRequest>, res: Response) => {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
        return res.status(400).json({
            success: false,
            message: 'Phone and OTP are required'
        });
    }

    const col = getOtpChallengesCollection();
    const stored = await col.findOne({ phone }) as any;

    // Check if OTP exists
    if (!stored) {
        return res.status(400).json({
            success: false,
            message: 'OTP expired or not found. Please request a new one.'
        });
    }

    // Check expiration
    if (new Date() > new Date(stored.expiresAt)) {
        await col.deleteOne({ phone });
        return res.status(400).json({
            success: false,
            message: 'OTP has expired. Please request a new one.'
        });
    }

    // Check attempts
    if (stored.attempts >= 3) {
        await col.deleteOne({ phone });
        return res.status(400).json({
            success: false,
            message: 'Too many attempts. Please request a new OTP.'
        });
    }

    // Verify OTP
    if (stored.otp !== otp) {
        await col.updateOne({ phone }, { $inc: { attempts: 1 } });
        const remaining = 3 - (stored.attempts + 1);
        return res.status(401).json({
            success: false,
            message: `Invalid OTP. ${remaining} attempts remaining.`
        });
    }

    // OTP verified - clear it
    await col.deleteOne({ phone });

    // Find or create user
    let user = await findUserByPhone(phone);

    if (!user) {
        // Auto-create user on first login - use phone-based unique email placeholder
        user = await createUser({
            name: 'Restaurant Owner',
            email: `${phone.replace('+', '')}@phone.restropulse.local`,
            phone,
            role: 'OWNER',
            restaurantId: ''
        });
    }

    // Generate JWT tokens
    const tokens = generateTokens(user.id, phone, user.restaurantId, user.role);

    res.json({
        success: true,
        user,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        restaurantId: user.restaurantId,
        message: 'Login successful'
    });
}));

// Refresh token endpoint
router.post('/refresh', handle(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({
            success: false,
            message: 'Refresh token required'
        });
    }

    const newAccessToken = refreshAccessToken(refreshToken);

    if (!newAccessToken) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired refresh token'
        });
    }

    res.json({
        success: true,
        token: newAccessToken
    });
}));

// Legacy email/password login (for backwards compatibility)
router.post('/login', handle(async (req: Request<{}, {}, LoginRequest>, res: Response<AuthResponse>) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            message: 'Email and password are required'
        });
    }

    const user = await findUserByEmail(email);

    if (user && password) {
        const tokens = generateTokens(user.id, user.phone, user.restaurantId, user.role);
        res.json({
            success: true,
            user,
            token: tokens.accessToken,
            message: 'Login successful'
        });
    } else {
        res.status(401).json({
            success: false,
            message: 'Invalid credentials'
        });
    }
}));

// Logout endpoint
router.post('/logout', (_req: Request, res: Response) => {
    // In a full implementation, you'd invalidate the refresh token here
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

// Session check / Get current user
router.get('/session', handle(async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'No token provided'
        });
    }

    const payload = verifyToken(token);

    if (!payload || payload.type !== 'access') {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }

    const user = await findUserById(payload.userId);

    if (!user) {
        return res.status(401).json({
            success: false,
            message: 'User not found'
        });
    }

    res.json({
        success: true,
        user
    });
}));

router.post('/verify-email', requireAuth, handle(async (req: Request, res: Response) => {
    const { idToken, devEmail } = req.body;
    const userId = req.user!.userId;

    // Dev-only escape hatch: accept an explicit `devEmail` body field when running
    // outside production. This unblocks Playwright/CI tests that don't have access
    // to a real email inbox to click the magic link. Production requests must take
    // the Firebase ID token path below.
    if (devEmail && process.env.NODE_ENV !== 'production') {
        await updateUser(userId, { email: devEmail, emailVerified: true });
        log.warn({ userId, devEmail }, 'verify-email: dev bypass used');
        return res.json({ success: true, message: 'Email verified (dev bypass)' });
    }

    if (!idToken) {
        return res.status(400).json({ success: false, error: 'idToken is required' });
    }

    if (!isFirebaseInitialized()) {
        return res.status(503).json({ success: false, error: 'Email verification service not configured' });
    }

    const decoded = await verifyFirebaseToken(idToken);
    if (!decoded) {
        return res.status(401).json({ success: false, error: 'Invalid Firebase ID token' });
    }

    // The email and verification state come from the verified token, never from the
    // client. signInWithEmailLink populates email_verified=true automatically; for any
    // other sign-in method, the claim must be true to count as proof of ownership.
    const verifiedEmail = decoded.email;
    if (!verifiedEmail || decoded.email_verified !== true) {
        return res.status(400).json({ success: false, error: 'Token does not prove email ownership' });
    }

    await updateUser(userId, { email: verifiedEmail, emailVerified: true });
    res.json({ success: true, message: 'Email verified successfully' });
}));

export default router;
