import express, { Request, Response } from 'express';
import { findUserByEmail, findUserByPhone, findUserById, createUser, findUserByFirebaseUid, updateUser, getOtpChallengesCollection, createRestaurant, findRestaurantBySlug } from '@restropulse/db';
import { AuthResponse, LoginRequest, RegisterRequest, OtpRequest, OtpVerifyRequest, User } from '@restropulse/shared';
import { generateTokens, verifyToken, refreshAccessToken } from '../services/jwt.js';
import { verifyFirebaseToken, isFirebaseInitialized } from '../services/firebase-admin.js';
import { hashPassword, verifyPassword } from '../services/password.js';
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

/**
 * Platform owner auto-promotion: accounts whose email matches
 * SUPER_ADMIN_EMAIL get the ADMIN role at login. ADMIN unlocks /api/super
 * (the super-admin dashboard).
 */
async function promoteSuperAdmin(user: User): Promise<User> {
    const superEmail = (process.env.SUPER_ADMIN_EMAIL || 'bhargav.tinku@gmail.com').toLowerCase();
    if (user.email?.toLowerCase() === superEmail && user.role !== 'ADMIN') {
        const updated = await updateUser(user.id, { role: 'ADMIN' });
        log.info({ userId: user.id }, 'Promoted super admin');
        return updated ?? { ...user, role: 'ADMIN' };
    }
    return user;
}

/** Never leak the bcrypt hash to clients. */
function sanitizeUser<T extends Partial<User> | null | undefined>(user: T): T {
    if (!user) return user;
    const { passwordHash: _ph, ...rest } = user as User;
    return rest as unknown as T;
}

/** Build a URL-safe, unique storefront slug from the restaurant name. */
async function uniqueSlug(name: string): Promise<string> {
    const base = name.toLowerCase().trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'restaurant';
    let slug = base;
    for (let i = 2; await findRestaurantBySlug(slug); i++) {
        slug = `${base}-${i}`;
        if (i > 50) { slug = `${base}-${Date.now().toString(36)}`; break; }
    }
    return slug;
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
        user: sanitizeUser(user),
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
        user: sanitizeUser(user),
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

// ============================================
// Email / Phone + Password authentication
// ============================================

/**
 * Restaurant self-signup: creates the OWNER user (with bcrypt password hash)
 * and their restaurant (slug + default ordering settings) in one step.
 */
router.post('/register', handle(async (req: Request<{}, {}, RegisterRequest>, res: Response) => {
    const { name, restaurantName, email, phone, password, cuisine } = req.body ?? {};

    if (!name || !restaurantName || !email || !phone || !password) {
        return res.status(400).json({ success: false, message: 'name, restaurantName, email, phone and password are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, message: 'Valid email required' });
    }
    const normalizedPhone = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '')}`;
    if (!/^\+\d{10,15}$/.test(normalizedPhone)) {
        return res.status(400).json({ success: false, message: 'Valid phone number required' });
    }
    if (password.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const [byEmail, byPhone] = await Promise.all([
        findUserByEmail(email.toLowerCase()),
        findUserByPhone(normalizedPhone),
    ]);

    // Platform-owner bootstrap: if a pre-existing account with the super-admin
    // email has NO password yet (e.g. legacy OTP-era user doc), registering
    // with that email claims it — sets the password and promotes to ADMIN.
    const superEmail = (process.env.SUPER_ADMIN_EMAIL || 'bhargav.tinku@gmail.com').toLowerCase();
    if (byEmail && byEmail.email?.toLowerCase() === superEmail && !byEmail.passwordHash) {
        const passwordHash = await hashPassword(password);
        let user = await updateUser(byEmail.id, { passwordHash, name }) ?? { ...byEmail, passwordHash, name };
        let restaurantIdForToken = user.restaurantId;
        let claimedSlug: string | null = null;
        if (!restaurantIdForToken) {
            const slug2 = await uniqueSlug(restaurantName);
            const r = await createRestaurant({
                name: restaurantName,
                cuisine: cuisine || 'Multi-cuisine',
                location: { address: '', lat: 0, lng: 0, mapUrl: '' },
                accountManager: { name: 'RestroPulse Team', phone: '', email: 'support@restropulse.app', avatar: '' },
                integrations: { instagram: false },
                slug: slug2,
                storeOpen: true,
                ordering: {
                    taxRatePercent: 5,
                    currency: 'INR',
                    delivery: { enabled: true, flatFee: 0, minOrder: 0 },
                    pickup: { enabled: true },
                    dineIn: { enabled: true },
                },
            });
            restaurantIdForToken = r.id;
            claimedSlug = slug2;
            user = await updateUser(user.id, { restaurantId: r.id }) ?? { ...user, restaurantId: r.id };
        }
        user = await promoteSuperAdmin(user);
        const tokens2 = generateTokens(user.id, user.phone, restaurantIdForToken, user.role);
        log.info({ userId: user.id }, 'Super-admin account claimed via register');
        return res.status(200).json({
            success: true,
            user: sanitizeUser(user),
            restaurant: { id: restaurantIdForToken, slug: claimedSlug },
            token: tokens2.accessToken,
            refreshToken: tokens2.refreshToken,
            restaurantId: restaurantIdForToken,
            message: 'Super-admin account claimed — password set',
        });
    }

    if (byEmail) return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    if (byPhone) return res.status(409).json({ success: false, message: 'An account with this phone number already exists' });

    const slug = await uniqueSlug(restaurantName);
    const restaurant = await createRestaurant({
        name: restaurantName,
        cuisine: cuisine || 'Multi-cuisine',
        location: { address: '', lat: 0, lng: 0, mapUrl: '' },
        accountManager: { name: 'RestroPulse Team', phone: '', email: 'support@restropulse.app', avatar: '' },
        integrations: { instagram: false },
        slug,
        storeOpen: true,
        ordering: {
            taxRatePercent: 5,
            currency: 'INR',
            delivery: { enabled: true, flatFee: 0, minOrder: 0 },
            pickup: { enabled: true },
            dineIn: { enabled: true },
        },
    });

    const passwordHash = await hashPassword(password);
    let user = await createUser({
        name,
        email: email.toLowerCase(),
        phone: normalizedPhone,
        role: 'OWNER',
        restaurantId: restaurant.id,
        passwordHash,
        emailVerified: false,
    } as Omit<User, 'id'>);
    user = await promoteSuperAdmin(user);

    const tokens = generateTokens(user.id, normalizedPhone, restaurant.id, user.role);
    log.info({ userId: user.id, restaurantId: restaurant.id, slug }, 'Restaurant registered');

    res.status(201).json({
        success: true,
        user: sanitizeUser(user),
        restaurant: { id: restaurant.id, slug },
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        restaurantId: restaurant.id,
        message: 'Registration successful',
    });
}));

/**
 * Super-admin password reset, guarded by SUPER_RESET_KEY (project env var,
 * set via the DEPLOYMENT repo secret). Only resets the SUPER_ADMIN_EMAIL
 * account. Disabled entirely when SUPER_RESET_KEY is unset.
 */
router.post('/reset-super-password', handle(async (req: Request, res: Response) => {
    const { setupKey, newPassword } = req.body ?? {};
    const expected = process.env.SUPER_RESET_KEY;
    if (!expected) {
        return res.status(404).json({ success: false, message: 'Not available' });
    }
    if (typeof setupKey !== 'string' || setupKey !== expected) {
        return res.status(403).json({ success: false, message: 'Invalid setup key' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
        return res.status(400).json({ success: false, message: 'newPassword must be at least 8 characters' });
    }
    const superEmail = (process.env.SUPER_ADMIN_EMAIL || 'bhargav.tinku@gmail.com').toLowerCase();
    const user = await findUserByEmail(superEmail);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Super-admin account not found' });
    }
    const passwordHash = await hashPassword(newPassword);
    let updated = await updateUser(user.id, { passwordHash }) ?? user;
    updated = await promoteSuperAdmin(updated);
    log.warn({ userId: user.id }, 'Super-admin password reset via SUPER_RESET_KEY');
    res.json({ success: true, message: 'Super-admin password reset', user: sanitizeUser(updated) });
}));

// Email or phone + password login
router.post('/login', handle(async (req: Request<{}, {}, LoginRequest>, res: Response<AuthResponse & { refreshToken?: string; restaurantId?: string }>) => {
    const { email, phone, password } = req.body ?? {};

    if ((!email && !phone) || !password) {
        return res.status(400).json({
            success: false,
            message: 'Email or phone, and password are required'
        });
    }

    let user = null;
    if (email) user = await findUserByEmail(email.toLowerCase()) ?? await findUserByEmail(email);
    if (!user && phone) {
        const normalizedPhone = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '')}`;
        user = await findUserByPhone(normalizedPhone) ?? await findUserByPhone(phone);
    }

    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
        return res.status(401).json({
            success: false,
            message: !user || user.passwordHash
                ? 'Invalid credentials'
                : 'This account has no password set. Log in with OTP, or register a new account.'
        });
    }

    user = await promoteSuperAdmin(user);

    const tokens = generateTokens(user.id, user.phone, user.restaurantId, user.role);
    res.json({
        success: true,
        user: sanitizeUser(user),
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        restaurantId: user.restaurantId,
        message: 'Login successful'
    });
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
        user: sanitizeUser(user)
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
