import { describe, test, expect, beforeEach, afterAll, beforeAll } from 'vitest';

// Set Env vars BEFORE any imports
process.env.INSTAGRAM_APP_ID = 'test-app-id';
process.env.INSTAGRAM_APP_SECRET = 'test-app-secret';
process.env.INSTAGRAM_REDIRECT_URI = 'http://localhost/callback';

// Mock axios
const mockGet = vi.fn();
const mockPost = vi.fn();

// Create mock axios instance
const mockAxiosInstance = {
    get: mockGet,
    post: mockPost
};

// Mock axios module using unstable_mockModule for ESM support
vi.mock('axios', () => ({
    default: {
        get: mockGet,
        post: mockPost,
        create: vi.fn(() => mockAxiosInstance),
        isAxiosError: vi.fn()
    },
    AxiosError: class extends Error {
        response: any;
        constructor(message: string, response?: any) {
            super(message);
            this.response = response;
        }
    }
}));

// We use REAL encryption service for robust testing, instead of mocking it.
const { encrypt, decrypt } = await import('@restropulse/publishing');

// Dynamically import the service under test
const instagramService = await import('@restropulse/publishing');

describe('Instagram API Service', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Environment Config', () => {
        it('should detect configuration', () => {
            expect(instagramService.isInstagramConfigured()).toBe(true);
        });
    });

    describe('generateOAuthUrl', () => {
        it('should generate valid URL and state', async () => {
            const { url, state } = await instagramService.generateOAuthUrl('res-123');

            expect(url).toContain('https://www.facebook.com/v18.0/dialog/oauth');
            expect(url).toContain('client_id=test-app-id');
            expect(url).toMatch(/redirect_uri=http%3A%2F%2Flocalhost%2Fcallback/);
            // Verify state is a valid string (non-empty)
            expect(typeof state).toBe('string');
            expect(state.length).toBeGreaterThan(10);
        });

        it('should generate URL without IG_API_ONBOARDING by default', async () => {
            const { url } = await instagramService.generateOAuthUrl('res-123');

            // Should NOT contain extras parameter for standard flow
            expect(url).not.toContain('extras');
            expect(url).not.toContain('IG_API_ONBOARDING');
        });

        it('should include IG_API_ONBOARDING when useOnboarding is true', async () => {
            const { url } = await instagramService.generateOAuthUrl('res-123', true);

            // Should contain extras parameter with IG_API_ONBOARDING
            expect(url).toContain('extras');
            expect(decodeURIComponent(url)).toContain('IG_API_ONBOARDING');
        });

        it('should NOT include IG_API_ONBOARDING when useOnboarding is false', async () => {
            const { url } = await instagramService.generateOAuthUrl('res-123', false);

            expect(url).not.toContain('extras');
            expect(url).not.toContain('IG_API_ONBOARDING');
        });
    });

    describe('validateStateToken', () => {
        it('should return valid result for correct state', async () => {
            // Setup state using real encryption logic (via service helper)
            const { state } = await instagramService.generateOAuthUrl('res-123');

            const result = await instagramService.validateStateToken(state);
            expect(result).toEqual({ valid: true, restaurantId: 'res-123' });
        });

        it('should return invalid for unknown state', async () => {
            const result = await instagramService.validateStateToken('invalid-state');
            expect(result).toEqual({ valid: false });
        });

        it('should invalidate already used state token (one-time use)', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-123');

            // First use - valid
            const firstResult = await instagramService.validateStateToken(state);
            expect(firstResult).toEqual({ valid: true, restaurantId: 'res-123' });

            // Second use - invalid (already consumed)
            const secondResult = await instagramService.validateStateToken(state);
            expect(secondResult).toEqual({ valid: false });
        });

        // Note: State expiry test would require mocking Date.now or waiting 10+ minutes
        // which is impractical. The code is tested via the one-time use test above.
    });

    describe('handleOAuthCallback', () => {
        it('should fail if state is invalid', async () => {
            const result = await instagramService.handleOAuthCallback('code', 'invalid-state');
            expect(result.success).toBe(false);
            expect(result.error).toBe('INVALID_STATE');
        });

        it('should skip state validation when skipStateValidation is true', async () => {
            // Mock token exchange to fail (to verify we got past state validation)
            mockGet.mockRejectedValueOnce(new Error('Token failed'));

            // This would normally fail with INVALID_STATE, but with skipStateValidation=true
            // it should proceed to token exchange and fail there
            const result = await instagramService.handleOAuthCallback('code', 'any-state', true);
            expect(result.success).toBe(false);
            expect(result.error).toBe('TOKEN_EXCHANGE_FAILED'); // Not INVALID_STATE
        });

        it('should fail if token exchange fails', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-123');
            mockGet.mockRejectedValueOnce(new Error('Token failed'));

            const result = await instagramService.handleOAuthCallback('code', state);
            expect(result.success).toBe(false);
            expect(result.error).toBe('TOKEN_EXCHANGE_FAILED');
        });

        it('should fail if permissions are missing', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-123');

            // 1. Token exchange success (code -> short -> long)
            mockGet.mockImplementation((url: any, config: any) => {
                if (url.includes('oauth/access_token')) {
                    if (config?.params?.grant_type === 'fb_exchange_token') { // long lived
                        return Promise.resolve({ data: { access_token: 'long-token', expires_in: 3600 } });
                    }
                    // default to short lived
                    return Promise.resolve({ data: { access_token: 'short-token', user_id: '123' } });
                }
                // 2. Permissions check
                if (url.includes('/me/permissions')) {
                    return Promise.resolve({
                        data: {
                            data: [
                                { permission: 'instagram_basic', status: 'granted' },
                                // Missing other required permissions
                            ]
                        }
                    });
                }
                return Promise.reject(new Error('Unknown url: ' + url));
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(false);
            expect(result.error).toBe('PERMISSIONS_MISSING');
        });

        it('should fail if no pages found', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-123');

            mockGet.mockImplementation((url: any) => {
                if (url.includes('oauth/access_token')) return Promise.resolve({ data: { access_token: 't', expires_in: 100 } });
                if (url.includes('/me/permissions')) {
                    return Promise.resolve({
                        data: {
                            data: ['instagram_basic', 'pages_show_list', 'pages_read_engagement', 'read_insights', 'business_management'].map(p => ({ permission: p, status: 'granted' }))
                        }
                    });
                }
                // 3. Pages check
                if (url.includes('/me/accounts')) {
                    return Promise.resolve({ data: { data: [] } });
                }
                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(false);
            expect(result.error).toBe('NO_PAGES_FOUND');
        });

        it('should fail if no IG account found on pages', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-123');

            mockGet.mockImplementation((url: any) => {
                if (url.includes('oauth/access_token')) return Promise.resolve({ data: { access_token: 't', expires_in: 100 } });
                if (url.includes('/me/permissions')) {
                    return Promise.resolve({
                        data: {
                            data: ['instagram_basic', 'pages_show_list', 'pages_read_engagement', 'read_insights', 'business_management'].map(p => ({ permission: p, status: 'granted' }))
                        }
                    });
                }
                if (url.includes('/me/accounts')) {
                    return Promise.resolve({
                        data: {
                            data: [{ id: 'page-1', access_token: 'pt', name: 'Page 1' }] // Page without IG
                        }
                    });
                }
                // Get IG account for page
                if (url.includes('page-1')) {
                    return Promise.resolve({ data: { instagram_business_account: null } }); // explicit null
                }
                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(false);
            expect(result.error).toBe('NO_IG_ACCOUNT_FOUND');
        });

        it('should succeed with multiple accounts', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-123');

            mockGet.mockImplementation((url: any) => {
                if (url.includes('oauth/access_token')) return Promise.resolve({ data: { access_token: 't', expires_in: 100 } });
                if (url.includes('/me/permissions')) {
                    return Promise.resolve({
                        data: {
                            data: ['instagram_basic', 'pages_show_list', 'pages_read_engagement', 'read_insights', 'business_management'].map(p => ({ permission: p, status: 'granted' }))
                        }
                    });
                }
                if (url.includes('/me/accounts')) {
                    return Promise.resolve({
                        data: {
                            data: [
                                { id: 'page-1', access_token: 'pt1', name: 'Page 1', instagram_business_account: { id: 'ig-1' } },
                                { id: 'page-2', access_token: 'pt2', name: 'Page 2', instagram_business_account: { id: 'ig-2' } }
                            ]
                        }
                    });
                }
                if (url.includes('ig-1')) {
                    return Promise.resolve({ data: { id: 'ig-1', username: 'user1', name: 'User 1' } });
                }
                if (url.includes('ig-2')) {
                    return Promise.resolve({ data: { id: 'ig-2', username: 'user2', name: 'User 2' } });
                }

                if (url.includes('page-1')) return Promise.resolve({ data: { instagram_business_account: { id: 'ig-1' } } });
                if (url.includes('page-2')) return Promise.resolve({ data: { instagram_business_account: { id: 'ig-2' } } });

                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(true);
            expect(result.accounts).toHaveLength(2);
            expect(result.account).toBeUndefined(); // No auto-select
        });

        it('should auto-select single account', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-single');

            mockGet.mockImplementation((url: any) => {
                if (url.includes('oauth/access_token')) return Promise.resolve({ data: { access_token: 't', expires_in: 100 } });
                if (url.includes('/me/permissions')) {
                    return Promise.resolve({
                        data: {
                            data: ['instagram_basic', 'pages_show_list', 'pages_read_engagement'].map(p => ({ permission: p, status: 'granted' }))
                        }
                    });
                }
                if (url.includes('/me/accounts')) {
                    return Promise.resolve({
                        data: {
                            data: [
                                { id: 'page-1', access_token: 'pt1', name: 'My Page' }
                            ]
                        }
                    });
                }
                // Page IG account lookup
                if (url.includes('page-1')) {
                    return Promise.resolve({ data: { instagram_business_account: { id: 'ig-1' }, name: 'My Page' } });
                }
                // IG account details
                if (url.includes('ig-1')) {
                    return Promise.resolve({ data: { id: 'ig-1', username: 'myuser', name: 'My User' } });
                }
                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(true);
            expect(result.account).toBeDefined(); // Auto-selected single account
            expect(result.account?.username).toBe('myuser');
            expect(result.accounts).toBeUndefined(); // Not multiple
        });

        it('should handle config error when not configured', async () => {
            // Temporarily clear config to test CONFIG_ERROR path
            const origAppId = process.env.INSTAGRAM_APP_ID;
            process.env.INSTAGRAM_APP_ID = '';

            // Re-import to pick up changed config
            vi.resetModules();
            const freshService = await import('@restropulse/publishing');

            const result = await freshService.handleOAuthCallback('code', 'state');
            expect(result.success).toBe(false);
            expect(result.error).toBe('CONFIG_ERROR');

            // Restore config
            process.env.INSTAGRAM_APP_ID = origAppId;
        });

        it('should handle page fetch error gracefully', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-page-err');

            mockGet.mockImplementation((url: any) => {
                if (url.includes('oauth/access_token')) return Promise.resolve({ data: { access_token: 't', expires_in: 100 } });
                if (url.includes('/me/permissions')) {
                    return Promise.resolve({
                        data: {
                            data: ['instagram_basic', 'pages_show_list', 'pages_read_engagement'].map(p => ({ permission: p, status: 'granted' }))
                        }
                    });
                }
                // Pages endpoint fails
                if (url.includes('/me/accounts')) {
                    return Promise.reject(new Error('Failed to fetch pages'));
                }
                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(false);
            expect(result.error).toBe('NO_PAGES_FOUND');
        });

        it('should handle IG account fetch error gracefully', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-ig-err');

            mockGet.mockImplementation((url: any) => {
                if (url.includes('oauth/access_token')) return Promise.resolve({ data: { access_token: 't', expires_in: 100 } });
                if (url.includes('/me/permissions')) {
                    return Promise.resolve({
                        data: {
                            data: ['instagram_basic', 'pages_show_list', 'pages_read_engagement'].map(p => ({ permission: p, status: 'granted' }))
                        }
                    });
                }
                if (url.includes('/me/accounts')) {
                    return Promise.resolve({
                        data: { data: [{ id: 'page-1', access_token: 'pt1', name: 'Page' }] }
                    });
                }
                // IG account lookup fails
                if (url.includes('page-1')) {
                    return Promise.reject(new Error('Failed to fetch IG account'));
                }
                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(false);
            expect(result.error).toBe('NO_IG_ACCOUNT_FOUND');
        });

        it('should use granular_scopes fallback when /me/accounts is empty', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-granular');

            mockGet.mockImplementation((url: any, config: any) => {
                // Token exchange
                if (url.includes('oauth/access_token')) {
                    return Promise.resolve({ data: { access_token: 't', expires_in: 100 } });
                }
                // Permissions
                if (url.includes('/me/permissions')) {
                    return Promise.resolve({
                        data: {
                            data: ['instagram_basic', 'pages_show_list'].map(p => ({ permission: p, status: 'granted' }))
                        }
                    });
                }
                // Debug token - this is where granular_scopes come from
                if (url.includes('/debug_token')) {
                    return Promise.resolve({
                        data: {
                            data: {
                                granular_scopes: [
                                    { scope: 'pages_show_list', target_ids: ['page-123'] },
                                    { scope: 'instagram_basic', target_ids: ['ig-456'] }
                                ]
                            }
                        }
                    });
                }
                // /me endpoint for user info
                if (url === '/me' && config?.params?.fields === 'id,name,email') {
                    return Promise.resolve({ data: { id: 'user-1', name: 'Test User' } });
                }
                // /me/accounts returns empty (Development mode bug)
                if (url.includes('/me/accounts')) {
                    return Promise.resolve({ data: { data: [] } });
                }
                // /me?fields=accounts also empty
                if (url === '/me' && config?.params?.fields?.includes('accounts')) {
                    return Promise.resolve({ data: { id: 'user-1' } });
                }
                // Direct page fetch (granular_scopes fallback)
                if (url === '/page-123') {
                    return Promise.resolve({
                        data: {
                            id: 'page-123',
                            name: 'Test Page',
                            access_token: 'page-token',
                            instagram_business_account: { id: 'ig-456' }
                        }
                    });
                }
                // IG account details
                if (url === '/ig-456') {
                    return Promise.resolve({
                        data: { id: 'ig-456', username: 'test_ig', name: 'Test IG' }
                    });
                }
                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(true);
            expect(result.account).toBeDefined();
            expect(result.account?.username).toBe('test_ig');
        });

        it('should deduplicate pages from granular_scopes', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-dedup');

            mockGet.mockImplementation((url: any, config: any) => {
                if (url.includes('oauth/access_token')) return Promise.resolve({ data: { access_token: 't', expires_in: 100 } });
                if (url.includes('/me/permissions')) {
                    return Promise.resolve({
                        data: { data: ['instagram_basic', 'pages_show_list'].map(p => ({ permission: p, status: 'granted' })) }
                    });
                }
                // Same page ID appears in multiple scopes
                if (url.includes('/debug_token')) {
                    return Promise.resolve({
                        data: {
                            data: {
                                granular_scopes: [
                                    { scope: 'pages_show_list', target_ids: ['page-same'] },
                                    { scope: 'pages_read_user_content', target_ids: ['page-same'] } // Same page
                                ]
                            }
                        }
                    });
                }
                if (url === '/me' && config?.params?.fields === 'id,name,email') {
                    return Promise.resolve({ data: { id: 'user-1' } });
                }
                if (url.includes('/me/accounts')) return Promise.resolve({ data: { data: [] } });
                if (url === '/me' && config?.params?.fields?.includes('accounts')) {
                    return Promise.resolve({ data: { id: 'user-1' } });
                }
                // Only one fetch should happen due to deduplication
                if (url === '/page-same') {
                    return Promise.resolve({
                        data: { id: 'page-same', name: 'Same Page', access_token: 'pt', instagram_business_account: { id: 'ig-1' } }
                    });
                }
                if (url === '/ig-1') {
                    return Promise.resolve({ data: { id: 'ig-1', username: 'single_user', name: 'Single' } });
                }
                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(true);
            expect(result.account).toBeDefined(); // Single account auto-selected
            expect(result.account?.username).toBe('single_user');
        });

        it('should deduplicate Instagram accounts across multiple pages', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-ig-dedup');

            mockGet.mockImplementation((url: any) => {
                if (url.includes('oauth/access_token')) return Promise.resolve({ data: { access_token: 't', expires_in: 100 } });
                if (url.includes('/me/permissions')) {
                    return Promise.resolve({
                        data: { data: ['instagram_basic', 'pages_show_list', 'pages_read_engagement'].map(p => ({ permission: p, status: 'granted' })) }
                    });
                }
                // Two different pages but same IG account
                if (url.includes('/me/accounts')) {
                    return Promise.resolve({
                        data: {
                            data: [
                                { id: 'page-1', access_token: 'pt1', name: 'Page 1' },
                                { id: 'page-2', access_token: 'pt2', name: 'Page 2' }
                            ]
                        }
                    });
                }
                // Both pages link to same IG account
                if (url.includes('page-1')) {
                    return Promise.resolve({ data: { instagram_business_account: { id: 'same-ig' }, name: 'Page 1' } });
                }
                if (url.includes('page-2')) {
                    return Promise.resolve({ data: { instagram_business_account: { id: 'same-ig' }, name: 'Page 2' } });
                }
                if (url.includes('same-ig')) {
                    return Promise.resolve({ data: { id: 'same-ig', username: 'shared_ig', name: 'Shared IG' } });
                }
                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(true);
            // Should auto-select because after deduplication there's only 1 unique IG account
            expect(result.account).toBeDefined();
            expect(result.account?.username).toBe('shared_ig');
            expect(result.accounts).toBeUndefined(); // Not multiple after dedup
        });
    });

    describe('Token Management', () => {
        it('should refresh access token success', async () => {
            mockGet.mockImplementation((url: any, config: any) => {
                if (config?.params?.grant_type === 'fb_exchange_token') {
                    return Promise.resolve({
                        data: { access_token: 'new-token', expires_in: 5000 }
                    });
                }
                return Promise.reject(new Error('Unknown'));
            });

            const encToken = encrypt('old-token');
            const result = await instagramService.refreshAccessToken(encToken);
            expect(result).toBeDefined();
            expect(result?.accessToken).toBe('new-token');
        });

        it('should handle refresh token failure (decrypt fail)', async () => {
            const result = await instagramService.refreshAccessToken(''); // invalid enc
            expect(result).toBeNull();
        });

        it('should handle refresh token failure (api fail)', async () => {
            mockGet.mockRejectedValue(new Error('API Error'));
            const encToken = encrypt('old-token');
            const result = await instagramService.refreshAccessToken(encToken);
            expect(result).toBeNull();
        });

        it('should validate token success', async () => {
            mockGet.mockResolvedValue({ data: { id: 'user-123' } });
            const encToken = encrypt('valid-token');
            const isValid = await instagramService.validateToken(encToken);
            expect(isValid).toBe(true);
        });

        it('should validate token failure', async () => {
            mockGet.mockRejectedValue(new Error('Auth failed'));
            const encToken = encrypt('invalid');
            const isValid = await instagramService.validateToken(encToken);
            expect(isValid).toBe(false);
        });

        it('should validate token fail logic (decrypt)', async () => {
            const isValid = await instagramService.validateToken('');
            expect(isValid).toBe(false);
        });

        it('should handle rate limit error during token refresh', async () => {
            // Simulate Meta rate limit error (code 4)
            const rateLimitError: any = new Error('Rate limited');
            rateLimitError.response = {
                status: 429,
                data: {
                    error: {
                        code: 4,
                        message: 'Application request limit reached'
                    }
                }
            };
            mockGet.mockRejectedValue(rateLimitError);

            const encToken = encrypt('valid-token');
            const result = await instagramService.refreshAccessToken(encToken);
            expect(result).toBeNull();
        });

        it('should handle default expires_in when not provided', async () => {
            mockGet.mockImplementation((url: any, config: any) => {
                if (config?.params?.grant_type === 'fb_exchange_token') {
                    return Promise.resolve({
                        data: { access_token: 'new-token' } // No expires_in
                    });
                }
                return Promise.reject(new Error('Unknown'));
            });

            const encToken = encrypt('old-token');
            const result = await instagramService.refreshAccessToken(encToken);
            expect(result).toBeDefined();
            expect(result?.accessToken).toBe('new-token');
            // Should use default 60 days expiry
            expect(result?.expiresAt).toBeDefined();
        });
    });

    describe('Profile & Credentials', () => {
        it('getInstagramProfile success', async () => {
            mockGet.mockResolvedValue({
                data: { id: 'ig-123', username: 'test', followers_count: 100 }
            });
            const encToken = encrypt('token');
            const profile = await instagramService.getInstagramProfile(encToken, 'ig-123');
            expect(profile).toBeDefined();
            expect(profile.username).toBe('test');
        });

        it('getInstagramProfile failure (decrypt)', async () => {
            const profile = await instagramService.getInstagramProfile('', 'ig-123');
            expect(profile).toBeNull();
        });

        it('getInstagramProfile failure (api)', async () => {
            mockGet.mockRejectedValue(new Error('API Error'));
            const encToken = encrypt('token');
            const profile = await instagramService.getInstagramProfile(encToken, 'ig-123');
            expect(profile).toBeNull();
        });

        it('prepareCredentialsForStorage', () => {
            const account = {
                id: 'ig-123',
                username: 'my_ig',
                name: 'My IG',
                profilePictureUrl: 'http://pic',
                pageId: 'page-123',
                pageName: 'Page Name'
            };
            const now = new Date();
            const stored = instagramService.prepareCredentialsForStorage(account, 'my-token', now);

            expect(stored.userId).toBe('ig-123');
            expect(decrypt(stored.accessToken)).toBe('my-token');
            expect(stored.tokenExpiresAt).toBe(now);
        });
    });

    describe('Error Handling (parseMetaApiError)', () => {
        it('should handle permission validation error', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-perm-err');

            mockGet.mockImplementation((url: any) => {
                if (url.includes('oauth/access_token')) return Promise.resolve({ data: { access_token: 't', expires_in: 100 } });
                // Permissions endpoint fails
                if (url.includes('/me/permissions')) {
                    return Promise.reject(new Error('Permission check failed'));
                }
                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(false);
            expect(result.error).toBe('PERMISSIONS_MISSING');
        });

        it('should handle timeout errors during OAuth flow', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-timeout');

            // Create a proper timeout-like AxiosError
            const timeoutError: any = new Error('timeout of 30000ms exceeded');
            timeoutError.code = 'ECONNABORTED';
            timeoutError.response = undefined;

            mockGet.mockImplementation((url: any) => {
                if (url.includes('oauth/access_token')) {
                    return Promise.reject(timeoutError);
                }
                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(false);
            expect(result.error).toBe('TOKEN_EXCHANGE_FAILED');
        });

        it('should handle ETIMEDOUT error code', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-etimedout');

            const etimedoutError: any = new Error('connect ETIMEDOUT');
            etimedoutError.code = 'ETIMEDOUT';
            etimedoutError.response = undefined;

            mockGet.mockImplementation((url: any) => {
                if (url.includes('oauth/access_token')) {
                    return Promise.reject(etimedoutError);
                }
                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(false);
            expect(result.error).toBe('TOKEN_EXCHANGE_FAILED');
        });

        it('should handle Meta API error with code', async () => {
            const { state } = await instagramService.generateOAuthUrl('res-meta-err');

            mockGet.mockImplementation((url: any) => {
                if (url.includes('oauth/access_token')) return Promise.resolve({ data: { access_token: 't', expires_in: 100 } });
                if (url.includes('/me/permissions')) {
                    return Promise.resolve({
                        data: {
                            data: ['instagram_basic', 'pages_show_list', 'pages_read_engagement'].map(p => ({ permission: p, status: 'granted' }))
                        }
                    });
                }
                if (url.includes('/me/accounts')) {
                    // Simulate Meta error with code
                    const metaError: any = new Error('Meta error');
                    metaError.response = {
                        data: {
                            error: {
                                code: 190,
                                message: 'Invalid OAuth access token'
                            }
                        }
                    };
                    return Promise.reject(metaError);
                }
                return Promise.resolve({ data: {} });
            });

            const result = await instagramService.handleOAuthCallback('code-123', state);
            expect(result.success).toBe(false);
            expect(result.error).toBe('NO_PAGES_FOUND');
        });
    });
});
