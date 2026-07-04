/**
 * Instagram Integration Routes
 * Handles OAuth flow, connection management, token operations,
 * and Facebook callbacks (deauthorize, data deletion)
 */

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import {
    generateOAuthUrl,
    handleOAuthCallback,
    validateStateToken,
    prepareCredentialsForStorage,
    validateToken,
    getInstagramProfile,
    isInstagramConfigured,
    InstagramAccount,
    decrypt,
    encrypt,
    checkAndRefreshTokenIfNeeded
} from '@restropulse/publishing';
import { getRestaurantsCollection, getOauthSessionsCollection, getDataDeletionAuditsCollection, toObjectId } from '@restropulse/db';
import { createLogger } from '@restropulse/telemetry/server';
import { handle } from '../middleware/async-handler.js';

const log = createLogger('integrations');

const router = express.Router();

// App Secret for signature verification
const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET || '';

/**
 * Verify Facebook signed request
 * Used by deauthorize and data deletion callbacks
 */
function verifySignedRequest(signedRequest: string): { userId: string } | null {
    try {
        const [encodedSig, payload] = signedRequest.split('.');

        if (!encodedSig || !payload) {
            return null;
        }

        // Decode the payload
        const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));

        // Verify signature
        const expectedSig = crypto
            .createHmac('sha256', INSTAGRAM_APP_SECRET)
            .update(payload)
            .digest('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        if (encodedSig !== expectedSig) {
            log.error('Signed request signature verification failed');
            return null;
        }

        return { userId: data.user_id };
    } catch (error) {
        log.error({ err: error }, 'Error parsing signed request');
        return null;
    }
}

// ============================================
// OAuth Flow
// ============================================

/**
 * GET /api/integrations/instagram/oauth-url
 * Generate OAuth URL for Instagram connection
 * Query params:
 *   - restaurantId: required
 *   - onboarding: optional, set to 'true' for guided IG_API_ONBOARDING flow
 */
router.get('/instagram/oauth-url', handle(async (req: Request, res: Response) => {
    try {
        const restaurantId = req.query.restaurantId as string;
        const useOnboarding = req.query.onboarding === 'true';

        if (!restaurantId) {
            return res.status(400).json({
                success: false,
                error: 'Restaurant ID required'
            });
        }

        if (!isInstagramConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Instagram integration is not configured. Please contact support.'
            });
        }

        const { url, state } = await generateOAuthUrl(restaurantId, useOnboarding);

        res.json({
            success: true,
            data: {
                oauthUrl: url,
                state: state
            }
        });
    } catch (error) {
        log.error({ err: error }, 'OAuth URL generation error');
        res.status(500).json({
            success: false,
            error: 'Failed to generate authorization URL'
        });
    }
}));

/**
 * GET /api/integrations/instagram/callback
 * OAuth callback handler - processes authorization code (redirect flow)
 */
router.get('/instagram/callback', handle(async (req: Request, res: Response) => {
    const { code, state, error: oauthError, error_description } = req.query;

    const frontendCallbackUrl = process.env.FRONTEND_URL!;

    // Handle OAuth errors
    if (oauthError) {
        log.error({ oauthError, error_description }, 'OAuth error from provider');
        return res.redirect(`${frontendCallbackUrl}/auth/instagram/callback?error=oauth_denied&message=${encodeURIComponent(String(error_description || 'Authorization denied'))}`);
    }

    if (!code || !state) {
        return res.redirect(`${frontendCallbackUrl}/auth/instagram/callback?error=missing_params&message=${encodeURIComponent('Missing authorization code or state')}`);
    }

    try {
        // Validate state first to get restaurant ID
        const stateValidation = await validateStateToken(String(state));
        if (!stateValidation.valid || !stateValidation.restaurantId) {
            log.debug('Invalid state token');
            return res.redirect(`${frontendCallbackUrl}/auth/instagram/callback?error=invalid_state&message=${encodeURIComponent('Invalid or expired authorization request. Please try again.')}`);
        }

        const restaurantId = stateValidation.restaurantId;
        log.debug({ restaurantId }, 'OAuth callback processing');

        // Process OAuth callback (skip state validation since we already did it above)
        const result = await handleOAuthCallback(String(code), String(state), true);
        log.debug({
            success: result.success,
            error: result.error,
            hasAccount: !!result.account,
            hasAccounts: !!result.accounts,
            accountsCount: result.accounts?.length
        }, 'OAuth callback result');

        if (!result.success) {
            log.debug({ error: result.error, errorMessage: result.errorMessage }, 'OAuth failed');
            return res.redirect(`${frontendCallbackUrl}/auth/instagram/callback?error=${result.error}&message=${encodeURIComponent(result.errorMessage || 'Connection failed')}`);
        }

        // Single account - auto-connect
        if (result.account && result.accessToken) {
            const credentials = prepareCredentialsForStorage(
                result.account,
                result.accessToken,
                result.tokenExpiresAt!
            );

            // Save to database
            log.debug({ restaurantId }, 'Saving Instagram credentials');
            const col = getRestaurantsCollection();
            const updateResult = await col.updateOne(
                { _id: toObjectId(restaurantId) as any },
                {
                    $set: {
                        'integrations.instagram': true,
                        instagramCredentials: credentials,
                        updatedAt: new Date()
                    }
                }
            );
            log.debug({ matchedCount: updateResult.matchedCount, modifiedCount: updateResult.modifiedCount }, 'Credentials update result');
            if (updateResult.matchedCount === 0) {
                log.error({ restaurantId }, 'Instagram credentials save failed: restaurant not found');
            }

            return res.redirect(`${frontendCallbackUrl}/auth/instagram/callback?success=true&username=${encodeURIComponent(result.account.username)}`);
        }

        // Multiple accounts - store for selection
        if (result.accounts && result.accounts.length > 1) {
            const selectionId = crypto.randomBytes(16).toString('hex');
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
            const col = getOauthSessionsCollection();
            await col.insertOne({
                type: 'pending_selection',
                sessionId: selectionId,
                accounts: result.accounts,
                accessToken: result.accessToken!,
                tokenExpiresAt: result.tokenExpiresAt!,
                restaurantId,
                expiresAt
            });

            return res.redirect(`${frontendCallbackUrl}/auth/instagram/callback?select=true&selectionId=${selectionId}`);
        }

        // Shouldn't reach here
        return res.redirect(`${frontendCallbackUrl}/auth/instagram/callback?error=unknown&message=${encodeURIComponent('Unexpected error occurred')}`);
    } catch (error) {
        log.error({ err: error }, 'OAuth callback error');
        return res.redirect(`${frontendCallbackUrl}/auth/instagram/callback?error=server_error&message=${encodeURIComponent('Server error during authorization')}`);
    }
}));

/**
 * POST /api/integrations/instagram/callback
 * Alternative callback for popup-based flow
 */
router.post('/instagram/callback', handle(async (req: Request, res: Response) => {
    const { code, state } = req.body;

    if (!code || !state) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_PARAMS',
            message: 'Missing authorization code or state'
        });
    }

    try {
        const result = await handleOAuthCallback(code, state);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error,
                message: result.errorMessage
            });
        }

        // Single account - return for auto-connect
        if (result.account) {
            return res.json({
                success: true,
                data: {
                    account: result.account,
                    requiresSelection: false
                }
            });
        }

        // Multiple accounts - store and return selection ID
        if (result.accounts && result.accounts.length > 1) {
            const selectionId = crypto.randomBytes(16).toString('hex');
            const stateData = await validateStateToken(state);
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

            const col = getOauthSessionsCollection();
            await col.insertOne({
                type: 'pending_selection',
                sessionId: selectionId,
                accounts: result.accounts,
                accessToken: result.accessToken!,
                tokenExpiresAt: result.tokenExpiresAt!,
                restaurantId: stateData.restaurantId || '',
                expiresAt
            });

            return res.json({
                success: true,
                data: {
                    accounts: result.accounts.map((a: InstagramAccount) => ({
                        id: a.id,
                        username: a.username,
                        name: a.name,
                        profilePictureUrl: a.profilePictureUrl,
                        pageName: a.pageName
                    })),
                    selectionId,
                    requiresSelection: true
                }
            });
        }

        return res.status(500).json({
            success: false,
            error: 'UNKNOWN_ERROR',
            message: 'Unexpected error occurred'
        });
    } catch (error) {
        log.error({ err: error }, 'OAuth callback error');
        return res.status(500).json({
            success: false,
            error: 'SERVER_ERROR',
            message: 'Server error during authorization'
        });
    }
}));

/**
 * GET /api/integrations/instagram/pending-accounts/:selectionId
 * Get pending account selections
 */
router.get('/instagram/pending-accounts/:selectionId', handle(async (req: Request, res: Response) => {
    const { selectionId } = req.params;

    const col = getOauthSessionsCollection();
    const pending = await col.findOne({ type: 'pending_selection', sessionId: selectionId }) as any;

    if (!pending) {
        return res.status(404).json({
            success: false,
            error: 'Selection expired or not found'
        });
    }

    res.json({
        success: true,
        data: {
            accounts: pending.accounts.map((a: InstagramAccount) => ({
                id: a.id,
                username: a.username,
                name: a.name,
                profilePictureUrl: a.profilePictureUrl,
                pageName: a.pageName
            }))
        }
    });
}));

/**
 * POST /api/integrations/instagram/select-account
 * Select account from multiple accounts
 */
router.post('/instagram/select-account', handle(async (req: Request, res: Response) => {
    const { selectionId, accountId, restaurantId } = req.body;

    if (!selectionId || !accountId) {
        return res.status(400).json({
            success: false,
            error: 'Selection ID and account ID required'
        });
    }

    const col = getOauthSessionsCollection();
    const pending = await col.findOne({ type: 'pending_selection', sessionId: selectionId }) as any;

    if (!pending) {
        return res.status(404).json({
            success: false,
            error: 'Selection expired or not found. Please reconnect Instagram.'
        });
    }

    // Use restaurantId from pending session or from request body
    const targetRestaurantId = pending.restaurantId || restaurantId;

    if (!targetRestaurantId) {
        return res.status(400).json({
            success: false,
            error: 'Restaurant ID required'
        });
    }

    const selectedAccount = pending.accounts.find((a: InstagramAccount) => a.id === accountId);

    if (!selectedAccount) {
        return res.status(400).json({
            success: false,
            error: 'Invalid account selection'
        });
    }

    try {
        // Prefer page access token for Content Publishing API; fall back to user token
        const publishToken = selectedAccount.pageAccessToken || pending.accessToken;
        log.debug({ tokenType: selectedAccount.pageAccessToken ? 'page' : 'user' }, 'select-account: token type');

        const credentials = prepareCredentialsForStorage(
            selectedAccount,
            publishToken,
            pending.tokenExpiresAt
        );

        // Save to database
        log.debug({ restaurantId: targetRestaurantId }, 'select-account: saving Instagram credentials');
        const restaurantsCol = getRestaurantsCollection();
        const updateResult = await restaurantsCol.updateOne(
            { _id: toObjectId(targetRestaurantId) as any },
            {
                $set: {
                    'integrations.instagram': true,
                    instagramCredentials: credentials,
                    updatedAt: new Date()
                }
            }
        );
        log.debug({ matchedCount: updateResult.matchedCount, modifiedCount: updateResult.modifiedCount }, 'select-account: update result');

        // Clean up pending selection
        await col.deleteOne({ type: 'pending_selection', sessionId: selectionId });

        res.json({
            success: true,
            data: {
                username: selectedAccount.username,
                message: `Successfully connected to @${selectedAccount.username}!`
            }
        });
    } catch (error) {
        log.error({ err: error }, 'Account selection error');
        res.status(500).json({
            success: false,
            error: 'Failed to save Instagram connection'
        });
    }
}));

// ============================================
// Connection Management
// ============================================

/**
 * DELETE /api/integrations/instagram/disconnect/:restaurantId
 * Disconnect Instagram account
 */
router.delete('/instagram/disconnect/:restaurantId', handle(async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    try {
        const col = getRestaurantsCollection();
        const result = await col.updateOne(
            { _id: toObjectId(restaurantId) as any },
            {
                $set: {
                    'integrations.instagram': false,
                    updatedAt: new Date()
                },
                $unset: {
                    instagramCredentials: ''
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Restaurant not found'
            });
        }

        res.json({
            success: true,
            message: 'Instagram disconnected successfully'
        });
    } catch (error) {
        log.error({ err: error }, 'Disconnect error');
        res.status(500).json({
            success: false,
            error: 'Failed to disconnect Instagram'
        });
    }
}));

/**
 * GET /api/integrations/instagram/status/:restaurantId
 * Get Instagram connection status (without sensitive token data)
 */
router.get('/instagram/status/:restaurantId', handle(async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    try {
        const col = getRestaurantsCollection();
        const restaurant = await col.findOne({ _id: toObjectId(restaurantId) as any });

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                error: 'Restaurant not found'
            });
        }

        const credentials = restaurant.instagramCredentials;

        if (!credentials || !restaurant.integrations?.instagram) {
            return res.json({
                success: true,
                data: {
                    connected: false
                }
            });
        }

        // Check if token needs refresh
        const tokenExpiresAt = new Date(credentials.tokenExpiresAt);
        const isExpiringSoon = tokenExpiresAt < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const isExpired = tokenExpiresAt < new Date();

        res.json({
            success: true,
            data: {
                connected: true,
                username: credentials.username,
                userId: credentials.userId,
                pageName: credentials.pageName,
                connectedAt: credentials.connectedAt,
                lastRefreshedAt: credentials.lastRefreshedAt,
                tokenExpiresAt: credentials.tokenExpiresAt,
                tokenStatus: isExpired ? 'expired' : isExpiringSoon ? 'expiring_soon' : 'valid',
                needsReauthorization: isExpired
            }
        });
    } catch (error) {
        log.error({ err: error }, 'Status check error');
        res.status(500).json({
            success: false,
            error: 'Failed to check connection status'
        });
    }
}));

/**
 * POST /api/integrations/instagram/refresh/:restaurantId
 * Manually trigger token refresh
 */
router.post('/instagram/refresh/:restaurantId', handle(async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    try {
        const success = await checkAndRefreshTokenIfNeeded(restaurantId);

        if (!success) {
            return res.status(400).json({
                success: false,
                error: 'Token refresh failed. Please reconnect your Instagram account.'
            });
        }

        res.json({
            success: true,
            message: 'Token refreshed successfully'
        });
    } catch (error) {
        log.error({ err: error }, 'Manual refresh error');
        res.status(500).json({
            success: false,
            error: 'Failed to refresh token'
        });
    }
}));

/**
 * POST /api/integrations/instagram/validate/:restaurantId
 * Validate Instagram connection is still working
 */
router.post('/instagram/validate/:restaurantId', handle(async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    try {
        const col = getRestaurantsCollection();
        const restaurant = await col.findOne({ _id: toObjectId(restaurantId) as any });

        if (!restaurant?.instagramCredentials?.accessToken) {
            return res.status(400).json({
                success: false,
                error: 'No Instagram connection found'
            });
        }

        const isValid = await validateToken(restaurant.instagramCredentials.accessToken);

        if (!isValid) {
            // Mark as needing reauthorization
            await col.updateOne(
                { _id: toObjectId(restaurantId) as any },
                {
                    $set: {
                        'integrations.instagram': false,
                        updatedAt: new Date()
                    }
                }
            );

            return res.json({
                success: true,
                data: {
                    valid: false,
                    needsReauthorization: true,
                    message: 'Instagram connection has expired. Please reconnect.'
                }
            });
        }

        res.json({
            success: true,
            data: {
                valid: true,
                needsReauthorization: false
            }
        });
    } catch (error) {
        log.error({ err: error }, 'Validation error');
        res.status(500).json({
            success: false,
            error: 'Failed to validate connection'
        });
    }
}));

/**
 * GET /api/integrations/instagram/profile/:restaurantId
 * Get Instagram profile info for connected account
 */
router.get('/instagram/profile/:restaurantId', handle(async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    try {
        // Ensure token is fresh
        await checkAndRefreshTokenIfNeeded(restaurantId);

        const col = getRestaurantsCollection();
        const restaurant = await col.findOne({ _id: toObjectId(restaurantId) as any });

        if (!restaurant?.instagramCredentials) {
            return res.status(400).json({
                success: false,
                error: 'No Instagram connection found'
            });
        }

        const profile = await getInstagramProfile(
            restaurant.instagramCredentials.accessToken,
            restaurant.instagramCredentials.userId
        );

        if (!profile) {
            return res.status(400).json({
                success: false,
                error: 'Failed to fetch Instagram profile'
            });
        }

        res.json({
            success: true,
            data: profile
        });
    } catch (error) {
        log.error({ err: error }, 'Profile fetch error');
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
}));

// ============================================
// Facebook Callbacks (Deauthorize & Data Deletion)
// ============================================

/**
 * POST /api/integrations/instagram/deauthorize
 * Called by Facebook when a user removes the app
 */
router.post('/instagram/deauthorize', handle(async (req: Request, res: Response) => {
    log.info('Instagram deauthorize callback received');

    const { signed_request } = req.body;

    if (!signed_request) {
        log.error('Instagram deauthorize: missing signed_request');
        return res.status(400).json({ error: 'Missing signed_request' });
    }

    const userData = verifySignedRequest(signed_request);

    if (!userData) {
        log.error('Instagram deauthorize: invalid signed_request');
        return res.status(400).json({ error: 'Invalid signed_request' });
    }

    try {
        log.info({ userId: userData.userId }, 'User deauthorized the app');

        // Find and update restaurants with this Instagram user ID
        const col = getRestaurantsCollection();
        const result = await col.updateMany(
            { 'instagramCredentials.userId': userData.userId },
            {
                $set: {
                    'integrations.instagram': false,
                    'instagramCredentials.accessToken': null,
                    'instagramCredentials.deauthorizedAt': new Date(),
                    updatedAt: new Date()
                }
            }
        );

        log.info({ modifiedCount: result.modifiedCount }, 'Deauthorize: updated restaurants');

        // Facebook expects a 200 response
        res.status(200).json({ success: true });
    } catch (error) {
        log.error({ err: error }, 'Instagram deauthorize error');
        // Still return 200 to acknowledge receipt
        res.status(200).json({ success: true });
    }
}));

/**
 * POST /api/integrations/instagram/data-deletion
 * GDPR Data Deletion Request Callback
 */
router.post('/instagram/data-deletion', handle(async (req: Request, res: Response) => {
    log.info('Instagram data deletion request received');

    const { signed_request } = req.body;

    if (!signed_request) {
        log.error('Instagram data deletion: missing signed_request');
        return res.status(400).json({ error: 'Missing signed_request' });
    }

    const userData = verifySignedRequest(signed_request);

    if (!userData) {
        log.error('Instagram data deletion: invalid signed_request');
        return res.status(400).json({ error: 'Invalid signed_request' });
    }

    try {
        log.info({ userId: userData.userId }, 'Processing data deletion request');

        // Generate a confirmation code
        const confirmationCode = crypto.randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

        // Store the deletion request in DB
        const auditsCol = getDataDeletionAuditsCollection();
        await auditsCol.insertOne({
            confirmationCode,
            userId: userData.userId,
            requestedAt: new Date(),
            status: 'pending',
            expiresAt
        });

        // Delete user data from database
        const col = getRestaurantsCollection();
        const result = await col.updateMany(
            { 'instagramCredentials.userId': userData.userId },
            {
                $unset: {
                    instagramCredentials: ''
                },
                $set: {
                    'integrations.instagram': false,
                    updatedAt: new Date()
                }
            }
        );

        log.info({ modifiedCount: result.modifiedCount }, 'Data deletion: removed data from restaurants');

        // Update deletion request status
        await auditsCol.updateOne(
            { confirmationCode },
            { $set: { status: 'completed' } }
        );

        // Build the status URL
        const baseUrl = process.env.BACKEND_URL!;
        const statusUrl = `${baseUrl}/api/integrations/instagram/data-deletion-status?code=${confirmationCode}`;

        // Facebook expects this specific response format
        res.status(200).json({
            url: statusUrl,
            confirmation_code: confirmationCode
        });
    } catch (error) {
        log.error({ err: error }, 'Instagram data deletion error');
        res.status(500).json({ error: 'Failed to process deletion request' });
    }
}));

/**
 * GET /api/integrations/instagram/data-deletion-status
 * Check status of a data deletion request
 */
router.get('/instagram/data-deletion-status', handle(async (req: Request, res: Response) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send(`
            <html>
                <head><title>Data Deletion Status</title></head>
                <body>
                    <h1>Invalid Request</h1>
                    <p>Missing confirmation code.</p>
                </body>
            </html>
        `);
    }

    const auditsCol = getDataDeletionAuditsCollection();
    const request = await auditsCol.findOne({ confirmationCode: String(code) }) as any;

    if (!request) {
        return res.status(404).send(`
            <html>
                <head><title>Data Deletion Status</title></head>
                <body>
                    <h1>Request Not Found</h1>
                    <p>The deletion request with this confirmation code was not found or has expired.</p>
                </body>
            </html>
        `);
    }

    const statusText = request.status === 'completed' ? 'Completed' : 'In Progress';
    const statusColor = request.status === 'completed' ? 'green' : 'orange';

    res.status(200).send(`
        <html>
            <head>
                <title>Data Deletion Status - RestroPulse</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                    .status { color: ${statusColor}; font-weight: bold; }
                    .info { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0; }
                </style>
            </head>
            <body>
                <h1>Data Deletion Request Status</h1>
                <div class="info">
                    <p><strong>Confirmation Code:</strong> ${request.confirmationCode}</p>
                    <p><strong>Status:</strong> <span class="status">${statusText}</span></p>
                    <p><strong>Requested At:</strong> ${request.requestedAt.toISOString()}</p>
                </div>
                <p>Your Instagram data associated with RestroPulse has been ${request.status === 'completed' ? 'deleted' : 'scheduled for deletion'}.</p>
                <p>If you have any questions, please contact support.</p>
            </body>
        </html>
    `);
}));

// ============================================
// Debug (Development Only)
// ============================================

/**
 * GET /api/integrations/instagram/debug-token/:restaurantId
 * Debug the stored token to check scopes and permissions (dev only)
 */
router.get('/instagram/debug-token/:restaurantId', handle(async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not available' });
    }

    const { restaurantId } = req.params;

    try {
        const col = getRestaurantsCollection();
        const restaurant = await col.findOne({ _id: toObjectId(restaurantId) as any });

        if (!restaurant?.instagramCredentials?.accessToken) {
            return res.status(400).json({ success: false, error: 'No credentials found' });
        }

        const token = decrypt(restaurant.instagramCredentials.accessToken);
        if (!token) {
            return res.status(500).json({ success: false, error: 'Failed to decrypt token' });
        }

        const appId = process.env.INSTAGRAM_APP_ID || '';
        const appSecret = process.env.INSTAGRAM_APP_SECRET || '';

        // Call Meta debug_token API
        const axios = (await import('axios')).default;
        const debugRes = await axios.get(`https://graph.facebook.com/v18.0/debug_token`, {
            params: {
                input_token: token,
                access_token: `${appId}|${appSecret}`
            }
        });

        const debugData = debugRes.data.data;

        // Also try /me to see who the token belongs to
        let meData = null;
        try {
            const meRes = await axios.get(`https://graph.facebook.com/v18.0/me`, {
                params: { access_token: token, fields: 'id,name,email' }
            });
            meData = meRes.data;
        } catch (err: any) {
            meData = { error: err.response?.data?.error?.message || err.message };
        }

        res.json({
            success: true,
            data: {
                storedCredentials: {
                    userId: restaurant.instagramCredentials.userId,
                    pageId: restaurant.instagramCredentials.pageId,
                    username: restaurant.instagramCredentials.username,
                    scopes: restaurant.instagramCredentials.scopes,
                    connectedAt: restaurant.instagramCredentials.connectedAt,
                    tokenExpiresAt: restaurant.instagramCredentials.tokenExpiresAt,
                },
                tokenDebug: {
                    appId: debugData.app_id,
                    userId: debugData.user_id,
                    type: debugData.type,
                    isValid: debugData.is_valid,
                    expiresAt: debugData.expires_at ? new Date(debugData.expires_at * 1000).toISOString() : 'never',
                    scopes: debugData.scopes,
                    granularScopes: debugData.granular_scopes,
                },
                me: meData
            }
        });
    } catch (error: any) {
        log.error({ err: error.response?.data || error.message }, 'Debug token error');
        res.status(500).json({
            success: false,
            error: error.response?.data?.error?.message || error.message
        });
    }
}));

/**
 * POST /api/integrations/instagram/migrate-to-page-token/:restaurantId
 * One-time migration: convert stored User Access Token to Page Access Token.
 * Dev only.
 */
router.post('/instagram/migrate-to-page-token/:restaurantId', handle(async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not available' });
    }

    const { restaurantId } = req.params;

    try {
        const col = getRestaurantsCollection();
        const restaurant = await col.findOne({ _id: toObjectId(restaurantId) as any });

        if (!restaurant?.instagramCredentials?.accessToken) {
            return res.status(400).json({ success: false, error: 'No credentials found' });
        }

        const userToken = decrypt(restaurant.instagramCredentials.accessToken);
        if (!userToken) {
            return res.status(500).json({ success: false, error: 'Failed to decrypt stored token' });
        }

        const storedPageId = restaurant.instagramCredentials.pageId;
        log.info({ pageId: storedPageId }, 'Looking for page token');

        // Use the user token to get page access tokens via /me/accounts
        const axios = (await import('axios')).default;
        const pagesRes = await axios.get(`https://graph.facebook.com/v18.0/me/accounts`, {
            params: {
                access_token: userToken,
                fields: 'id,name,access_token'
            }
        });

        const pages = pagesRes.data.data || [];
        log.info({ pageCount: pages.length, pages: pages.map((p: any) => ({ id: p.id, name: p.name })) }, 'Found pages for token migration');

        // Find the page matching the stored pageId
        const matchingPage = pages.find((p: any) => p.id === storedPageId);

        if (!matchingPage) {
            log.info({ pageId: storedPageId }, 'Page not in /me/accounts, trying direct fetch');
            try {
                const directRes = await axios.get(`https://graph.facebook.com/v18.0/${storedPageId}`, {
                    params: {
                        access_token: userToken,
                        fields: 'id,name,access_token'
                    }
                });
                if (directRes.data.access_token) {
                    pages.push(directRes.data);
                }
            } catch (directErr: any) {
                log.error({ err: directErr.response?.data?.error?.message || directErr.message }, 'Direct page fetch failed');
            }
        }

        const page = pages.find((p: any) => p.id === storedPageId);

        if (!page || !page.access_token) {
            return res.status(400).json({
                success: false,
                error: `Could not get page access token for page ${storedPageId}. Found pages: ${pages.map((p: any) => p.id).join(', ') || 'none'}`
            });
        }

        const pageToken = page.access_token;

        // Verify the page token works by debugging it
        const debugRes = await axios.get(`https://graph.facebook.com/v18.0/debug_token`, {
            params: {
                input_token: pageToken,
                access_token: `${process.env.INSTAGRAM_APP_ID}|${process.env.INSTAGRAM_APP_SECRET}`
            }
        });
        const debugData = debugRes.data.data;

        log.debug({
            type: debugData.type,
            isValid: debugData.is_valid,
            scopes: debugData.scopes,
            expiresAt: debugData.expires_at
        }, 'Page token debug info');

        if (!debugData.is_valid) {
            return res.status(400).json({ success: false, error: 'Page token is not valid' });
        }

        // Update the stored token to the page token
        const encryptedPageToken = encrypt(pageToken);
        await col.updateOne(
            { _id: toObjectId(restaurantId) as any },
            {
                $set: {
                    'instagramCredentials.accessToken': encryptedPageToken,
                    'instagramCredentials.tokenMigratedAt': new Date(),
                    updatedAt: new Date()
                }
            }
        );

        log.info({ restaurantId }, 'Successfully migrated to page token');

        res.json({
            success: true,
            data: {
                message: 'Migrated from User token to Page token',
                tokenType: debugData.type,
                scopes: debugData.scopes,
                expiresAt: debugData.expires_at ? new Date(debugData.expires_at * 1000).toISOString() : 'never'
            }
        });
    } catch (error: any) {
        log.error({ err: error.response?.data || error.message }, 'Token migration error');
        res.status(500).json({
            success: false,
            error: error.response?.data?.error?.message || error.message
        });
    }
}));

// ============================================
// Configuration
// ============================================

/**
 * GET /api/integrations/config
 * Check if integrations are configured (for UI)
 */
router.get('/config', handle(async (_req: Request, res: Response) => {
    res.json({
        success: true,
        data: {
            instagram: {
                configured: isInstagramConfigured(),
                appId: process.env.INSTAGRAM_APP_ID ? 'configured' : 'not_configured'
            }
        }
    });
}));

export default router;
