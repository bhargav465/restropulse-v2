/**
 * Meta API Service
 * Handles OAuth flow, token management, and API calls to Instagram/Meta
 */

import axios, { AxiosError } from 'axios';
import { generateStateToken, encrypt, decrypt } from './encryption.js';
import { getOauthSessionsCollection } from '@restropulse/db';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('meta-api');

// Instagram OAuth Configuration
function getInstagramConfig(): { appId: string; appSecret: string; redirectUri: string } {
    return {
        appId: process.env.INSTAGRAM_APP_ID || '',
        appSecret: process.env.INSTAGRAM_APP_SECRET || '',
        redirectUri: process.env.INSTAGRAM_REDIRECT_URI || 'http://localhost:3001/api/integrations/instagram/callback',
    };
}

// API Endpoints
const META_OAUTH_URL = 'https://www.facebook.com/v18.0/dialog/oauth';
const META_GRAPH_API = 'https://graph.facebook.com/v18.0';

// Request timeout (30 seconds)
const API_TIMEOUT_MS = 30000;

// Create axios instance with defaults
const metaApi = axios.create({
    baseURL: META_GRAPH_API,
    timeout: API_TIMEOUT_MS
});

// Required OAuth Scopes for Instagram Business
const OAUTH_SCOPES = [
    'instagram_basic',
    'instagram_content_publish',
    'pages_show_list',
    'pages_read_user_content',
    'pages_manage_posts',  // Required for uploading photos to Facebook Page (CDN upload)
    'public_profile'
].join(',');

const STATE_TOKEN_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// Error types for validation pipeline
export type InstagramConnectionError =
    | 'NO_PAGES_FOUND'
    | 'NO_IG_ACCOUNT_FOUND'
    | 'PERMISSIONS_MISSING'
    | 'INVALID_STATE'
    | 'TOKEN_EXCHANGE_FAILED'
    | 'API_ERROR'
    | 'ACCOUNT_TYPE_MISMATCH'
    | 'RATE_LIMITED'
    | 'CONFIG_ERROR'
    | 'TIMEOUT';

export interface InstagramAccount {
    id: string;
    username: string;
    name?: string;
    profilePictureUrl?: string;
    pageId: string;
    pageName: string;
    pageAccessToken?: string; // Page token needed for Content Publishing API
}

export interface InstagramConnectionResult {
    success: boolean;
    error?: InstagramConnectionError;
    errorMessage?: string;
    account?: InstagramAccount;
    accounts?: InstagramAccount[]; // Multiple accounts for picker
    accessToken?: string;
    tokenExpiresAt?: Date;
}

export interface StoredInstagramCredentials {
    userId: string;
    username: string;
    pageId: string;
    pageName: string;
    accessToken: string; // Encrypted
    tokenExpiresAt: Date;
    scopes: string[];
    connectedAt: Date;
    lastRefreshedAt?: Date;
}

/**
 * Generate OAuth URL with CSRF protection
 * Uses Business Login for Instagram with extras parameter for simplified onboarding
 * See: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram
 */
export async function generateOAuthUrl(restaurantId: string, useOnboarding: boolean = false): Promise<{ url: string; state: string }> {
    const { appId, redirectUri } = getInstagramConfig();
    const state = generateStateToken();
    const expiresAt = new Date(Date.now() + STATE_TOKEN_EXPIRY_MS);
    const col = getOauthSessionsCollection();
    await col.insertOne({ type: 'oauth_state', state, restaurantId, expiresAt });

    const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        scope: OAUTH_SCOPES,
        response_type: 'code',
        state: state
    });

    // IG_API_ONBOARDING is for users who need to set up their Instagram Business account
    // Standard OAuth (without extras) works better for users who already have everything configured
    if (useOnboarding) {
        const extras = JSON.stringify({
            setup: {
                channel: 'IG_API_ONBOARDING'
            }
        });
        params.append('extras', extras);
        log.info({ flow: 'IG_API_ONBOARDING' }, 'Using onboarding flow for guided setup');
    } else {
        log.info({ flow: 'standard' }, 'Using standard OAuth flow');
    }

    return {
        url: `${META_OAUTH_URL}?${params.toString()}`,
        state
    };
}

/**
 * Validate state token and return associated restaurant ID
 * One-time use: findOneAndDelete removes the token atomically
 */
export async function validateStateToken(state: string): Promise<{ valid: boolean; restaurantId?: string }> {
    const col = getOauthSessionsCollection();
    const doc = await col.findOneAndDelete({ type: 'oauth_state', state }) as any;

    if (!doc) {
        return { valid: false };
    }

    // Check expiry (TTL index handles background cleanup; check here for immediate validation)
    if (new Date() > new Date(doc.expiresAt)) {
        return { valid: false };
    }

    return { valid: true, restaurantId: doc.restaurantId };
}

/**
 * Parse Meta API error for better error messages
 */
function parseMetaApiError(error: unknown): { code: number | null; subcode: string | null; fbtraceId: string | null; message: string; isRateLimit: boolean; isTimeout: boolean } {
    if (error instanceof AxiosError) {
        // Timeout error
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            return { code: null, subcode: null, fbtraceId: null, message: 'Request timed out', isRateLimit: false, isTimeout: true };
        }

        const metaError = error.response?.data?.error;
        if (metaError) {
            // Meta rate limit codes: 4 (app-level), 17 (user-level), 32 (page-level)
            const isRateLimit = [4, 17, 32].includes(metaError.code);
            return {
                code: metaError.code,
                subcode: metaError.error_subcode != null ? String(metaError.error_subcode) : null,
                fbtraceId: metaError.fbtrace_id ?? null,
                message: metaError.message || 'Unknown Meta API error',
                isRateLimit,
                isTimeout: false
            };
        }

        return {
            code: error.response?.status || null,
            subcode: null,
            fbtraceId: null,
            message: error.message,
            isRateLimit: error.response?.status === 429,
            isTimeout: false
        };
    }

    return { code: null, subcode: null, fbtraceId: null, message: String(error), isRateLimit: false, isTimeout: false };
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(code: string): Promise<{ accessToken: string; expiresIn: number } | null> {
    const { appId, appSecret, redirectUri } = getInstagramConfig();
    log.info({ step: 1 }, 'Exchanging code for short-lived token');
    try {
        const response = await metaApi.get('/oauth/access_token', {
            params: {
                client_id: appId,
                client_secret: appSecret,
                redirect_uri: redirectUri,
                code: code
            }
        });
        log.info({ step: 1 }, 'Got short-lived token');

        // Exchange short-lived token for long-lived token
        const shortLivedToken = response.data.access_token;
        log.info({ step: 2 }, 'Exchanging for long-lived token');

        const longLivedResponse = await metaApi.get('/oauth/access_token', {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: appId,
                client_secret: appSecret,
                fb_exchange_token: shortLivedToken
            }
        });
        log.info({ step: 2, expiresIn: longLivedResponse.data.expires_in }, 'Got long-lived token');

        return {
            accessToken: longLivedResponse.data.access_token,
            expiresIn: longLivedResponse.data.expires_in || 5184000 // Default 60 days
        };
    } catch (error) {
        log.error({ error: error instanceof AxiosError ? error.response?.data : String(error) }, 'Token exchange failed');
        return null;
    }
}

/**
 * Fetch user's managed Facebook Pages
 */
async function getUserPages(accessToken: string): Promise<Array<{ id: string; name: string; access_token: string }>> {
    const { appId, appSecret } = getInstagramConfig();
    log.info({ step: 3 }, 'Fetching Facebook Pages');

    // First, let's see who we're authenticated as
    try {
        const meResponse = await metaApi.get('/me', {
            params: {
                access_token: accessToken,
                fields: 'id,name,email'
            }
        });
        log.info({ user: meResponse.data }, 'Authenticated as');
    } catch (err) {
        log.error({ error: String(err) }, 'Failed to get /me');
    }

    // Debug: Check token info and extract granular_scopes
    let granularPageIds: string[] = [];
    let granularIgIds: string[] = [];

    try {
        const debugResponse = await metaApi.get('/debug_token', {
            params: {
                input_token: accessToken,
                access_token: `${appId}|${appSecret}`
            }
        });
        log.info({ tokenDebug: debugResponse.data }, 'Token debug info');

        // Extract page IDs from granular_scopes (fallback for Development mode)
        const granularScopes = debugResponse.data.data?.granular_scopes || [];
        const pageIdSet = new Set<string>();
        const igIdSet = new Set<string>();

        for (const scope of granularScopes) {
            if (scope.scope === 'pages_show_list' || scope.scope === 'pages_read_user_content') {
                (scope.target_ids || []).forEach((id: string) => pageIdSet.add(id));
            }
            if (scope.scope === 'instagram_basic') {
                (scope.target_ids || []).forEach((id: string) => igIdSet.add(id));
            }
        }

        granularPageIds = Array.from(pageIdSet);
        granularIgIds = Array.from(igIdSet);
        log.info({ granularPageIds, granularIgIds }, 'Extracted from granular_scopes');
    } catch (err) {
        log.info('Could not get token debug info');
    }

    try {
        // Try /me/accounts first (standard approach)
        log.info({ step: '3a' }, 'Trying /me/accounts');
        const response = await metaApi.get('/me/accounts', {
            params: {
                access_token: accessToken,
                fields: 'id,name,access_token,instagram_business_account'
            }
        });

        let pages = response.data.data || [];
        log.info({ step: '3a', response: response.data }, '/me/accounts response');

        // If empty, try alternative endpoint with nested fields
        if (pages.length === 0) {
            log.info({ step: '3b' }, '/me/accounts empty, trying /me?fields=accounts');
            const altResponse = await metaApi.get('/me', {
                params: {
                    access_token: accessToken,
                    fields: 'accounts{id,name,access_token,instagram_business_account}'
                }
            });
            log.info({ step: '3b', response: altResponse.data }, '/me?fields=accounts response');
            pages = altResponse.data.accounts?.data || [];
        }

        // If still empty, check business accounts
        if (pages.length === 0) {
            log.info({ step: '3c' }, 'Still empty, trying /me/businesses');
            try {
                const bizResponse = await metaApi.get('/me/businesses', {
                    params: {
                        access_token: accessToken,
                        fields: 'id,name,owned_pages{id,name,access_token}'
                    }
                });
                log.info({ step: '3c', response: bizResponse.data }, '/me/businesses response');

                // Extract pages from businesses
                const businesses = bizResponse.data.data || [];
                for (const biz of businesses) {
                    const bizPages = biz.owned_pages?.data || [];
                    pages.push(...bizPages);
                }
            } catch (bizErr) {
                log.info({ step: '3c' }, '/me/businesses failed (might need business_management permission)');
            }
        }

        // FALLBACK: If still empty but we have page IDs from granular_scopes, fetch them directly
        // This handles a Meta bug in Development mode where /me/accounts returns empty
        // even though the user granted page permissions
        if (pages.length === 0 && granularPageIds.length > 0) {
            log.info({ step: '3d', granularPageIds }, 'Using granular_scopes fallback - fetching pages directly by ID');

            for (const pageId of granularPageIds) {
                try {
                    // Fetch page details directly - we need a page access token
                    // First, try to get page access token through the page endpoint
                    const pageResponse = await metaApi.get(`/${pageId}`, {
                        params: {
                            access_token: accessToken,
                            fields: 'id,name,access_token,instagram_business_account'
                        }
                    });
                    log.info({ step: '3d', pageId, response: pageResponse.data }, 'Fetched page');

                    if (pageResponse.data.id) {
                        pages.push({
                            id: pageResponse.data.id,
                            name: pageResponse.data.name || 'Unknown Page',
                            access_token: pageResponse.data.access_token || accessToken, // Use page token or user token
                            instagram_business_account: pageResponse.data.instagram_business_account
                        });
                    }
                } catch (pageErr) {
                    log.info({ step: '3d', pageId, error: pageErr instanceof Error ? pageErr.message : String(pageErr) }, 'Could not fetch page');
                }
            }
        }

        log.info({ step: 3, pageCount: pages.length, pages: pages.map((p: any) => ({ id: p.id, name: p.name })) }, 'Fetched pages final result');
        return pages;
    } catch (error) {
        const parsed = parseMetaApiError(error);
        log.error({ step: 3, error: parsed.message, code: parsed.code, subcode: parsed.subcode, fbtraceId: parsed.fbtraceId, fullError: error instanceof AxiosError ? error.response?.data : undefined }, 'Get pages failed');
        return [];
    }
}

/**
 * Get Instagram Business Account linked to a Facebook Page
 */
async function getInstagramBusinessAccount(pageId: string, pageAccessToken: string): Promise<InstagramAccount | null> {
    try {
        // Get Instagram Business Account ID linked to the page
        log.info({ step: '4b', pageId }, 'Fetching IG account for page');
        const pageResponse = await metaApi.get(`/${pageId}`, {
            params: {
                access_token: pageAccessToken,
                fields: 'instagram_business_account,name'
            }
        });
        log.info({ step: '4b', response: pageResponse.data }, 'Page response');

        const igAccountId = pageResponse.data.instagram_business_account?.id;
        const pageName = pageResponse.data.name;

        if (!igAccountId) {
            log.info({ pageName }, 'No Instagram Business Account linked to page');
            return null;
        }
        log.info({ igAccountId, pageName }, 'Found IG account for page');

        // Get Instagram account details
        log.info({ step: '4c', igAccountId }, 'Fetching IG account details');
        const igResponse = await metaApi.get(`/${igAccountId}`, {
            params: {
                access_token: pageAccessToken,
                fields: 'id,username,name,profile_picture_url'
            }
        });
        log.info({ step: '4c', igAccount: igResponse.data }, 'IG account details');

        return {
            id: igResponse.data.id,
            username: igResponse.data.username,
            name: igResponse.data.name,
            profilePictureUrl: igResponse.data.profile_picture_url,
            pageId: pageId,
            pageName: pageName,
            pageAccessToken: pageAccessToken // Carry the page token for publishing
        };
    } catch (error) {
        const parsed = parseMetaApiError(error);
        log.error({ error: parsed.message, code: parsed.code, subcode: parsed.subcode, fbtraceId: parsed.fbtraceId, fullError: error instanceof AxiosError ? error.response?.data : undefined }, 'Get IG account failed');
        return null;
    }
}

/**
 * Validate Instagram permissions
 */
async function validatePermissions(accessToken: string): Promise<boolean> {
    log.info('Checking granted permissions');
    try {
        const response = await metaApi.get('/me/permissions', {
            params: { access_token: accessToken }
        });

        log.info({ permissions: response.data.data }, 'All permissions');

        const grantedPermissions = response.data.data
            .filter((p: any) => p.status === 'granted')
            .map((p: any) => p.permission);

        log.info({ grantedPermissions }, 'Granted permissions');

        // Only require the essential permissions
        const requiredPermissions = ['instagram_basic', 'pages_show_list'];
        const hasAll = requiredPermissions.every(p => grantedPermissions.includes(p));
        log.info({ requiredPermissions, hasAll }, 'Permission check result');

        return hasAll;
    } catch (error) {
        const parsed = parseMetaApiError(error);
        log.error({ error: parsed.message, code: parsed.code, subcode: parsed.subcode, fbtraceId: parsed.fbtraceId }, 'Permission validation failed');
        return false;
    }
}

/**
 * Main OAuth callback handler - runs the validation pipeline
 * Steps A-B-C-D from the integration spec
 * @param skipStateValidation - Set to true if state was already validated by caller
 */
export async function handleOAuthCallback(code: string, state: string, skipStateValidation = false): Promise<InstagramConnectionResult> {
    // Validate configuration before proceeding
    if (!isInstagramConfigured()) {
        return {
            success: false,
            error: 'CONFIG_ERROR',
            errorMessage: 'Instagram integration is not properly configured. Please contact support.'
        };
    }

    // Validate state token (CSRF protection) - skip if already validated by caller
    if (!skipStateValidation) {
        const stateValidation = await validateStateToken(state);
        if (!stateValidation.valid) {
            return {
                success: false,
                error: 'INVALID_STATE',
                errorMessage: 'Invalid or expired authorization request. Please try again.'
            };
        }
    }

    // Step A: Exchange code for long-lived token
    const tokenResult = await exchangeCodeForToken(code);
    if (!tokenResult) {
        return {
            success: false,
            error: 'TOKEN_EXCHANGE_FAILED',
            errorMessage: 'Failed to complete authorization. Please try again.'
        };
    }

    // Validate permissions
    const hasPermissions = await validatePermissions(tokenResult.accessToken);
    if (!hasPermissions) {
        return {
            success: false,
            error: 'PERMISSIONS_MISSING',
            errorMessage: 'Please re-authenticate and ensure all checkboxes are checked in the Facebook popup.'
        };
    }

    // Step B: Fetch managed pages
    const pages = await getUserPages(tokenResult.accessToken);
    if (pages.length === 0) {
        return {
            success: false,
            error: 'NO_PAGES_FOUND',
            errorMessage: 'Please ensure you are an Admin of a Facebook Page.'
        };
    }

    // Step C: Find Instagram Business Accounts linked to pages
    const instagramAccounts: InstagramAccount[] = [];
    const seenIgAccountIds = new Set<string>();

    for (const page of pages) {
        const igAccount = await getInstagramBusinessAccount(page.id, page.access_token);
        if (igAccount && !seenIgAccountIds.has(igAccount.id)) {
            seenIgAccountIds.add(igAccount.id);
            instagramAccounts.push(igAccount);
        }
    }

    // Step D: Logic fork
    if (instagramAccounts.length === 0) {
        return {
            success: false,
            error: 'NO_IG_ACCOUNT_FOUND',
            errorMessage: 'Your Instagram is currently a Personal account. Switch to Professional in Instagram Settings to continue.'
        };
    }

    // Calculate token expiry
    const tokenExpiresAt = new Date(Date.now() + tokenResult.expiresIn * 1000);

    // Auto-select if single account, otherwise return list for picker
    if (instagramAccounts.length === 1) {
        // Prefer page access token for Content Publishing API; fall back to user token
        const publishToken = instagramAccounts[0].pageAccessToken || tokenResult.accessToken;
        log.info({ tokenType: instagramAccounts[0].pageAccessToken ? 'page' : 'user' }, 'Using access token for publishing');
        return {
            success: true,
            account: instagramAccounts[0],
            accessToken: publishToken,
            tokenExpiresAt
        };
    }

    // Multiple accounts - return list for user selection
    return {
        success: true,
        accounts: instagramAccounts,
        accessToken: tokenResult.accessToken,
        tokenExpiresAt
    };
}

/**
 * Refresh Instagram access token
 * Should be called every 45 days (tokens expire after 60 days)
 */
export async function refreshAccessToken(encryptedToken: string): Promise<{ accessToken: string; expiresAt: Date } | null> {
    const { appId, appSecret } = getInstagramConfig();
    try {
        const currentToken = decrypt(encryptedToken);
        if (!currentToken) {
            log.error('Failed to decrypt token for refresh');
            return null;
        }

        const response = await metaApi.get('/oauth/access_token', {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: appId,
                client_secret: appSecret,
                fb_exchange_token: currentToken
            }
        });

        const newToken = response.data.access_token;
        const expiresIn = response.data.expires_in || 5184000; // Default 60 days
        const expiresAt = new Date(Date.now() + expiresIn * 1000);

        return {
            accessToken: newToken,
            expiresAt
        };
    } catch (error) {
        const parsed = parseMetaApiError(error);
        log.error({ error: parsed.message, code: parsed.code, subcode: parsed.subcode, fbtraceId: parsed.fbtraceId, isRateLimit: parsed.isRateLimit }, 'Token refresh error');
        if (parsed.isRateLimit) {
            log.warn('Rate limited during token refresh - will retry later');
        }
        return null;
    }
}

/**
 * Validate if a token is still valid
 */
export async function validateToken(encryptedToken: string): Promise<boolean> {
    try {
        const token = decrypt(encryptedToken);
        if (!token) return false;

        const response = await metaApi.get('/me', {
            params: { access_token: token }
        });

        return !!response.data.id;
    } catch (error) {
        return false;
    }
}

/**
 * Get Instagram profile info
 */
export async function getInstagramProfile(encryptedToken: string, igUserId: string): Promise<any | null> {
    try {
        const token = decrypt(encryptedToken);
        if (!token) return null;

        const response = await metaApi.get(`/${igUserId}`, {
            params: {
                access_token: token,
                fields: 'id,username,name,profile_picture_url,followers_count,media_count'
            }
        });

        return response.data;
    } catch (error) {
        const parsed = parseMetaApiError(error);
        log.error({ error: parsed.message, code: parsed.code, subcode: parsed.subcode, fbtraceId: parsed.fbtraceId }, 'Get profile error');
        return null;
    }
}

/**
 * Prepare credentials for storage (encrypt token)
 */
export function prepareCredentialsForStorage(
    account: InstagramAccount,
    accessToken: string,
    tokenExpiresAt: Date
): StoredInstagramCredentials {
    return {
        userId: account.id,
        username: account.username,
        pageId: account.pageId,
        pageName: account.pageName,
        accessToken: encrypt(accessToken),
        tokenExpiresAt,
        scopes: OAUTH_SCOPES.split(','),
        connectedAt: new Date(),
        lastRefreshedAt: undefined
    };
}

/**
 * Check if Instagram integration is properly configured
 */
export function isInstagramConfigured(): boolean {
    const { appId, appSecret, redirectUri } = getInstagramConfig();
    return !!(appId && appSecret && redirectUri);
}
