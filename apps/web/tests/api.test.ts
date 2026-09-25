import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authAPI, restaurantAPI, postsAPI, strategyAPI, instagramAPI, subscriptionAPI, couponAPI, creditPacksAPI, invoiceAPI, citiesAPI, accountManagerAPI, configAPI } from '../api';

// api.ts reads the API base URL through utils/env's getApiUrl(), which now
// reads from the runtime client config sidecar. Mock it so fetchAPI() has a
// resolved base URL without requiring initClientConfig() to have run.
vi.mock('../utils/client-config', () => ({
    getClientConfig: vi.fn(() => ({ apiUrl: 'http://localhost:3001/api' })),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock LocalStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
            store[key] = value.toString();
        }),
        removeItem: vi.fn((key: string) => {
            delete store[key];
        }),
        clear: vi.fn(() => {
            store = {};
        }),
    };
})();

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
});

describe('API Service', () => {
    beforeEach(() => {
        mockFetch.mockClear();
        localStorageMock.clear();
        vi.restoreAllMocks();
    });

    describe('authAPI', () => {
        it('should login successfully', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, token: 'test-token', refreshToken: 'refresh-token', data: { user: { id: 'u1', name: 'Test User' } } }),
            });

            const result = await authAPI.login({ email: 'test@test.com', password: 'password' });

            expect(result.success).toBe(true);
            expect(result.token).toBe('test-token');
            expect(localStorage.getItem('rp_token')).toBe('test-token');
        });

        it('should handle login failure', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                json: async () => ({ message: 'Invalid credentials' }),
            });

            await expect(authAPI.login({ email: 'wrong@test.com', password: 'wrong' }))
                .rejects.toThrow();
        });

        it('should logout successfully', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await authAPI.logout();
            expect(localStorage.removeItem).toHaveBeenCalledWith('rp_token');
        });

        it('should check session with valid token', async () => {
            localStorage.setItem('rp_token', 'test-token');

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, user: { id: 'u1', name: 'Test' } }),
            });

            const result = await authAPI.checkSession();

            expect(result.success).toBe(true);
            expect(result.user).toBeDefined();
        });

        it('should verify OTP successfully', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, token: 'otp-token', refreshToken: 'otp-refresh', data: { user: { id: 'u1' } } }),
            });

            const result = await authAPI.verifyOtp('1234567890', '123456');

            expect(result.success).toBe(true);
            expect(localStorage.getItem('rp_token')).toBe('otp-token');
            expect(localStorage.getItem('rp_refresh_token')).toBe('otp-refresh');
        });

        it('should login with Firebase token', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, token: 'firebase-token', refreshToken: 'fb-refresh', data: { user: { id: 'u1' } } }),
            });

            const result = await authAPI.loginWithFirebase('fake-firebase-id-token');

            expect(result.success).toBe(true);
            expect(localStorage.getItem('rp_token')).toBe('firebase-token');
        });

        it('should fail refresh token', async () => {
            // refresh failure due to network status
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400
            });

            const result = await authAPI.refreshToken('bad-token');
            expect(result).toBe(false);
        });

        it('should fail refresh token on exception', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network'));

            const result = await authAPI.refreshToken('tok');
            expect(result).toBe(false);
        });

        it('should succeed refresh token', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, token: 'new-token' })
            });

            const result = await authAPI.refreshToken('good-token');
            expect(result).toBe(true);
            expect(localStorage.getItem('rp_token')).toBe('new-token');
        });
    });

    describe('instagramAPI', () => {
        it('should get OAuth URL', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { oauthUrl: 'https://insta.com/auth', state: 'xyz' } }),
            });

            const result = await instagramAPI.getOAuthUrl('r1');
            expect(result.oauthUrl).toBe('https://insta.com/auth');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/integrations/instagram/oauth-url?restaurantId=r1'), expect.anything());
        });

        it('should handle callback', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: {
                        account: { id: 'ig1', username: 'iguser' },
                        requiresSelection: false
                    }
                }),
            });

            const result = await instagramAPI.handleCallback('code123', 'state456');
            expect(result.success).toBe(true);
            expect(result.account?.username).toBe('iguser');
            expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/integrations/instagram/callback'), expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ code: 'code123', state: 'state456' })
            }));
        });

        it('should get pending accounts', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { accounts: [{ id: 'a1' }] } }),
            });

            const result = await instagramAPI.getPendingAccounts('sel1');
            expect(result).toHaveLength(1);
        });

        it('should select account', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { username: 'user1', message: 'Connected' } }),
            });

            const result = await instagramAPI.selectAccount('sel1', 'a1', 'r1');
            expect(result.username).toBe('user1');
        });

        it('should get status', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { connected: true, username: 'user1' } }),
            });

            const result = await instagramAPI.getStatus('r1');
            expect(result.connected).toBe(true);
        });

        it('should disconnect', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await expect(instagramAPI.disconnect('r1')).resolves.not.toThrow();
        });

        it('should return true on refresh token success', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            const refreshed = await instagramAPI.refreshToken('r1');
            expect(refreshed).toBe(true);
        });

        it('should return false on refresh token failure', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: async () => ({ message: 'Failed refresh' }),
            });

            const refreshed = await instagramAPI.refreshToken('r1');
            expect(refreshed).toBe(false);
        });

        it('should validate connection', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { valid: true, needsReauthorization: false },
                }),
            });

            const result = await instagramAPI.validate('r1');
            expect(result.valid).toBe(true);
            expect(result.needsReauthorization).toBe(false);
        });

        it('should get profile', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { username: 'restro_ig' } }),
            });

            const result = await instagramAPI.getProfile('r1');
            expect(result.username).toBe('restro_ig');
        });

        it('should get config', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { instagram: { configured: true } } }),
            });

            const config = await instagramAPI.getConfig();
            expect(config.instagram.configured).toBe(true);
        });
    });

    describe('restaurantAPI', () => {
        it('should get restaurant by ID', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { id: 'r1', name: 'Test Restaurant' } }),
            });

            const result = await restaurantAPI.get('r1');

            expect(result.id).toBe('r1');
            expect(result.name).toBe('Test Restaurant');
        });

        it('should update restaurant', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { id: 'r1', name: 'Updated Restaurant' } }),
            });

            const result = await restaurantAPI.update('r1', { name: 'Updated Restaurant' });

            expect(result.name).toBe('Updated Restaurant');
        });

        it('should update offers', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { activeOffers: ['New Offer'] } }),
            });

            const result = await restaurantAPI.updateOffers('r1', 'ADD', 'New Offer');

            expect(result.activeOffers).toContain('New Offer');
        });

        it('should handle API errors', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                json: async () => ({ message: 'Restaurant not found' }),
            });

            await expect(restaurantAPI.get('invalid'))
                .rejects.toThrow();
        });
    });

    describe('postsAPI', () => {
        it('should get all posts', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: [{ id: 'p1' }, { id: 'p2' }] }),
            });

            const result = await postsAPI.getAll();

            expect(result).toHaveLength(2);
        });

        it('should create a new post', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: [{ id: 'p3', caption: 'New post' }] }),
            });

            const result = await postsAPI.create({
                caption: 'New post',
                type: 'IMAGE',
                status: 'PENDING_APPROVAL',
                thumbnail: '/mock.jpg',
                platforms: ['INSTAGRAM']
            });

            expect(result[0].caption).toBe('New post');
        });

        it('should get post by id', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { id: 'p1', caption: 'One post' } }),
            });

            const result = await postsAPI.getById('p1');
            expect(result.id).toBe('p1');
        });

        it('should generate a new post', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: [{ id: 'pgen1', caption: 'Promo post', type: 'IMAGE', platform: 'INSTAGRAM' }],
                }),
            });

            const result = await postsAPI.generate({
                concept: 'Promo post',
                type: 'IMAGE',
                platforms: ['INSTAGRAM'],
            });

            expect(result[0].id).toBe('pgen1');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/posts/generate'),
                expect.objectContaining({ method: 'POST' })
            );
        });

        it('should update a post', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { id: 'p1', caption: 'Updated' } }),
            });

            const result = await postsAPI.update('p1', { caption: 'Updated' });

            expect(result.caption).toBe('Updated');
        });

        it('should delete a post', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await expect(postsAPI.delete('p1')).resolves.not.toThrow();
        });
    });

    describe('strategyAPI', () => {
        it('should get content strategy', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { postsPerWeek: 4 } }),
            });

            const result = await strategyAPI.getStrategy();

            expect(result.postsPerWeek).toBe(4);
        });

        it('should get all cycles', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: [{ id: 'c1' }, { id: 'c2' }] }),
            });

            const result = await strategyAPI.getAllCycles();

            expect(result).toHaveLength(2);
        });

        it('should create a cycle', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { id: 'c3', period: 'New cycle' } }),
            });

            const result = await strategyAPI.createCycle({ period: 'New cycle' } as any);

            expect(result.period).toBe('New cycle');
        });
    });

    describe('Error Handling', () => {
        it('should refresh token and retry original request on 401', async () => {
            localStorage.setItem('rp_token', 'expired-token');
            localStorage.setItem('rp_refresh_token', 'refresh-token-1');

            // 1) Original request unauthorized
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                json: async () => ({ message: 'Unauthorized' }),
            });

            // 2) Refresh endpoint success
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, token: 'new-token-after-refresh' }),
            });

            // 3) Retried original request success
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { id: 'r1', name: 'Retried Restaurant' } }),
            });

            const result = await restaurantAPI.get('r1');

            expect(result.name).toBe('Retried Restaurant');
            expect(localStorage.getItem('rp_token')).toBe('new-token-after-refresh');
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        it('should clear tokens when refresh fails after 401', async () => {
            localStorage.setItem('rp_token', 'expired-token');
            localStorage.setItem('rp_refresh_token', 'bad-refresh-token');
            localStorage.setItem('rp_session', 'session-data');

            // 1) Original request unauthorized
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                json: async () => ({ message: 'Unauthorized' }),
            });

            // 2) Refresh endpoint fails
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                json: async () => ({ message: 'Refresh failed' }),
            });

            await expect(restaurantAPI.get('r1')).rejects.toThrow('Unauthorized');

            expect(localStorage.getItem('rp_token')).toBeNull();
            expect(localStorage.getItem('rp_refresh_token')).toBeNull();
            expect(localStorage.getItem('rp_session')).toBeNull();
        });

        it('should clear tokens on 401 when no refresh token exists', async () => {
            localStorage.setItem('rp_token', 'expired-token');
            localStorage.setItem('rp_session', 'session-data');

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                json: async () => ({ message: 'Unauthorized' }),
            });

            await expect(restaurantAPI.get('r1')).rejects.toThrow('Unauthorized');

            expect(localStorage.getItem('rp_token')).toBeNull();
            expect(localStorage.getItem('rp_session')).toBeNull();
        });

        it('should handle network errors', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            await expect(authAPI.login({ email: 'test@test.com', password: 'pass' }))
                .rejects.toThrow();
        });

        it('should handle malformed JSON', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => { throw new Error('Invalid JSON'); },
            });

            await expect(restaurantAPI.get('r1'))
                .rejects.toThrow();
        });

        it('should handle HTTP error responses', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                json: async () => ({ message: 'Not found' }),
            });

            await expect(postsAPI.getById('invalid'))
                .rejects.toThrow('Not found');
        });

        it('should handle network error with no JSON response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: async () => { throw new Error('Invalid JSON'); },
            });

            await expect(restaurantAPI.get('r1'))
                .rejects.toThrow();
        });
    });

    describe('subscriptionAPI', () => {
        it('should get plans', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: [{ id: 'plan1', name: 'Starter' }] }),
            });

            const result = await subscriptionAPI.getPlans();
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Starter');
        });

        it('should get current subscription', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: {
                        subscription: { id: 'sub1', status: 'ACTIVE' },
                        usage: {},
                    },
                }),
            });

            const result = await subscriptionAPI.getCurrent();
            expect(result.subscription?.status).toBe('ACTIVE');
            expect(result.usage).toBeDefined();
        });

        it('should subscribe to a plan', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { subscriptionId: 'sub_123', keyId: 'rzp_key' },
                }),
            });

            const result = await subscriptionAPI.subscribe('starter', 'MONTHLY');
            expect(result.subscriptionId).toBe('sub_123');
            expect(result.keyId).toBe('rzp_key');
        });

        it('should subscribe with coupon code', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { subscriptionId: 'sub_456', keyId: 'rzp_key' },
                }),
            });

            const result = await subscriptionAPI.subscribe('growth', 'SAVE20');
            expect(result.subscriptionId).toBe('sub_456');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/subscriptions/subscribe'),
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ planSlug: 'growth', billingCycle: 'MONTHLY', couponCode: 'SAVE20' }),
                })
            );
        });

        it('should cancel subscription', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await expect(subscriptionAPI.cancel()).resolves.not.toThrow();
        });

        it('should change plan (upgrade)', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: { effective: 'immediate', planName: 'Growth' } }),
            });

            const result = await subscriptionAPI.changePlan('growth', { mode: 'now' });
            expect(result.effective).toBe('immediate');
            expect(result.planName).toBe('Growth');
        });

        it('should change plan (downgrade)', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { effective: 'cycle_end', planName: 'Starter', currentPeriodEnd: '2026-05-01T00:00:00.000Z' },
                }),
            });

            const result = await subscriptionAPI.changePlan('starter', { mode: 'cycle_end' });
            expect(result.effective).toBe('cycle_end');
            expect(result.currentPeriodEnd).toBeDefined();
        });

        it('should reactivate subscription', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await expect(subscriptionAPI.reactivate()).resolves.not.toThrow();
        });

        it('should purchase credits', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { orderId: 'ord_1', amount: 500, currency: 'INR', keyId: 'rzp_key', credits: 50 },
                }),
            });

            const result = await subscriptionAPI.purchaseCredits('pack1');
            expect(result.orderId).toBe('ord_1');
            expect(result.credits).toBe(50);
        });

        it('should verify credits', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            await expect(subscriptionAPI.verifyCredits('ord_1', 'pay_1', 'sig_1')).resolves.not.toThrow();
        });
    });

    describe('couponAPI', () => {
        it('should validate a coupon', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { valid: true, type: 'PERCENTAGE', value: 20 },
                }),
            });

            const result = await couponAPI.validate('SAVE20', 'starter', 'MONTHLY');
            expect(result.valid).toBe(true);
            expect(result.value).toBe(20);
        });

        it('should validate coupon without optional params', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { valid: false, reason: 'Coupon expired' },
                }),
            });

            const result = await couponAPI.validate('EXPIRED');
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('Coupon expired');
        });
    });

    describe('creditPacksAPI', () => {
        it('should get all credit packs', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: [
                        { id: 'cp1', name: 'Small Pack', credits: 10 },
                        { id: 'cp2', name: 'Large Pack', credits: 50 },
                    ],
                }),
            });

            const result = await creditPacksAPI.getAll();
            expect(result).toHaveLength(2);
            expect(result[0].credits).toBe(10);
        });
    });

    describe('invoiceAPI', () => {
        it('should get all invoices', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: [{ id: 'inv1', amount: 999 }, { id: 'inv2', amount: 1999 }],
                }),
            });

            const result = await invoiceAPI.getAll();
            expect(result).toHaveLength(2);
        });

        it('should get invoice by id', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { id: 'inv1', amountPaise: 999, status: 'PAID', restaurantId: 'r1', type: 'SUBSCRIPTION', currency: 'INR', description: 'Test' },
                }),
            });

            const result = await invoiceAPI.getById('inv1');
            expect(result.id).toBe('inv1');
            expect(result.amountPaise).toBe(999);
        });
    });

    describe('citiesAPI', () => {
        it('should get all cities', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: [
                        { name: 'Mumbai', zones: ['North', 'South'] },
                        { name: 'Delhi', zones: ['East', 'West'] },
                    ],
                }),
            });

            const result = await citiesAPI.getAll();
            expect(result).toHaveLength(2);
            expect(result[0].name).toBe('Mumbai');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/restaurant/cities'),
                expect.anything()
            );
        });
    });

    describe('accountManagerAPI', () => {
        it('should get account managers by city', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: [{ id: 'am1', name: 'Manager 1', city: 'Mumbai' }],
                }),
            });

            const result = await accountManagerAPI.getByCityAndZone('Mumbai');
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Manager 1');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/restaurant/account-managers?city=Mumbai'),
                expect.anything()
            );
        });

        it('should get account managers by city and zone', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: [{ id: 'am2', name: 'Manager 2', city: 'Mumbai', zone: 'North' }],
                }),
            });

            const result = await accountManagerAPI.getByCityAndZone('Mumbai', 'North');
            expect(result).toHaveLength(1);
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/restaurant/account-managers?city=Mumbai&zone=North'),
                expect.anything()
            );
        });
    });

    describe('restaurantAPI - additional', () => {
        it('should create restaurant', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: {
                        restaurant: { id: 'r1', name: 'New Restaurant' },
                        token: 'new-token',
                        refreshToken: 'new-refresh',
                    },
                }),
            });

            const result = await restaurantAPI.create({ name: 'New Restaurant', cuisine: 'Italian' });
            expect(result.restaurant.name).toBe('New Restaurant');
            expect(result.token).toBe('new-token');
        });

        it('should get analytics', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: {
                        postsPerWeek: [{ week: 1, posts: 5 }],
                        contentMix: [{ type: 'IMAGE', count: 3 }],
                        platformMix: [{ platform: 'INSTAGRAM', count: 4 }],
                    },
                }),
            });

            const result = await restaurantAPI.getAnalytics('r1');
            expect(result.postsPerWeek).toHaveLength(1);
            expect(result.contentMix[0].type).toBe('IMAGE');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/restaurant/r1/analytics'),
                expect.anything()
            );
        });
    });

    describe('authAPI - additional', () => {
        it('should store restaurantId on Firebase login when present', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    token: 'fb-token',
                    refreshToken: 'fb-refresh',
                    user: { id: 'u1', restaurantId: 'r1' },
                }),
            });

            await authAPI.loginWithFirebase('firebase-id-token');
            expect(localStorage.getItem('rp_restaurant_id')).toBe('r1');
        });

        it('should store restaurantId on verifyOtp when present', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    token: 'otp-token',
                    refreshToken: 'otp-refresh',
                    user: { id: 'u1', restaurantId: 'r2' },
                }),
            });

            await authAPI.verifyOtp('+919876543210', '123456');
            expect(localStorage.getItem('rp_restaurant_id')).toBe('r2');
        });

        it('should return false when refresh token response has no token', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

            const result = await authAPI.refreshToken('some-refresh');
            expect(result).toBe(false);
        });
    });

    describe('Additional Coverage', () => {
        it('should update restaurant offers', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { id: 'r1', name: 'Updated Restaurant', activeOffers: ['New offer'] },
                }),
            });

            const result = await restaurantAPI.updateOffers('r1', 'ADD', 'New offer');

            expect(result.activeOffers).toContain('New offer');
        });

        it('should update restaurant specials', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { id: 'r1', name: 'Updated Restaurant', chefSpecials: ['New special'] },
                }),
            });

            const result = await restaurantAPI.updateSpecials('r1', 'ADD', 'New special');

            expect(result.chefSpecials).toContain('New special');
        });

        it('should update restaurant menu', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { id: 'r1', name: 'Updated Restaurant' },
                }),
            });

            const result = await restaurantAPI.updateMenu('r1');

            expect(result.id).toBe('r1');
        });

        it('should update strategy', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { postsPerWeek: 5, contentThemes: ['Food', 'Atmosphere'] },
                }),
            });

            const result = await strategyAPI.updateStrategy({ postsPerWeek: 5 });

            expect(result.postsPerWeek).toBe(5);
        });

        it('should get cycle by id', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { id: 'c1', period: '2024 Q1', goals: ['goal1'] },
                }),
            });

            const result = await strategyAPI.getCycleById('c1');

            expect(result.id).toBe('c1');
        });

        it('should update a cycle', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: { id: 'c1', period: '2024 Q2 Updated', status: 'ACTIVE' },
                }),
            });

            const result = await strategyAPI.updateCycle('c1', { status: 'ACTIVE' });

            expect(result.status).toBe('ACTIVE');
        });

        it('should check session', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    user: { id: 'u1', email: 'test@test.com' },
                }),
            });

            const result = await authAPI.checkSession();

            expect(result.success).toBe(true);
            expect(result.user).toBeDefined();
        });
    });

    describe('configAPI', () => {
        it('should return configured web theme from features endpoint', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    success: true,
                    data: {
                        deleteAccount: false,
                        topupCredits: false,
                        updatesSection: true,
                        minScheduleAheadMins: 150,
                        postApprovalBufferMins: 120,
                        cycleApprovalBufferMins: 4320,
                        enabledPlatforms: ['INSTAGRAM', 'FACEBOOK'],
                        webTheme: 'orchid-admin',
                    },
                }),
            });

            const result = await configAPI.getFeatures();
            expect(result.webTheme).toBe('orchid-admin');
        });

        it('should fallback to orchid-admin web theme when API returns no data', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true, data: null }),
            });

            const result = await configAPI.getFeatures();
            expect(result.webTheme).toBe('orchid-admin');
        });
    });
});
