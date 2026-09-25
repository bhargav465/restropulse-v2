// Set INSTAGRAM_APP_SECRET before any module imports to ensure it's available 
// when integrations.ts module is loaded
process.env.INSTAGRAM_APP_SECRET = 'test-app-secret';

import { describe, it, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
const { encrypt } = await import('../../../../packages/publishing/dist/encryption.js');

// Define Mocks for Services
const mockGenerateOAuthUrl = vi.fn();
const mockHandleOAuthCallback = vi.fn();
const mockIsInstagramConfigured = vi.fn();
const mockGetInstagramProfile = vi.fn();
const mockValidateStateToken = vi.fn();
const mockCheckAndRefreshTokenIfNeeded = vi.fn();
const mockValidateToken = vi.fn();
const mockGetRestaurantsCollection = vi.fn();
const mockAxiosGet = vi.fn();
const mockAxiosPost = vi.fn();

// Mock Services
vi.mock('@restropulse/publishing', () => ({
    generateOAuthUrl: mockGenerateOAuthUrl,
    handleOAuthCallback: mockHandleOAuthCallback,
    isInstagramConfigured: mockIsInstagramConfigured,
    getInstagramProfile: mockGetInstagramProfile,
    validateStateToken: mockValidateStateToken,
    prepareCredentialsForStorage: vi.fn((account: any, token, expiresAt) => ({
        userId: account.id,
        accessToken: 'encrypted_token',
        tokenExpiresAt: expiresAt,
        username: account.username,
        name: account.name
    })),
    refreshAccessToken: vi.fn(),
    validateToken: mockValidateToken,
    checkAndRefreshTokenIfNeeded: mockCheckAndRefreshTokenIfNeeded,
    triggerManualRefresh: vi.fn(),
    encrypt: vi.fn((val: string) => `iv_hex:${val}`),
    decrypt: vi.fn((val: string) => val && val.includes(':') ? val.split(':').slice(1).join(':') : null)
}));

vi.mock('axios', () => ({
    default: {
        get: mockAxiosGet,
        post: mockAxiosPost,
        create: vi.fn(() => ({
            get: mockAxiosGet,
            post: mockAxiosPost,
            interceptors: {
                request: { use: vi.fn() },
                response: { use: vi.fn() }
            }
        }))
    }
}));

// Mock Database Connection
vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        getRestaurantsCollection: mockGetRestaurantsCollection
    };
});

// Import actual implementation using vi.importActual to get real implementations
let realConnection: any;

// Helper to reset mocks
const useActualImplementation = async () => {
    if (!realConnection) {
        realConnection = await vi.importActual('@restropulse/db');
    }
    mockGetRestaurantsCollection.mockImplementation(realConnection.getRestaurantsCollection);
};

// Import App (Dynamic)
const { createTestApp } = await import('../helpers/testHelper.js');
const app = createTestApp();

describe('Integration Routes', () => {

    beforeEach(async () => {
        vi.clearAllMocks();
        await useActualImplementation(); // Default to real DB

        // Seed Data
        const col = realConnection.getRestaurantsCollection();
        await col.deleteMany({});
        await col.insertOne({
            _id: 'r1',
            id: 'r1',
            name: 'Test Restaurant',
            instagramCredentials: {
                accessToken: 'valid-token',
                tokenExpiresAt: new Date(Date.now() + 86400000)
            }
        } as any);
    });

    describe('GET /api/integrations/instagram/oauth-url', () => {
        it('should return oauth url', async () => {
            mockIsInstagramConfigured.mockReturnValue(true);
            mockGenerateOAuthUrl.mockReturnValue({
                url: 'https://instagram.com/oauth',
                state: 'mock-state'
            });

            const response = await request(app)
                .get('/api/integrations/instagram/oauth-url')
                .query({ restaurantId: 'r1' });

            expect(response.status).toBe(200);
            expect(response.body.data.oauthUrl).toBe('https://instagram.com/oauth');
        });

        it('should pass onboarding=false by default', async () => {
            mockIsInstagramConfigured.mockReturnValue(true);
            mockGenerateOAuthUrl.mockReturnValue({ url: 'https://test', state: 's' });

            await request(app)
                .get('/api/integrations/instagram/oauth-url')
                .query({ restaurantId: 'r1' });

            expect(mockGenerateOAuthUrl).toHaveBeenCalledWith('r1', false);
        });

        it('should pass onboarding=true when specified', async () => {
            mockIsInstagramConfigured.mockReturnValue(true);
            mockGenerateOAuthUrl.mockReturnValue({ url: 'https://test', state: 's' });

            await request(app)
                .get('/api/integrations/instagram/oauth-url')
                .query({ restaurantId: 'r1', onboarding: 'true' });

            expect(mockGenerateOAuthUrl).toHaveBeenCalledWith('r1', true);
        });

        it('should return error if not configured', async () => {
            mockIsInstagramConfigured.mockReturnValue(false);

            const response = await request(app)
                .get('/api/integrations/instagram/oauth-url')
                .query({ restaurantId: 'r1' });

            expect(response.status).toBe(503);
        });

        it('should fail without restaurantId', async () => {
            const response = await request(app)
                .get('/api/integrations/instagram/oauth-url');

            expect(response.status).toBe(400);
        });

        it('should handle generation error', async () => {
            mockIsInstagramConfigured.mockReturnValue(true);
            mockGenerateOAuthUrl.mockImplementation(() => { throw new Error('Gen failed'); });

            const response = await request(app)
                .get('/api/integrations/instagram/oauth-url')
                .query({ restaurantId: 'r1' });

            expect(response.status).toBe(500);
        });
    });

    describe('GET /api/integrations/instagram/callback', () => {
        it('should redirect on missing params', async () => {
            const response = await request(app)
                .get('/api/integrations/instagram/callback');

            expect(response.status).toBe(302);
            expect(response.header.location).toContain('error=missing_params');
        });

        it('should redirect on oauth error', async () => {
            const response = await request(app)
                .get('/api/integrations/instagram/callback')
                .query({ error: 'access_denied', error_description: 'User denied' });

            expect(response.status).toBe(302);
            expect(response.header.location).toContain('error=oauth_denied');
        });

        it('should redirect on invalid state token', async () => {
            mockValidateStateToken.mockReturnValue({ valid: false });

            const response = await request(app)
                .get('/api/integrations/instagram/callback')
                .query({ code: 'valid-code', state: 'invalid-state' });

            expect(response.status).toBe(302);
            expect(response.header.location).toContain('error=invalid_state');
        });

        it('should process callback and show selection', async () => {
            mockValidateStateToken.mockReturnValue({ valid: true, restaurantId: 'r1' });
            const expires = new Date(Date.now() + 3600000);

            mockHandleOAuthCallback.mockResolvedValue({
                success: true,
                account: { id: 'ig-123', name: 'IG Page', pageName: 'FB Page' },
                accessToken: 'token-123',
                tokenExpiresAt: expires,
                restaurantId: 'r1'
            });

            const response = await request(app)
                .get('/api/integrations/instagram/callback')
                .query({ code: 'valid-code', state: 'valid-state' });

            expect(response.status).toBe(302);
            expect(response.header.location).toContain('success=true');
        });

        it('should call handleOAuthCallback with skipStateValidation=true', async () => {
            mockValidateStateToken.mockReturnValue({ valid: true, restaurantId: 'r1' });
            mockHandleOAuthCallback.mockResolvedValue({
                success: true,
                account: { id: 'ig-1', username: 'test', pageName: 'Page' },
                accessToken: 't',
                tokenExpiresAt: new Date()
            });

            await request(app)
                .get('/api/integrations/instagram/callback')
                .query({ code: 'c', state: 's' });

            // Verify skipStateValidation=true was passed
            expect(mockHandleOAuthCallback).toHaveBeenCalledWith('c', 's', true);
        });

        it('should handle multiple accounts selection', async () => {
            mockValidateStateToken.mockReturnValue({ valid: true, restaurantId: 'r1' });
            const expires = new Date(Date.now() + 3600000);

            mockHandleOAuthCallback.mockResolvedValue({
                success: true,
                account: { id: 'ig-123', name: 'IG Page', pageName: 'FB Page' },
                accessToken: 'token-123',
                tokenExpiresAt: expires,
                restaurantId: 'r1'
            });

            const response = await request(app)
                .get('/api/integrations/instagram/callback')
                .query({ code: 'valid-code', state: 'valid-state' });

            expect(response.status).toBe(302);
            expect(response.header.location).toContain('success=true');
        });

        it('should handle multiple accounts selection', async () => {
            mockValidateStateToken.mockReturnValue({ valid: true, restaurantId: 'r1' });

            mockHandleOAuthCallback.mockResolvedValue({
                success: true,
                accounts: [
                    { id: '1', name: 'A', pageName: 'PA' },
                    { id: '2', name: 'B', pageName: 'PB' }
                ],
                accessToken: 'token-123',
                tokenExpiresAt: new Date(),
                restaurantId: 'r1'
            });

            const response = await request(app)
                .get('/api/integrations/instagram/callback')
                .query({ code: 'valid-code', state: 'valid-state' });

            expect(response.status).toBe(302);
            expect(response.header.location).toContain('select=true');
        });

        it('should handle failure from service', async () => {
            mockValidateStateToken.mockReturnValue({ valid: true, restaurantId: 'r1' });
            mockHandleOAuthCallback.mockReturnValue({
                success: false,
                error: 'connection_failed'
            });

            const response = await request(app)
                .get('/api/integrations/instagram/callback')
                .query({ code: 'valid-code', state: 'valid-state' });

            expect(response.status).toBe(302);
            expect(response.header.location).toContain('error=connection_failed');
        });

        it('should handle exception during callback', async () => {
            mockValidateStateToken.mockImplementation(() => { throw new Error('Boom'); });

            const response = await request(app)
                .get('/api/integrations/instagram/callback')
                .query({ code: 'c', state: 's' });

            expect(response.status).toBe(302);
            expect(response.header.location).toContain('error=server_error');
        });

        it('should redirect with error=unknown when success=true but no account or accounts (covers line 206)', async () => {
            // validateStateToken is valid, but handleOAuthCallback returns success=true with neither account nor accounts
            mockValidateStateToken.mockReturnValue({ valid: true, restaurantId: 'r1' });
            mockHandleOAuthCallback.mockResolvedValue({
                success: true
                // no account, no accounts array
            });

            const response = await request(app)
                .get('/api/integrations/instagram/callback')
                .query({ code: 'code-fallthru', state: 'state-fallthru' });

            expect(response.status).toBe(302);
            expect(response.header.location).toContain('error=unknown');
        });
    });

    describe('POST /api/integrations/instagram/callback', () => {
        it('should handle missing params', async () => {
            const res = await request(app).post('/api/integrations/instagram/callback').send({});
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('MISSING_PARAMS');
        });

        it('should handle service failure', async () => {
            mockHandleOAuthCallback.mockResolvedValue({ success: false, error: 'fail' });
            const res = await request(app).post('/api/integrations/instagram/callback').send({ code: 'c', state: 's' });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('fail');
        });

        it('should return single account directly when result.account is present (covers line 241)', async () => {
            // Single account path - result.account is set, no accounts array
            mockHandleOAuthCallback.mockResolvedValue({
                success: true,
                account: { id: 'ig-single', username: 'single_user', name: 'Single User' },
                accessToken: 'tok-single',
                tokenExpiresAt: new Date()
            });

            const res = await request(app)
                .post('/api/integrations/instagram/callback')
                .send({ code: 'code-single', state: 'state-single' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.account.id).toBe('ig-single');
            expect(res.body.data.requiresSelection).toBe(false);
        });

        it('should return 500 UNKNOWN_ERROR when success=true but no account or accounts (covers line 283)', async () => {
            // Neither result.account nor result.accounts is set -> unknown error path
            mockHandleOAuthCallback.mockResolvedValue({
                success: true
                // no account, no accounts
            });

            const res = await request(app)
                .post('/api/integrations/instagram/callback')
                .send({ code: 'code-unknown', state: 'state-unknown' });

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('UNKNOWN_ERROR');
        });

        it('should return 500 SERVER_ERROR when handleOAuthCallback throws (covers lines 289-290)', async () => {
            mockHandleOAuthCallback.mockRejectedValue(new Error('Unexpected OAuth error'));

            const res = await request(app)
                .post('/api/integrations/instagram/callback')
                .send({ code: 'code-err', state: 'state-err' });

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('SERVER_ERROR');
        });
    });

    describe('GET /api/integrations/instagram/status/:restaurantId', () => {
        it('should return status', async () => {
            // Setup DB state
            const col = realConnection.getRestaurantsCollection();
            await col.updateOne({ _id: 'r1' } as any, {
                $set: {
                    integrations: { instagram: true },
                    instagramCredentials: {
                        username: 'my_ig',
                        tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
                    }
                }
            });

            const response = await request(app)
                .get('/api/integrations/instagram/status/r1');

            expect(response.status).toBe(200);
            expect(response.body.data.connected).toBe(true);
        });

        it('should return connected=false when instagram integration flag is false (covers line 484)', async () => {
            // instagramCredentials exists but integrations.instagram is false
            const col = realConnection.getRestaurantsCollection();
            await col.updateOne({ _id: 'r1' } as any, {
                $set: {
                    integrations: { instagram: false },
                    instagramCredentials: { username: 'my_ig', tokenExpiresAt: new Date() }
                }
            });

            const response = await request(app)
                .get('/api/integrations/instagram/status/r1');

            expect(response.status).toBe(200);
            expect(response.body.data.connected).toBe(false);
        });

        it('should show tokenStatus=expired when token is past expiry', async () => {
            // Covers lines 623, 646-647 equivalent - token status expiry branches
            const col = realConnection.getRestaurantsCollection();
            await col.updateOne({ _id: 'r1' } as any, {
                $set: {
                    integrations: { instagram: true },
                    instagramCredentials: {
                        username: 'expired_ig',
                        tokenExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // expired yesterday
                    }
                }
            });

            const response = await request(app)
                .get('/api/integrations/instagram/status/r1');

            expect(response.status).toBe(200);
            expect(response.body.data.connected).toBe(true);
            expect(response.body.data.tokenStatus).toBe('expired');
            expect(response.body.data.needsReauthorization).toBe(true);
        });

        it('should show tokenStatus=expiring_soon when token expires within 7 days', async () => {
            const col = realConnection.getRestaurantsCollection();
            await col.updateOne({ _id: 'r1' } as any, {
                $set: {
                    integrations: { instagram: true },
                    instagramCredentials: {
                        username: 'expiring_ig',
                        tokenExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days from now
                    }
                }
            });

            const response = await request(app)
                .get('/api/integrations/instagram/status/r1');

            expect(response.status).toBe(200);
            expect(response.body.data.tokenStatus).toBe('expiring_soon');
        });

        it('should handle database error', async () => {
            mockGetRestaurantsCollection.mockReturnValue({
                findOne: vi.fn().mockRejectedValue(new Error('DB Fail'))
            });

            const response = await request(app)
                .get('/api/integrations/instagram/status/r1');

            expect(response.status).toBe(500);
        });

        it('should handle restaurant not found', async () => {
            // We can let the real DB handle not found, or mock it.
            // Real DB returns null for invalid ID
            const response = await request(app).get('/api/integrations/instagram/status/bad-id');
            expect(response.status).toBe(404);
        });
    });

    describe('DELETE /api/integrations/instagram/disconnect/:restaurantId', () => {
        it('should disconnect integration', async () => {
            const col = realConnection.getRestaurantsCollection();
            await col.updateOne({ _id: 'r1' } as any, {
                $set: { integrations: { instagram: true }, instagramCredentials: { token: 'abc' } }
            });

            const response = await request(app)
                .delete('/api/integrations/instagram/disconnect/r1');

            expect(response.status).toBe(200);

            const r = await col.findOne({ _id: 'r1' } as any);
            expect(r?.instagramCredentials).toBeUndefined();
        });

        it('should return 404 when restaurant not found for disconnect (covers line 444)', async () => {
            // Use a non-existent restaurant ID so matchedCount will be 0
            const response = await request(app)
                .delete('/api/integrations/instagram/disconnect/non-existent-restaurant');

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Restaurant not found');
        });

        it('should handle database error', async () => {
            mockGetRestaurantsCollection.mockReturnValue({
                updateOne: vi.fn().mockRejectedValue(new Error('DB Fail'))
            });

            const response = await request(app)
                .delete('/api/integrations/instagram/disconnect/r1');

            expect(response.status).toBe(500);
        });
    });

    describe('POST /api/integrations/instagram/select-account', () => {
        it('should fail when selectionId or accountId missing', async () => {
            const response = await request(app)
                .post('/api/integrations/instagram/select-account')
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Selection ID and account ID required');
        });

        it('should successfully select account flow', async () => {
            // 1. Setup Mock
            mockHandleOAuthCallback.mockReturnValue({
                success: true,
                accessToken: 'test-token',
                tokenExpiresAt: new Date(),
                accounts: [
                    { id: 'acc1', username: 'user1', name: 'User One' },
                    { id: 'acc2', username: 'user2', name: 'User Two' }
                ],
                restaurantId: 'r1'
            });
            mockValidateStateToken.mockReturnValue({ valid: true, restaurantId: 'r1' });

            // 2. Start Session
            const seedResponse = await request(app)
                .post('/api/integrations/instagram/callback')
                .send({ code: 'valid', state: 'valid' });

            const selectionId = seedResponse.body.data.selectionId;

            // 3. Select
            const response = await request(app)
                .post('/api/integrations/instagram/select-account')
                .send({ selectionId, accountId: 'acc1' });

            expect(response.status).toBe(200);
            expect(response.body.data.username).toBe('user1');
        });

        it('should fail with invalid selectionId', async () => {
            const response = await request(app)
                .post('/api/integrations/instagram/select-account')
                .send({ selectionId: 'invalid', accountId: 'acc1' });

            expect(response.status).toBe(404);
        });

        it('should fail when selected account is not in pending list', async () => {
            mockHandleOAuthCallback.mockReturnValue({
                success: true,
                accessToken: 'test-token',
                tokenExpiresAt: new Date(),
                accounts: [
                    { id: 'acc1', username: 'user1', name: 'User One' },
                    { id: 'acc2', username: 'user2', name: 'User Two' }
                ],
                restaurantId: 'r1'
            });
            mockValidateStateToken.mockReturnValue({ valid: true, restaurantId: 'r1' });

            const seedResponse = await request(app)
                .post('/api/integrations/instagram/callback')
                .send({ code: 'valid', state: 'valid' });

            const selectionId = seedResponse.body.data.selectionId;

            const response = await request(app)
                .post('/api/integrations/instagram/select-account')
                .send({ selectionId, accountId: 'acc-missing' });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Invalid account selection');
        });

        it('should fail when restaurant id is missing in pending and request', async () => {
            mockHandleOAuthCallback.mockReturnValue({
                success: true,
                accessToken: 'test-token',
                tokenExpiresAt: new Date(),
                accounts: [
                    { id: 'acc1', username: 'user1', name: 'User One' },
                    { id: 'acc2', username: 'user2', name: 'User Two' }
                ],
                restaurantId: ''
            });
            mockValidateStateToken.mockReturnValue({ valid: true, restaurantId: '' });

            const seedResponse = await request(app)
                .post('/api/integrations/instagram/callback')
                .send({ code: 'valid', state: 'valid' });

            const selectionId = seedResponse.body.data.selectionId;

            const response = await request(app)
                .post('/api/integrations/instagram/select-account')
                .send({ selectionId, accountId: 'acc1' });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Restaurant ID required');
        });

        it('should handle database error during save', async () => {
            // 1. Start Session (Real DB)
            mockHandleOAuthCallback.mockReturnValue({
                success: true,
                accounts: [
                    { id: 'a1', username: 'u1' },
                    { id: 'a2', username: 'u2' }
                ],
                accessToken: 't',
                restaurantId: 'r1'
            });
            mockValidateStateToken.mockReturnValue({ valid: true, restaurantId: 'r1' });

            const seed = await request(app).post('/api/integrations/instagram/callback').send({ code: 'c', state: 's' });
            const id = seed.body.data.selectionId;

            // 2. Switch to Mock DB for error
            mockGetRestaurantsCollection.mockReturnValue({
                updateOne: vi.fn().mockRejectedValue(new Error('Save failed'))
            });

            const response = await request(app)
                .post('/api/integrations/instagram/select-account')
                .send({ selectionId: id, accountId: 'a1' });

            expect(response.status).toBe(500);
        });
    });

    describe('GET /api/integrations/instagram/pending-accounts/:selectionId', () => {
        it('should return 404 for unknown selection', async () => {
            const response = await request(app)
                .get('/api/integrations/instagram/pending-accounts/unknown-selection');

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });

        it('should return pending accounts for valid selection', async () => {
            mockHandleOAuthCallback.mockReturnValue({
                success: true,
                accessToken: 'test-token',
                tokenExpiresAt: new Date(),
                accounts: [
                    { id: 'acc1', username: 'user1', name: 'User One' },
                    { id: 'acc2', username: 'user2', name: 'User Two' }
                ],
                restaurantId: 'r1'
            });
            mockValidateStateToken.mockReturnValue({ valid: true, restaurantId: 'r1' });

            const seedResponse = await request(app)
                .post('/api/integrations/instagram/callback')
                .send({ code: 'valid', state: 'valid' });

            const selectionId = seedResponse.body.data.selectionId;

            const response = await request(app)
                .get(`/api/integrations/instagram/pending-accounts/${selectionId}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.accounts).toHaveLength(2);
        });
    });

    describe('POST /api/integrations/instagram/refresh/:restaurantId', () => {
        it('should refresh token successfully', async () => {
            mockCheckAndRefreshTokenIfNeeded.mockResolvedValue(true);

            const response = await request(app)
                .post('/api/integrations/instagram/refresh/r1');

            expect(response.status).toBe(200);
        });

        it('should handle refresh failure', async () => {
            mockCheckAndRefreshTokenIfNeeded.mockResolvedValue(false);

            const response = await request(app)
                .post('/api/integrations/instagram/refresh/r1');

            expect(response.status).toBe(400);
        });

        it('should handle exception', async () => {
            mockCheckAndRefreshTokenIfNeeded.mockRejectedValue(new Error('Fail'));
            const response = await request(app).post('/api/integrations/instagram/refresh/r1');
            expect(response.status).toBe(500);
        });
    });

    describe('POST /api/integrations/instagram/validate/:restaurantId', () => {
        it('should validate valid token', async () => {
            mockValidateToken.mockResolvedValue(true);
            const response = await request(app).post('/api/integrations/instagram/validate/r1');
            expect(response.status).toBe(200);
            expect(response.body.data.valid).toBe(true);
        });

        it('should return 500 when validateToken throws an exception', async () => {
            // Covers lines 600-601: catch block in validate route
            mockValidateToken.mockRejectedValue(new Error('Meta API down'));

            const response = await request(app).post('/api/integrations/instagram/validate/r1');

            expect(response.status).toBe(500);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to validate connection');
        });

        it('should handle invalid token (updates DB)', async () => {
            mockValidateToken.mockResolvedValue(false);
            const response = await request(app).post('/api/integrations/instagram/validate/r1');
            expect(response.status).toBe(200);
            expect(response.body.data.valid).toBe(false);

            // Verify DB update (disconnected) - switch to viewing real DB
            const col = realConnection.getRestaurantsCollection();
            const r = await col.findOne({ _id: 'r1' } as any);
            expect(r?.integrations?.instagram).toBe(false);
        });

        it('should error if no credentials', async () => {
            const col = realConnection.getRestaurantsCollection();
            await col.updateOne({ _id: 'r1' } as any, { $unset: { instagramCredentials: '' } });

            const response = await request(app).post('/api/integrations/instagram/validate/r1');
            expect(response.status).toBe(400);
        });
    });

    describe('GET /api/integrations/instagram/profile/:restaurantId', () => {
        it('should get profile', async () => {
            mockGetInstagramProfile.mockResolvedValue({ username: 'my_profile', name: 'My Profile' });
            mockCheckAndRefreshTokenIfNeeded.mockResolvedValue(true);

            const response = await request(app).get('/api/integrations/instagram/profile/r1');

            expect(response.status).toBe(200);
            expect(response.body.data.username).toBe('my_profile');
        });

        it('should error if profile fetch fails', async () => {
            mockGetInstagramProfile.mockResolvedValue(null);
            mockCheckAndRefreshTokenIfNeeded.mockResolvedValue(true); // Token ok, but profile fetch failed

            const response = await request(app).get('/api/integrations/instagram/profile/r1');

            expect(response.status).toBe(400);
        });

        it('should return 400 when no Instagram credentials (covers line 623)', async () => {
            // Remove instagramCredentials from the restaurant
            mockCheckAndRefreshTokenIfNeeded.mockResolvedValue(true);
            const col = realConnection.getRestaurantsCollection();
            await col.updateOne({ _id: 'r1' } as any, { $unset: { instagramCredentials: '' } });

            const response = await request(app).get('/api/integrations/instagram/profile/r1');

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('No Instagram connection found');
        });

        it('should return 500 when profile fetch throws an exception (covers lines 646-647)', async () => {
            // checkAndRefreshTokenIfNeeded throws to trigger the catch block
            mockCheckAndRefreshTokenIfNeeded.mockRejectedValue(new Error('Token refresh network error'));

            const response = await request(app).get('/api/integrations/instagram/profile/r1');

            expect(response.status).toBe(500);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to fetch profile');
        });
    });

    describe('GET /api/integrations/config', () => {
        it('should return config status', async () => {
            mockIsInstagramConfigured.mockReturnValue(true);
            const response = await request(app).get('/api/integrations/config');

            expect(response.status).toBe(200);
            expect(response.body.data.instagram.configured).toBe(true);
        });

        it('should return appId as not_configured when env var is missing', async () => {
            const previousAppId = process.env.INSTAGRAM_APP_ID;
            delete process.env.INSTAGRAM_APP_ID;
            mockIsInstagramConfigured.mockReturnValue(false);

            const response = await request(app).get('/api/integrations/config');

            expect(response.status).toBe(200);
            expect(response.body.data.instagram.configured).toBe(false);
            expect(response.body.data.instagram.appId).toBe('not_configured');

            if (previousAppId) {
                process.env.INSTAGRAM_APP_ID = previousAppId;
            }
        });

        it('should return appId as configured when env var exists', async () => {
            const previousAppId = process.env.INSTAGRAM_APP_ID;
            process.env.INSTAGRAM_APP_ID = 'test-app-id';
            mockIsInstagramConfigured.mockReturnValue(true);

            const response = await request(app).get('/api/integrations/config');

            expect(response.status).toBe(200);
            expect(response.body.data.instagram.configured).toBe(true);
            expect(response.body.data.instagram.appId).toBe('configured');

            if (previousAppId) {
                process.env.INSTAGRAM_APP_ID = previousAppId;
            } else {
                delete process.env.INSTAGRAM_APP_ID;
            }
        });
    });

    describe('Development-only debug routes', () => {
        it('should return 404 for debug-token route in production', async () => {
            const previousEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            const response = await request(app)
                .get('/api/integrations/instagram/debug-token/r1');

            expect(response.status).toBe(404);

            process.env.NODE_ENV = previousEnv;
        });

        it('should return 400 when debug-token has no credentials', async () => {
            const previousEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            const col = realConnection.getRestaurantsCollection();
            await col.updateOne({ _id: 'r1' } as any, { $unset: { instagramCredentials: '' } });

            const response = await request(app)
                .get('/api/integrations/instagram/debug-token/r1');

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('No credentials found');

            process.env.NODE_ENV = previousEnv;
        });

        it('should return 500 when token decryption fails in debug-token', async () => {
            const previousEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            const col = realConnection.getRestaurantsCollection();
            await col.updateOne(
                { _id: 'r1' } as any,
                { $set: { instagramCredentials: { accessToken: 'invalid-token-format' } } }
            );

            const response = await request(app)
                .get('/api/integrations/instagram/debug-token/r1');

            expect(response.status).toBe(500);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to decrypt token');

            process.env.NODE_ENV = previousEnv;
        });

        it('should return debug details for valid debug-token request', async () => {
            const previousEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            const col = realConnection.getRestaurantsCollection();
            await col.updateOne(
                { _id: 'r1' } as any,
                {
                    $set: {
                        instagramCredentials: {
                            userId: 'ig-user-1',
                            pageId: 'pg-1',
                            username: 'debug_user',
                            accessToken: encrypt('plain-token-123')
                        }
                    }
                }
            );

            mockAxiosGet.mockImplementation((url: string) => {
                if (url.includes('/debug_token')) {
                    return Promise.resolve({
                        data: {
                            data: {
                                app_id: 'app-1',
                                user_id: 'ig-user-1',
                                type: 'PAGE',
                                is_valid: true,
                                expires_at: 0,
                                scopes: ['pages_show_list']
                            }
                        }
                    });
                }

                return Promise.resolve({
                    data: { id: 'ig-user-1', name: 'IG User' }
                });
            });

            const response = await request(app)
                .get('/api/integrations/instagram/debug-token/r1');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.tokenDebug.isValid).toBe(true);
            expect(response.body.data.me.id).toBe('ig-user-1');

            process.env.NODE_ENV = previousEnv;
        });

        it('should return 404 for migrate route in production', async () => {
            const previousEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            const response = await request(app)
                .post('/api/integrations/instagram/migrate-to-page-token/r1');

            expect(response.status).toBe(404);

            process.env.NODE_ENV = previousEnv;
        });

        it('should return 400 when migrate route has no credentials', async () => {
            const previousEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            const col = realConnection.getRestaurantsCollection();
            await col.updateOne({ _id: 'r1' } as any, { $unset: { instagramCredentials: '' } });

            const response = await request(app)
                .post('/api/integrations/instagram/migrate-to-page-token/r1');

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('No credentials found');

            process.env.NODE_ENV = previousEnv;
        });

        it('should return 500 when decrypt fails in migrate route (covers decrypt null path)', async () => {
            const previousEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            const col = realConnection.getRestaurantsCollection();
            await col.updateOne(
                { _id: 'r1' } as any,
                {
                    $set: {
                        instagramCredentials: {
                            userId: 'ig-user-1',
                            pageId: 'page-bad',
                            accessToken: 'invalid-no-colon' // decrypt returns null for this format
                        }
                    }
                }
            );

            const response = await request(app)
                .post('/api/integrations/instagram/migrate-to-page-token/r1');

            expect(response.status).toBe(500);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Failed to decrypt stored token');

            process.env.NODE_ENV = previousEnv;
        });

        it('should return 400 when page not found in accounts and direct fetch also fails (covers lines 973-994)', async () => {
            const previousEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            const col = realConnection.getRestaurantsCollection();
            await col.updateOne(
                { _id: 'r1' } as any,
                {
                    $set: {
                        instagramCredentials: {
                            userId: 'ig-user-1',
                            pageId: 'page-not-found',
                            accessToken: encrypt('user-token-abc')
                        }
                    }
                }
            );

            // /me/accounts returns pages but not the stored pageId
            // Direct fetch also fails (throws)
            mockAxiosGet.mockImplementation((url: string) => {
                if (url.includes('/me/accounts')) {
                    return Promise.resolve({
                        data: { data: [{ id: 'other-page', name: 'Other', access_token: 'tok' }] }
                    });
                }
                // Direct fetch of storedPageId throws
                return Promise.reject(new Error('Page not accessible'));
            });

            const response = await request(app)
                .post('/api/integrations/instagram/migrate-to-page-token/r1');

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Could not get page access token');

            process.env.NODE_ENV = previousEnv;
        });

        it('should return 400 when page debug_token is invalid (covers line 1017)', async () => {
            const previousEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            process.env.INSTAGRAM_APP_ID = 'test-app-id';
            process.env.INSTAGRAM_APP_SECRET = 'test-app-secret';

            const col = realConnection.getRestaurantsCollection();
            await col.updateOne(
                { _id: 'r1' } as any,
                {
                    $set: {
                        instagramCredentials: {
                            userId: 'ig-user-1',
                            pageId: 'page-invalid-tok',
                            accessToken: encrypt('user-token-abc')
                        }
                    }
                }
            );

            mockAxiosGet.mockImplementation((url: string) => {
                if (url.includes('/me/accounts')) {
                    return Promise.resolve({
                        data: {
                            data: [{ id: 'page-invalid-tok', name: 'Test Page', access_token: 'bad-page-token' }]
                        }
                    });
                }
                if (url.includes('/debug_token')) {
                    return Promise.resolve({
                        data: { data: { is_valid: false, type: 'PAGE', scopes: [] } }
                    });
                }
                return Promise.resolve({ data: {} });
            });

            const response = await request(app)
                .post('/api/integrations/instagram/migrate-to-page-token/r1');

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Page token is not valid');

            process.env.NODE_ENV = previousEnv;
        });

        it('should return 500 when migrate throws an unexpected exception (covers lines 1045-1046)', async () => {
            const previousEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            const col = realConnection.getRestaurantsCollection();
            await col.updateOne(
                { _id: 'r1' } as any,
                {
                    $set: {
                        instagramCredentials: {
                            userId: 'ig-user-1',
                            pageId: 'page-crash',
                            accessToken: encrypt('user-token-crash')
                        }
                    }
                }
            );

            // Make the axios call throw an unexpected error
            mockAxiosGet.mockRejectedValue(new Error('Network timeout'));

            const response = await request(app)
                .post('/api/integrations/instagram/migrate-to-page-token/r1');

            expect(response.status).toBe(500);
            expect(response.body.success).toBe(false);

            process.env.NODE_ENV = previousEnv;
        });

        it('should migrate to page token successfully', async () => {
            const previousEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            process.env.INSTAGRAM_APP_ID = 'test-app-id';
            process.env.INSTAGRAM_APP_SECRET = 'test-app-secret';

            const col = realConnection.getRestaurantsCollection();
            await col.updateOne(
                { _id: 'r1' } as any,
                {
                    $set: {
                        instagramCredentials: {
                            userId: 'ig-user-1',
                            pageId: 'page-123',
                            accessToken: encrypt('user-token-abc')
                        }
                    }
                }
            );

            mockAxiosGet.mockImplementation((url: string) => {
                if (url.includes('/me/accounts')) {
                    return Promise.resolve({
                        data: {
                            data: [
                                { id: 'page-123', name: 'Test Page', access_token: 'page-token-xyz' }
                            ]
                        }
                    });
                }

                if (url.includes('/debug_token')) {
                    return Promise.resolve({
                        data: {
                            data: {
                                is_valid: true,
                                type: 'PAGE',
                                scopes: ['pages_show_list'],
                                expires_at: 0
                            }
                        }
                    });
                }

                return Promise.resolve({ data: {} });
            });

            const response = await request(app)
                .post('/api/integrations/instagram/migrate-to-page-token/r1');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.message).toContain('Migrated from User token to Page token');

            process.env.NODE_ENV = previousEnv;
        });
    });

    describe('POST /api/integrations/instagram/deauthorize', () => {
        // Helper to create valid signed_request for testing
        // Must use the same secret as set in tests/setup.ts
        const createSignedRequest = (userId: string): string => {
            const appSecret = 'test-app-secret';
            const payload = Buffer.from(JSON.stringify({ user_id: userId })).toString('base64');
            const sig = crypto
                .createHmac('sha256', appSecret)
                .update(payload)
                .digest('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            return `${sig}.${payload}`;
        };

        it('should fail without signed_request', async () => {
            const response = await request(app)
                .post('/api/integrations/instagram/deauthorize')
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Missing signed_request');
        });

        it('should fail with invalid signed_request', async () => {
            const response = await request(app)
                .post('/api/integrations/instagram/deauthorize')
                .send({ signed_request: 'invalid.payload' });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Invalid signed_request');
        });

        it('should fail with malformed signed_request (no dot)', async () => {
            const response = await request(app)
                .post('/api/integrations/instagram/deauthorize')
                .send({ signed_request: 'nodotseparator' });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Invalid signed_request');
        });

        it('should fail with signed_request that has valid format but wrong signature (covers lines 57-58)', async () => {
            // Create a payload with a wrong (mismatched) signature - valid base64 payload but wrong sig
            const payload = Buffer.from(JSON.stringify({ user_id: 'some-user' })).toString('base64');
            const wrongSig = 'wrongsignaturehere';
            const signedRequest = `${wrongSig}.${payload}`;

            const response = await request(app)
                .post('/api/integrations/instagram/deauthorize')
                .send({ signed_request: signedRequest });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Invalid signed_request');
        });

        it('should successfully deauthorize with valid signed_request', async () => {
            const mockUpdateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
            mockGetRestaurantsCollection.mockReturnValue({ updateMany: mockUpdateMany });

            const signedRequest = createSignedRequest('test-user-123');

            const response = await request(app)
                .post('/api/integrations/instagram/deauthorize')
                .send({ signed_request: signedRequest });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(mockUpdateMany).toHaveBeenCalledWith(
                { 'instagramCredentials.userId': 'test-user-123' },
                expect.objectContaining({
                    $set: expect.objectContaining({
                        'integrations.instagram': false,
                        'instagramCredentials.accessToken': null
                    })
                })
            );
        });

        it('should return 200 even when database error occurs', async () => {
            mockGetRestaurantsCollection.mockReturnValue({
                updateMany: vi.fn().mockRejectedValue(new Error('DB Error'))
            });

            const signedRequest = createSignedRequest('test-user-456');

            const response = await request(app)
                .post('/api/integrations/instagram/deauthorize')
                .send({ signed_request: signedRequest });

            // Should still return 200 to acknowledge receipt
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });
    });

    describe('POST /api/integrations/instagram/data-deletion', () => {
        // Helper to create valid signed_request for testing
        // Must use the same secret as set in tests/setup.ts
        const createSignedRequest = (userId: string): string => {
            const appSecret = 'test-app-secret';
            const payload = Buffer.from(JSON.stringify({ user_id: userId })).toString('base64');
            const sig = crypto
                .createHmac('sha256', appSecret)
                .update(payload)
                .digest('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            return `${sig}.${payload}`;
        };

        it('should fail without signed_request', async () => {
            const response = await request(app)
                .post('/api/integrations/instagram/data-deletion')
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Missing signed_request');
        });

        it('should fail with invalid signed_request', async () => {
            const response = await request(app)
                .post('/api/integrations/instagram/data-deletion')
                .send({ signed_request: 'bad.data' });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Invalid signed_request');
        });

        it('should successfully process data deletion with valid signed_request', async () => {
            const mockUpdateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
            mockGetRestaurantsCollection.mockReturnValue({ updateMany: mockUpdateMany });

            const signedRequest = createSignedRequest('test-user-789');

            const response = await request(app)
                .post('/api/integrations/instagram/data-deletion')
                .send({ signed_request: signedRequest });

            expect(response.status).toBe(200);
            expect(response.body.confirmation_code).toBeDefined();
            expect(response.body.url).toContain('/api/integrations/instagram/data-deletion-status');
            expect(response.body.url).toContain(response.body.confirmation_code);
            expect(mockUpdateMany).toHaveBeenCalledWith(
                { 'instagramCredentials.userId': 'test-user-789' },
                expect.objectContaining({
                    $unset: { instagramCredentials: '' },
                    $set: expect.objectContaining({ 'integrations.instagram': false })
                })
            );
        });

        it('should return 500 when database error occurs', async () => {
            mockGetRestaurantsCollection.mockReturnValue({
                updateMany: vi.fn().mockRejectedValue(new Error('DB Error'))
            });

            const signedRequest = createSignedRequest('test-user-error');

            const response = await request(app)
                .post('/api/integrations/instagram/data-deletion')
                .send({ signed_request: signedRequest });

            expect(response.status).toBe(500);
            expect(response.body.error).toBe('Failed to process deletion request');
        });
    });

    describe('GET /api/integrations/instagram/data-deletion-status', () => {
        it('should fail without code', async () => {
            const response = await request(app)
                .get('/api/integrations/instagram/data-deletion-status');

            expect(response.status).toBe(400);
            expect(response.text).toContain('Missing confirmation code');
        });

        it('should return 404 for unknown code', async () => {
            const response = await request(app)
                .get('/api/integrations/instagram/data-deletion-status')
                .query({ code: 'unknown-code' });

            expect(response.status).toBe(404);
            expect(response.text).toContain('Request Not Found');
        });

        it('should return status for valid confirmation code', async () => {
            // First create a data deletion request
            // Helper to create valid signed_request - must use same secret as tests/setup.ts
            const createSignedRequest = (userId: string): string => {
                const appSecret = 'test-app-secret';
                const payload = Buffer.from(JSON.stringify({ user_id: userId })).toString('base64');
                const sig = crypto
                    .createHmac('sha256', appSecret)
                    .update(payload)
                    .digest('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/, '');
                return `${sig}.${payload}`;
            };

            mockGetRestaurantsCollection.mockReturnValue({
                updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 })
            });

            const signedRequest = createSignedRequest('status-test-user');
            const createResponse = await request(app)
                .post('/api/integrations/instagram/data-deletion')
                .send({ signed_request: signedRequest });

            const confirmationCode = createResponse.body.confirmation_code;

            // Now check the status
            const statusResponse = await request(app)
                .get('/api/integrations/instagram/data-deletion-status')
                .query({ code: confirmationCode });

            expect(statusResponse.status).toBe(200);
            expect(statusResponse.text).toContain('Data Deletion Status');
            expect(statusResponse.text).toContain(confirmationCode);
            expect(statusResponse.text).toContain('Completed');
        });
    });
});
