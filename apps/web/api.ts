import { User, Restaurant, Post, ContentStrategy, StrategyCycle, LoginRequest, AuthResponse, ApiResponse, InstagramConnectionStatus, InstagramAccount, InstagramConnectionError, AccountManager, City, SubscriptionPlan, Subscription, PlanUsage, CreditPack, BillingCycle, Invoice, FeatureFlags, Platform } from '@restropulse/shared';
import { browserEvents } from '@restropulse/telemetry/browser';
import { getApiUrl } from './utils/env';

const API_BASE_URL = getApiUrl();

// Helper function for API calls with auto token refresh
async function fetchAPI<T>(endpoint: string, options?: RequestInit, retry = true): Promise<T> {
    const token = localStorage.getItem('rp_token');

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionStorage.getItem('ai_session') || '',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options?.headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
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
            const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
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
};

// Restaurant API
export const restaurantAPI = {
    create: async (data: {
        name: string;
        cuisine: string;
        userName?: string;
        email?: string;
        location?: Restaurant['location'];
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

    create: async (post: Omit<Post, 'id'>): Promise<Post> => {
        const response = await fetchAPI<ApiResponse<Post>>('/posts', {
            method: 'POST',
            body: JSON.stringify(post),
        });
        return response.data!;
    },

    // Generate post with AI-created content
    generate: async (params: {
        concept: string;
        type: Post['type'];
        platforms: Post['platforms'];
        scheduledFor?: string;
        asap?: boolean;
    }): Promise<Post> => {
        const response = await fetchAPI<ApiResponse<Post>>('/posts/generate', {
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

    delete: async (id: string): Promise<void> => {
        await fetchAPI(`/posts/${id}`, { method: 'DELETE' });
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

    getCurrent: async (): Promise<{ subscription: Subscription | null; usage: PlanUsage | null }> => {
        const response = await fetchAPI<ApiResponse<{ subscription: Subscription | null; usage: PlanUsage | null }>>('/subscriptions/current');
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
        return res.data ?? { deleteAccount: false, topupCredits: false, updatesSection: false, minScheduleAheadMins: 150, postApprovalBufferMins: 120, cycleApprovalBufferMins: 4320, enabledPlatforms: ['INSTAGRAM', 'FACEBOOK'] as Platform[] };
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
