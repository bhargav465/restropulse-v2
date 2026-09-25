import { User, Restaurant, Post, ContentStrategy, StrategyCycle, LoginRequest, AuthResponse, ApiResponse, InstagramConnectionStatus, InstagramAccount, InstagramConnectionError, AccountManager, City, SubscriptionPlan, Subscription, PlanUsage, CreditPack, BillingCycle, Invoice, FeatureFlags, Platform, EntitlementState } from '@restropulse/shared';
import type {
    SnapshotSource, SnapshotReview, ReviewTheme, WatchlistEntry,
    IntelligenceScan, IntelligenceReport, IntelligenceReportSummary, IntelligenceSelfMetrics, CompareRow, PlaceCandidate,
    IntelligenceNotificationsResponse,
} from '@restropulse/shared';
import { intelligenceAPI as demoIntelligenceAPI } from './demo-api-intelligence';
import { isDemoMode } from './lib/demo';
import { browserEvents } from '@restropulse/telemetry/browser';
import { getApiUrl } from './utils/env';

// Resolved lazily (not at module load) since getApiUrl() now reads from the
// runtime client config, which is only populated after initClientConfig()
// resolves in index.tsx's boot sequence.

// Helper function for API calls with auto token refresh
async function fetchAPI<T>(endpoint: string, options?: RequestInit, retry = true): Promise<T> {
    const token = localStorage.getItem('rp_token');

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionStorage.getItem('ai_session') || '',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options?.headers,
    };

    const response = await fetch(`${getApiUrl()}${endpoint}`, {
        ...options,
        headers,
    });

    // If unauthorized and we have a refresh token, try to refresh
    if (response.status === 401 && retry) {
        const refreshToken = localStorage.getItem('rp_refresh_token');
        if (refreshToken) {
            const refreshed = await authAPI.refreshToken(refreshToken);
            if (refreshed) {
                // Retry the original request with new token
                return fetchAPI<T>(endpoint, options, false);
            }
        }
        // Clear tokens if refresh failed
        localStorage.removeItem('rp_token');
        localStorage.removeItem('rp_refresh_token');
        localStorage.removeItem('rp_session');
    }

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        browserEvents.networkError(endpoint, String(response.status));
        throw new Error(errorBody.message || errorBody.error || `HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * Fetches a binary response (media download) with the same bearer-token auth
 * and 401-refresh-and-retry behavior as fetchAPI, but returns a Blob instead
 * of parsing JSON. Used for authenticated file downloads, since a plain
 * <a href> can't carry an Authorization header.
 */
async function fetchBinary(endpoint: string, retry = true): Promise<{ blob: Blob; filename: string }> {
    const token = localStorage.getItem('rp_token');
    const response = await fetch(`${getApiUrl()}${endpoint}`, {
        headers: {
            ...(token && { Authorization: `Bearer ${token}` }),
        },
    });
    if (response.status === 401 && retry) {
        const refreshToken = localStorage.getItem('rp_refresh_token');
        if (refreshToken) {
            const refreshed = await authAPI.refreshToken(refreshToken);
            if (refreshed) {
                return fetchBinary(endpoint, false);
            }
        }
        localStorage.removeItem('rp_token');
        localStorage.removeItem('rp_refresh_token');
        localStorage.removeItem('rp_session');
    }
    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        browserEvents.networkError(endpoint, String(response.status));
        throw new Error(errorBody.message || errorBody.error || `HTTP ${response.status}`);
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : 'download';
    const blob = await response.blob();
    return { blob, filename };
}

// Authentication API
export const authAPI = {
    // Firebase Authentication (Primary - Production)
    loginWithFirebase: async (firebaseIdToken: string): Promise<AuthResponse & { refreshToken?: string }> => {
        const response = await fetchAPI<AuthResponse & { refreshToken?: string }>('/auth/firebase', {
            method: 'POST',
            body: JSON.stringify({ idToken: firebaseIdToken }),
        }, false);

        if (response.success && response.token) {
            localStorage.setItem('rp_token', response.token);
            if (response.refreshToken) {
                localStorage.setItem('rp_refresh_token', response.refreshToken);
            }
            if (response.user?.restaurantId) {
                localStorage.setItem('rp_restaurant_id', response.user.restaurantId);
            } else {
                localStorage.removeItem('rp_restaurant_id');
            }
        }

        return response;
    },

    // Legacy email/password login
    login: async (credentials: LoginRequest): Promise<AuthResponse> => {
        const response = await fetchAPI<AuthResponse>('/auth/login', {
            method: 'POST',
            body: JSON.stringify(credentials),
        }, false);

        if (response.success && response.token) {
            localStorage.setItem('rp_token', response.token);
        }

        return response;
    },

    // Backend OTP request (dev fallback). In non-production the API echoes the
    // code back as `devOtp`, which is what makes local auto-login possible.
    sendOtp: async (phone: string): Promise<{ success: boolean; message?: string; devOtp?: string }> => {
        return fetchAPI<{ success: boolean; message?: string; devOtp?: string }>('/auth/send-otp', {
            method: 'POST',
            body: JSON.stringify({ phone }),
        }, false);
    },

    // Fallback OTP verification (when Firebase not configured)
    verifyOtp: async (phone: string, otp: string): Promise<AuthResponse & { refreshToken?: string }> => {
        const response = await fetchAPI<AuthResponse & { refreshToken?: string }>('/auth/verify-otp', {
            method: 'POST',
            body: JSON.stringify({ phone, otp }),
        }, false);

        if (response.success && response.token) {
            localStorage.setItem('rp_token', response.token);
            if (response.refreshToken) {
                localStorage.setItem('rp_refresh_token', response.refreshToken);
            }
            if (response.user?.restaurantId) {
                localStorage.setItem('rp_restaurant_id', response.user.restaurantId);
            } else {
                localStorage.removeItem('rp_restaurant_id');
            }
        }

        return response;
    },

    refreshToken: async (refreshToken: string): Promise<boolean> => {
        try {
            const response = await fetch(`${getApiUrl()}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
            });

            if (!response.ok) return false;

            const data = await response.json();
            if (data.success && data.token) {
                localStorage.setItem('rp_token', data.token);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    },

    logout: async (): Promise<void> => {
        await fetchAPI('/auth/logout', { method: 'POST' }, false);
        localStorage.removeItem('rp_token');
        localStorage.removeItem('rp_refresh_token');
        localStorage.removeItem('rp_session');
        localStorage.removeItem('rp_restaurant_id');
    },

    checkSession: async (): Promise<AuthResponse> => {
        return fetchAPI<AuthResponse>('/auth/session');
    },

    verifyEmail: async (idToken: string): Promise<void> => {
        await fetchAPI('/auth/verify-email', {
            method: 'POST',
            body: JSON.stringify({ idToken }),
        });
    },
    // Dev-only: the API accepts `devEmail` outside production and marks the
    // email verified without Firebase (the email-link flow needs a real Firebase
    // project and does not work on localhost).
    verifyEmailDev: async (devEmail: string): Promise<void> => {
        await fetchAPI('/auth/verify-email', {
            method: 'POST',
            body: JSON.stringify({ devEmail }),
        });
    },
};

// Restaurant API
export const restaurantAPI = {
    create: async (data: {
        name: string;
        cuisine: string;
        userName?: string;
        email?: string;
        location?: Restaurant['location'];
        sourceCity?: string;
        accountManager?: Restaurant['accountManager'];
    }): Promise<{ restaurant: Restaurant; token: string; refreshToken: string }> => {
        const response = await fetchAPI<ApiResponse<{ restaurant: Restaurant; token: string; refreshToken: string }>>('/restaurant', {
            method: 'POST',
            body: JSON.stringify(data),
        });
        return response.data!;
    },

    get: async (id: string): Promise<Restaurant> => {
        const response = await fetchAPI<ApiResponse<Restaurant>>(`/restaurant/${id}`);
        return response.data!;
    },

    update: async (id: string, data: Partial<Restaurant>): Promise<Restaurant> => {
        const response = await fetchAPI<ApiResponse<Restaurant>>(`/restaurant/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
        return response.data!;
    },

    updateOffers: async (id: string, action: 'ADD' | 'DELETE', payload: string | number): Promise<Restaurant> => {
        const response = await fetchAPI<ApiResponse<Restaurant>>(`/restaurant/${id}/offers`, {
            method: 'PATCH',
            body: JSON.stringify({ action, payload }),
        });
        return response.data!;
    },

    updateSpecials: async (id: string, action: 'ADD' | 'DELETE', payload: string | number): Promise<Restaurant> => {
        const response = await fetchAPI<ApiResponse<Restaurant>>(`/restaurant/${id}/specials`, {
            method: 'PATCH',
            body: JSON.stringify({ action, payload }),
        });
        return response.data!;
    },

    updateMenu: async (id: string): Promise<Restaurant> => {
        const response = await fetchAPI<ApiResponse<Restaurant>>(`/restaurant/${id}/menu`, {
            method: 'PATCH',
        });
        return response.data!;
    },

    getAnalytics: async (id: string): Promise<{
        postsPerWeek: { week: number; posts: number }[];
        contentMix: { type: string; count: number }[];
        platformMix: { platform: string; count: number }[];
    }> => {
        const response = await fetchAPI<ApiResponse<{
            postsPerWeek: { week: number; posts: number }[];
            contentMix: { type: string; count: number }[];
            platformMix: { platform: string; count: number }[];
        }>>(`/restaurant/${id}/analytics`);
        return response.data!;
    },
};

// Posts API
export const postsAPI = {
    getAll: async (): Promise<Post[]> => {
        const response = await fetchAPI<ApiResponse<Post[]>>('/posts');
        return response.data!;
    },

    getById: async (id: string): Promise<Post> => {
        const response = await fetchAPI<ApiResponse<Post>>(`/posts/${id}`);
        return response.data!;
    },

    // A request may target multiple platforms; the API fans it out into one
    // single-platform Post per platform, sharing a groupId.
    create: async (post: Omit<Post, 'id' | 'platform'> & { platforms: Platform[] }): Promise<Post[]> => {
        const response = await fetchAPI<ApiResponse<Post[]>>('/posts', {
            method: 'POST',
            body: JSON.stringify(post),
        });
        return response.data!;
    },

    // Generate post(s) with AI-created content -- one per requested platform.
    generate: async (params: {
        concept: string;
        type: Post['type'];
        platforms: Platform[];
        scheduledFor?: string;
        asap?: boolean;
    }): Promise<Post[]> => {
        const response = await fetchAPI<ApiResponse<Post[]>>('/posts/generate', {
            method: 'POST',
            body: JSON.stringify(params),
        });
        return response.data!;
    },

    update: async (id: string, post: Partial<Post>): Promise<Post> => {
        const response = await fetchAPI<ApiResponse<Post>>(`/posts/${id}`, {
            method: 'PUT',
            body: JSON.stringify(post),
        });
        return response.data!;
    },

    publish: async (id: string): Promise<Post> => {
        const response = await fetchAPI<ApiResponse<Post>>(`/posts/${id}/publish`, {
            method: 'POST',
        });
        return response.data!;
    },

    delete: async (id: string): Promise<void> => {
        await fetchAPI(`/posts/${id}`, { method: 'DELETE' });
    },

    // Downloads a post's media (image/video). index selects a CAROUSEL slide;
    // ignored for single-media posts. Triggers the browser's save dialog.
    downloadMedia: async (id: string, index?: number): Promise<void> => {
        const query = index !== undefined ? `?index=${index}` : '';
        const { blob, filename } = await fetchBinary(`/posts/${id}/media/download${query}`);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },
};

// Strategy API
export const strategyAPI = {
    getStrategy: async (): Promise<ContentStrategy & { suggestCreateCycle?: boolean }> => {
        const response = await fetchAPI<ApiResponse<ContentStrategy & { suggestCreateCycle?: boolean }>>('/strategy');
        return response.data!;
    },

    updateStrategy: async (strategy: Partial<ContentStrategy>): Promise<ContentStrategy> => {
        const response = await fetchAPI<ApiResponse<ContentStrategy>>('/strategy', {
            method: 'PUT',
            body: JSON.stringify(strategy),
        });
        return response.data!;
    },

    getAllCycles: async (): Promise<StrategyCycle[]> => {
        const response = await fetchAPI<ApiResponse<StrategyCycle[]>>('/strategy/cycles');
        return response.data!;
    },

    getCycleById: async (id: string): Promise<StrategyCycle> => {
        const response = await fetchAPI<ApiResponse<StrategyCycle>>(`/strategy/cycles/${id}`);
        return response.data!;
    },

    createCycle: async (cycle: Omit<StrategyCycle, 'id'>): Promise<StrategyCycle> => {
        const response = await fetchAPI<ApiResponse<StrategyCycle>>('/strategy/cycles', {
            method: 'POST',
            body: JSON.stringify(cycle),
        });
        return response.data!;
    },

    updateCycle: async (id: string, cycle: Partial<StrategyCycle>): Promise<StrategyCycle> => {
        const response = await fetchAPI<ApiResponse<StrategyCycle>>(`/strategy/cycles/${id}`, {
            method: 'PUT',
            body: JSON.stringify(cycle),
        });
        return response.data!;
    },
};

// Instagram Integration API
export const instagramAPI = {
    // Get OAuth URL to initiate connection
    // useOnboarding: true for guided setup (new users), false for standard OAuth (existing setup)
    getOAuthUrl: async (restaurantId: string, useOnboarding: boolean = false): Promise<{ oauthUrl: string; state: string }> => {
        const response = await fetchAPI<ApiResponse<{ oauthUrl: string; state: string }>>(
            `/integrations/instagram/oauth-url?restaurantId=${restaurantId}&onboarding=${useOnboarding}`
        );
        return response.data!;
    },

    // Complete OAuth callback (for popup flow)
    handleCallback: async (code: string, state: string): Promise<{
        success: boolean;
        account?: InstagramAccount;
        accounts?: InstagramAccount[];
        selectionId?: string;
        requiresSelection?: boolean;
        error?: InstagramConnectionError;
        message?: string;
    }> => {
        const response = await fetchAPI<ApiResponse<{
            account?: InstagramAccount;
            accounts?: InstagramAccount[];
            selectionId?: string;
            requiresSelection?: boolean;
        }> & { error?: InstagramConnectionError; message?: string }>('/integrations/instagram/callback', {
            method: 'POST',
            body: JSON.stringify({ code, state }),
        }, false);

        return {
            success: response.success,
            account: response.data?.account,
            accounts: response.data?.accounts,
            selectionId: response.data?.selectionId,
            requiresSelection: response.data?.requiresSelection,
            error: response.error as InstagramConnectionError,
            message: response.message
        };
    },

    // Get pending accounts for selection
    getPendingAccounts: async (selectionId: string): Promise<InstagramAccount[]> => {
        const response = await fetchAPI<ApiResponse<{ accounts: InstagramAccount[] }>>(
            `/integrations/instagram/pending-accounts/${selectionId}`
        );
        return response.data!.accounts;
    },

    // Select account to complete connection
    selectAccount: async (selectionId: string, accountId: string, restaurantId: string): Promise<{ username: string; message: string }> => {
        const response = await fetchAPI<ApiResponse<{ username: string; message: string }>>(
            '/integrations/instagram/select-account',
            {
                method: 'POST',
                body: JSON.stringify({ selectionId, accountId, restaurantId }),
            }
        );
        return response.data!;
    },

    // Get connection status
    getStatus: async (restaurantId: string): Promise<InstagramConnectionStatus> => {
        const response = await fetchAPI<ApiResponse<InstagramConnectionStatus>>(
            `/integrations/instagram/status/${restaurantId}`
        );
        return response.data!;
    },

    // Disconnect Instagram
    disconnect: async (restaurantId: string): Promise<void> => {
        await fetchAPI(`/integrations/instagram/disconnect/${restaurantId}`, {
            method: 'DELETE',
        });
    },

    // Refresh token manually
    refreshToken: async (restaurantId: string): Promise<boolean> => {
        try {
            await fetchAPI(`/integrations/instagram/refresh/${restaurantId}`, {
                method: 'POST',
            });
            return true;
        } catch {
            return false;
        }
    },

    // Validate connection
    validate: async (restaurantId: string): Promise<{ valid: boolean; needsReauthorization: boolean }> => {
        const response = await fetchAPI<ApiResponse<{ valid: boolean; needsReauthorization: boolean }>>(
            `/integrations/instagram/validate/${restaurantId}`,
            { method: 'POST' }
        );
        return response.data!;
    },

    // Get Instagram profile
    getProfile: async (restaurantId: string): Promise<any> => {
        const response = await fetchAPI<ApiResponse<any>>(
            `/integrations/instagram/profile/${restaurantId}`
        );
        return response.data;
    },

    // Check if integration is configured
    getConfig: async (): Promise<{ instagram: { configured: boolean } }> => {
        const response = await fetchAPI<ApiResponse<{ instagram: { configured: boolean } }>>(
            '/integrations/config'
        );
        return response.data!;
    },
};

// Subscription API
export const subscriptionAPI = {
    getPlans: async (): Promise<SubscriptionPlan[]> => {
        const response = await fetchAPI<ApiResponse<SubscriptionPlan[]>>('/subscriptions/plans');
        return response.data!;
    },

    getCurrent: async (): Promise<{ subscription: Subscription | null; usage: PlanUsage | null; entitlement?: EntitlementState }> => {
        const response = await fetchAPI<ApiResponse<{ subscription: Subscription | null; usage: PlanUsage | null; entitlement?: EntitlementState }>>('/subscriptions/current');
        return response.data!;
    },

    subscribe: async (planSlug: string, couponCode?: string): Promise<{ subscriptionId: string; keyId: string }> => {
        const response = await fetchAPI<ApiResponse<{ subscriptionId: string; keyId: string }>>('/subscriptions/subscribe', {
            method: 'POST',
            body: JSON.stringify({ planSlug, billingCycle: 'MONTHLY', couponCode }),
        });
        return response.data!;
    },

    cancel: async (): Promise<void> => {
        await fetchAPI('/subscriptions/cancel', { method: 'POST' });
    },

    changePlan: async (planSlug: string, opts?: { mode?: 'now' | 'cycle_end' }): Promise<{
        effective: 'immediate' | 'cycle_end';
        planName: string;
        currentPeriodEnd?: string | Date;
        requiresCheckout?: boolean;
        subscriptionId?: string;
        keyId?: string;
    }> => {
        const response = await fetchAPI<ApiResponse<{
            effective: 'immediate' | 'cycle_end';
            planName: string;
            currentPeriodEnd?: string | Date;
            requiresCheckout?: boolean;
            subscriptionId?: string;
            keyId?: string;
        }>>('/subscriptions/change-plan', {
            method: 'POST',
            body: JSON.stringify({
                planSlug,
                billingCycle: 'MONTHLY',
                ...(opts?.mode ? { mode: opts.mode } : {}),
            }),
        });
        return response.data!;
    },

    reactivate: async (): Promise<{ requiresCheckout: true; subscriptionId: string; keyId: string }> => {
        const res = await fetchAPI<ApiResponse<{ requiresCheckout: true; subscriptionId: string; keyId: string }>>(
            '/subscriptions/reactivate',
            { method: 'POST' },
        );
        return res.data!;
    },

    purchaseCredits: async (creditPackId: string): Promise<{ orderId: string; amount: number; currency: string; keyId: string; credits: number }> => {
        const response = await fetchAPI<ApiResponse<{ orderId: string; amount: number; currency: string; keyId: string; credits: number }>>('/subscriptions/credits/purchase', {
            method: 'POST',
            body: JSON.stringify({ creditPackId }),
        });
        return response.data!;
    },

    verifyCredits: async (razorpayOrderId: string, razorpayPaymentId: string, razorpaySignature: string): Promise<void> => {
        await fetchAPI('/subscriptions/credits/verify', {
            method: 'POST',
            body: JSON.stringify({ razorpayOrderId, razorpayPaymentId, razorpaySignature }),
        });
    },

    verifySubscription: async (
        razorpayPaymentId: string,
        razorpaySubscriptionId: string,
        razorpaySignature: string,
    ): Promise<{ status: string; subscriptionId: string }> => {
        const response = await fetchAPI<ApiResponse<{ status: string; subscriptionId: string }>>('/subscriptions/verify', {
            method: 'POST',
            body: JSON.stringify({ razorpayPaymentId, razorpaySubscriptionId, razorpaySignature }),
        });
        return response.data!;
    },
};

// Coupon API
export const couponAPI = {
    validate: async (code: string, planSlug?: string, billingCycle?: BillingCycle): Promise<{ valid: boolean; reason?: string; type?: string; value?: number; maxBillingCycles?: number }> => {
        const response = await fetchAPI<ApiResponse<{ valid: boolean; reason?: string; type?: string; value?: number; maxBillingCycles?: number }>>('/coupons/validate', {
            method: 'POST',
            body: JSON.stringify({ code, planSlug, billingCycle }),
        });
        return response.data!;
    },
};

// Credit Packs API
export const creditPacksAPI = {
    getAll: async (): Promise<CreditPack[]> => {
        const response = await fetchAPI<ApiResponse<CreditPack[]>>('/credit-packs');
        return response.data!;
    },
};

// Invoice API
export const invoiceAPI = {
    getAll: async (): Promise<Invoice[]> => {
        const response = await fetchAPI<ApiResponse<Invoice[]>>('/invoices');
        return response.data!;
    },

    getById: async (id: string): Promise<Invoice> => {
        const response = await fetchAPI<ApiResponse<Invoice>>(`/invoices/${id}`);
        return response.data!;
    },
};

// Config API
export const configAPI = {
    getFeatures: async (): Promise<FeatureFlags> => {
        const res = await fetchAPI<ApiResponse<FeatureFlags>>('/config/features');
        // Fallback: if the endpoint returns no data, default every flag to false.
        // The shape MUST match FeatureFlags exactly so downstream consumers can
        // safely read every flag without optional-chains or undefined checks.
        return res.data ?? {
            deleteAccount: false,
            topupCredits: false,
            updatesSection: false,
            minScheduleAheadMins: 150,
            postApprovalBufferMins: 120,
            cycleApprovalBufferMins: 4320,
            enabledPlatforms: ['INSTAGRAM', 'FACEBOOK'] as Platform[],
            webTheme: 'orchid-admin',
        };
    },
};

// Account API
export const accountAPI = {
    delete: async (): Promise<void> => {
        await fetchAPI<ApiResponse<void>>('/account', { method: 'DELETE' });
    },
};

// Cities API
export const citiesAPI = {
    getAll: async (): Promise<City[]> => {
        const response = await fetchAPI<ApiResponse<City[]>>('/restaurant/cities');
        return response.data!;
    },
};

// Account Manager API
export const accountManagerAPI = {
    getByCityAndZone: async (city: string, zone?: string): Promise<AccountManager[]> => {
        const params = new URLSearchParams({ city });
        if (zone) params.set('zone', zone);
        const response = await fetchAPI<ApiResponse<AccountManager[]>>(
            `/restaurant/account-managers?${params.toString()}`
        );
        return response.data!;
    },
};

// ===== Restaurant Intelligence =====
// Client-facing types used by components/intelligence/sections/*. (Ported from the source workspace.)

export interface SnapshotSeriesPoint {
    date: string; // YYYY-MM-DD (day) or YYYY-MM (month)
    source: SnapshotSource;
    rating: number;
    reviewCount: number;
    newReviews: number;
    photoCount: number;
    seoScore?: number;
    backfilled?: boolean;
}

/** A new review in the feedback feed, tagged with its source. */
export interface FeedbackReview extends SnapshotReview {
    source: SnapshotSource;
}

/** One day of the self-only "what changed" feed. */
export interface FeedbackDay {
    date: string;
    newReviews: FeedbackReview[];
    ratingBefore: number | null;
    ratingAfter: number;
    themesTrending: ReviewTheme[];
}

/** One New Openings radar row (nearby sighting first seen within the window). */
export interface NewOpening {
    placeId: string;
    name: string;
    distanceKm: number;
    cuisine?: string;
    firstSeenAt: string; // ISO
    ratingAtFirstSeen: number;
    reviewsAtFirstSeen: number;
    currentReviewCount: number;
    reviewsSinceFirstSeen: number;
    daysSinceFirstSeen: number;
    fastStarter: boolean;
}

export interface SnapshotSeriesResponse {
    target: string;
    source: string;
    granularity: string;
    points: SnapshotSeriesPoint[];
}

export interface WatchlistResponse {
    entries: WatchlistEntry[];
    max: number;
}

export interface SnapshotQuery {
    target?: string; // 'self' | placeId
    source?: SnapshotSource | 'both';
    granularity: 'day' | 'month';
    from?: string;
    to?: string;
}

export interface CompareQuery {
    granularity: 'day' | 'month';
    date?: string; // YYYY-MM-DD (day)
    month?: string; // YYYY-MM (month)
}

export interface RivalComment {
    rating: number;
    text: string;
    date: string;
}

export interface RivalDigest {
    placeId: string;
    name: string;
    latest?: { date: string; rating: number; reviewCount: number };
    yesterday: { date: string | null; total: number; positive: number; negative: number };
    week: { total: number; positive: number; negative: number };
    positiveComments: RivalComment[];
    negativeComments: RivalComment[];
    aheadOnRating?: boolean;
}

export interface WatchlistDigestResponse {
    rivals: RivalDigest[];
    hasData: boolean;
}

export interface WatchlistInput {
    placeId: string;
    name?: string;
    zomatoUrl?: string;
}

export interface ZomatoManualInput {
    target?: string;
    rating: number;
    reviewCount: number;
    photoCount: number;
}

// Real fetch-backed client -> /api/intelligence (OWNER-scoped).
const realIntelligenceAPI = {
    /** The owner's notification feed (report ready, alerts, yesterday's reviews). */
    getNotifications: async (): Promise<IntelligenceNotificationsResponse> => {
        const res = await fetchAPI<ApiResponse<IntelligenceNotificationsResponse>>('/intelligence/notifications');
        return res.data ?? { items: [], unread: 0, seenAt: null };
    },
    markNotificationsSeen: async (): Promise<{ seenAt: string }> => {
        const res = await fetchAPI<ApiResponse<{ seenAt: string }>>('/intelligence/notifications/seen', { method: 'POST' });
        return res.data!;
    },
    /** Rivals-you-track digest: day/week review splits + actual comments. */
    getWatchlistDigest: async (): Promise<WatchlistDigestResponse> => {
        const res = await fetchAPI<ApiResponse<WatchlistDigestResponse>>('/intelligence/watchlist/digest');
        return res.data ?? { rivals: [], hasData: false };
    },
    /** Draft an owner reply to one review (Claude, draft-only). */
    draftReply: async (review: { text: string; rating: number; author?: string }): Promise<{ reply: string; stance: 'apology' | 'thanks' | 'clarify' }> => {
        const res = await fetchAPI<ApiResponse<{ reply: string; stance: 'apology' | 'thanks' | 'clarify' }>>('/intelligence/reviews/draft-reply', {
            method: 'POST', body: JSON.stringify(review),
        });
        return res.data!;
    },
    /** Action-plan progress: which priorities are ticked off for a report. */
    getActionProgress: async (reportId: string): Promise<{ reportId: string; done: number[] }> => {
        const res = await fetchAPI<ApiResponse<{ reportId: string; done: number[] }>>(`/intelligence/action-plan/progress?reportId=${encodeURIComponent(reportId)}`);
        return res.data ?? { reportId, done: [] };
    },
    putActionProgress: async (reportId: string, done: number[]): Promise<{ reportId: string; done: number[] }> => {
        const res = await fetchAPI<ApiResponse<{ reportId: string; done: number[] }>>('/intelligence/action-plan/progress', {
            method: 'PUT', body: JSON.stringify({ reportId, done }),
        });
        return res.data!;
    },
    /** "Is this you?" — Google listings matching the restaurant, before a scan. */
    searchPlaces: async (query: { name?: string; city?: string } = {}): Promise<PlaceCandidate[]> => {
        const params = new URLSearchParams();
        if (query.name) params.set('name', query.name);
        if (query.city) params.set('city', query.city);
        const qs = params.toString();
        const res = await fetchAPI<ApiResponse<PlaceCandidate[]>>(`/intelligence/places/search${qs ? `?${qs}` : ''}`);
        return res.data ?? [];
    },
    startScan: async (body: { name?: string; city?: string; force?: boolean; placeId?: string }): Promise<{ scanId: string }> => {
        const res = await fetchAPI<ApiResponse<{ scanId: string }>>('/intelligence/scan', {
            method: 'POST', body: JSON.stringify(body),
        });
        return res.data!;
    },
    getScan: async (scanId: string): Promise<IntelligenceScan> => {
        const res = await fetchAPI<ApiResponse<IntelligenceScan>>(`/intelligence/scan/${scanId}`);
        return res.data!;
    },
    /** The in-flight scan, if any -- lets the UI resume polling after a remount/refresh. */
    getActiveScan: async (): Promise<IntelligenceScan | null> => {
        const res = await fetchAPI<ApiResponse<IntelligenceScan | null>>('/intelligence/scan/active');
        return res.data ?? null;
    },
    getReports: async (): Promise<IntelligenceReportSummary[]> => {
        const res = await fetchAPI<ApiResponse<IntelligenceReportSummary[]>>('/intelligence/reports');
        return res.data ?? [];
    },
    getReport: async (reportId: string): Promise<IntelligenceReport> => {
        const res = await fetchAPI<ApiResponse<IntelligenceReport>>(`/intelligence/reports/${reportId}`);
        return res.data!;
    },
    getLatestReport: async (): Promise<IntelligenceReport | null> => {
        const res = await fetchAPI<ApiResponse<IntelligenceReport | null>>('/intelligence/reports/latest');
        return res.data ?? null;
    },
    getSelfMetrics: async (): Promise<IntelligenceSelfMetrics> => {
        const res = await fetchAPI<ApiResponse<IntelligenceSelfMetrics>>('/intelligence/self-metrics');
        return res.data!;
    },
    getWatchlist: async (): Promise<WatchlistResponse> => {
        const res = await fetchAPI<ApiResponse<WatchlistResponse>>('/intelligence/watchlist');
        return res.data!;
    },
    putWatchlist: async (entries: WatchlistInput[]): Promise<WatchlistResponse> => {
        const res = await fetchAPI<ApiResponse<WatchlistResponse>>('/intelligence/watchlist', {
            method: 'PUT', body: JSON.stringify({ entries }),
        });
        return res.data!;
    },
    getSnapshots: async (query: SnapshotQuery): Promise<SnapshotSeriesResponse> => {
        const params = new URLSearchParams();
        if (query.target) params.set('target', query.target);
        if (query.source) params.set('source', query.source);
        params.set('granularity', query.granularity);
        if (query.from) params.set('from', query.from);
        if (query.to) params.set('to', query.to);
        const res = await fetchAPI<ApiResponse<SnapshotSeriesResponse>>(`/intelligence/snapshots?${params}`);
        return res.data!;
    },
    getFeedbackChanges: async (query: { from?: string; to?: string } = {}): Promise<{ days: FeedbackDay[] }> => {
        const params = new URLSearchParams();
        if (query.from) params.set('from', query.from);
        if (query.to) params.set('to', query.to);
        const qs = params.toString();
        const res = await fetchAPI<ApiResponse<{ days: FeedbackDay[] }>>(`/intelligence/feedback-changes${qs ? `?${qs}` : ''}`);
        return res.data ?? { days: [] };
    },
    getCompare: async (query: CompareQuery): Promise<CompareRow[]> => {
        const params = new URLSearchParams({ granularity: query.granularity });
        if (query.granularity === 'day' && query.date) params.set('date', query.date);
        if (query.granularity === 'month' && query.month) params.set('month', query.month);
        const res = await fetchAPI<ApiResponse<CompareRow[]>>(`/intelligence/compare?${params}`);
        return res.data ?? [];
    },
    getNewOpenings: async (query: { sinceDays?: 30 | 60 | 90; radiusKm?: number } = {}): Promise<NewOpening[]> => {
        const params = new URLSearchParams();
        if (query.sinceDays) params.set('sinceDays', String(query.sinceDays));
        if (query.radiusKm) params.set('radiusKm', String(query.radiusKm));
        const qs = params.toString();
        const res = await fetchAPI<ApiResponse<NewOpening[]>>(`/intelligence/new-openings${qs ? `?${qs}` : ''}`);
        return res.data ?? [];
    },
    postZomatoManual: async (body: ZomatoManualInput): Promise<{ snapshotWritten: boolean }> => {
        const res = await fetchAPI<ApiResponse<{ snapshotWritten: boolean }>>('/intelligence/zomato-manual', {
            method: 'POST', body: JSON.stringify(body),
        });
        return res.data!;
    },
    captureNow: async (): Promise<{ captured: number }> => {
        const res = await fetchAPI<ApiResponse<{ captured: number }>>('/intelligence/snapshots/capture', {
            method: 'POST',
        });
        return res.data!;
    },
};

// Demo twin (VITE_DEMO_MODE=true) swaps in the in-memory fixtures; otherwise the
// real /api/intelligence client is used. `typeof realIntelligenceAPI`
// forces the demo twin to expose an identical surface.
export const intelligenceAPI: typeof realIntelligenceAPI = isDemoMode()
    ? (demoIntelligenceAPI as typeof realIntelligenceAPI)
    : realIntelligenceAPI;
