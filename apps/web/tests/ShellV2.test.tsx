/**
 * V2 admin shell smoke tests.
 *
 * The v2 shell is enabled only when import.meta.env.VITE_ADMIN_SHELL === 'v2'.
 * These tests cover: (1) ShellV2 renders the four sidebar buckets, (2) default
 * builds (flag unset) still render the v1 Layout, (3) flag on renders ShellV2.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from './utils/test-utils';
import ShellV2 from '../components/v2/ShellV2';
import App from '../App';
import { DEMO_RESTAURANT, DEMO_FEATURE_FLAGS, DEMO_ANALYTICS } from '../lib/demo-fixtures';

// Mock the whole API client so no network is attempted anywhere in the tree.
vi.mock('../api', () => ({
    authAPI: {
        checkSession: vi.fn().mockResolvedValue({ success: true, user: { id: 'u1', name: 'Demo Owner', role: 'OWNER' } }),
        logout: vi.fn().mockResolvedValue(undefined),
    },
    restaurantAPI: {
        get: vi.fn(),
        getAnalytics: vi.fn().mockResolvedValue({ postsPerWeek: [], contentMix: [], platformMix: [] }),
    },
    postsAPI: { getAll: vi.fn().mockResolvedValue([]) },
    strategyAPI: { get: vi.fn().mockResolvedValue({}), getCycles: vi.fn().mockResolvedValue([]) },
    configAPI: { getFeatures: vi.fn() },
    instagramAPI: { getStatus: vi.fn().mockResolvedValue({ connected: false }) },
    subscriptionAPI: { getPlans: vi.fn().mockResolvedValue([]), getCurrent: vi.fn().mockResolvedValue(null), getUsage: vi.fn().mockResolvedValue(null) },
    couponAPI: { validate: vi.fn() },
    creditPacksAPI: { getAll: vi.fn().mockResolvedValue([]) },
    invoiceAPI: { getAll: vi.fn().mockResolvedValue([]) },
    accountAPI: { delete: vi.fn() },
    citiesAPI: { getAll: vi.fn().mockResolvedValue([]) },
    accountManagerAPI: { get: vi.fn().mockResolvedValue(null) },
    orderingAdminAPI: {
        getOrders: vi.fn().mockResolvedValue([]),
        getReservations: vi.fn().mockResolvedValue([]),
        getAnalyticsSummary: vi.fn().mockResolvedValue({ from: '', to: '', events: [] }),
    },
}));

// App -> Login -> firebase; keep it inert (same shape as Login.test.tsx).
vi.mock('../firebase', () => ({
    initRecaptcha: vi.fn(),
    sendOTP: vi.fn(),
    verifyOTP: vi.fn(),
    auth: { currentUser: null },
}));

import { restaurantAPI, configAPI, postsAPI } from '../api';

const BUCKETS = ['Content Engine', 'Online Ordering', 'Restaurant Intelligence', 'Website Design'];

describe('ShellV2 (v2 admin shell)', () => {
    const shellProps = {
        restaurantData: DEMO_RESTAURANT,
        userInitials: 'DO',
        featureFlags: DEMO_FEATURE_FLAGS,
        metaConnected: true,
        instagramEnabled: true,
        facebookEnabled: true,
        onConnectInstagram: vi.fn(),
        onProfileOpen: vi.fn(),
        onRefreshRestaurant: vi.fn(),
        refreshKey: 0,
    };

    beforeEach(() => {
        vi.mocked(restaurantAPI.getAnalytics).mockResolvedValue(DEMO_ANALYTICS as any);
        vi.mocked(postsAPI.getAll).mockResolvedValue([]);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('renders the four sidebar buckets with wordmark and prototype footer', () => {
        render(<ShellV2 {...shellProps} />);

        const nav = screen.getByRole('navigation', { name: /main navigation/i });
        for (const label of BUCKETS) {
            expect(nav).toHaveTextContent(label);
        }
        expect(screen.getByText(/Social media made simple for restaurants/i)).toBeInTheDocument();
        expect(screen.getByText(/Prototype · sample data/i)).toBeInTheDocument();
        // Restaurant chip in the page header
        expect(screen.getByText(DEMO_RESTAURANT.name)).toBeInTheDocument();
    });

    it('shows the Content Engine overview by default with KPI cards', async () => {
        render(<ShellV2 {...shellProps} />);

        expect(screen.getByRole('tab', { name: /Overview/i })).toBeInTheDocument();
        expect(screen.getByText(/Posts this week/i)).toBeInTheDocument();
        await waitFor(() => {
            // Most recent week from the demo analytics fixture (7 posts)
            expect(screen.getByText(String(DEMO_ANALYTICS.postsPerWeek[0].posts))).toBeInTheDocument();
        });
    });
});

describe('App shell switch (VITE_ADMIN_SHELL flag)', () => {
    beforeEach(() => {
        vi.mocked(restaurantAPI.get).mockResolvedValue(DEMO_RESTAURANT);
        vi.mocked(restaurantAPI.getAnalytics).mockResolvedValue(DEMO_ANALYTICS as any);
        vi.mocked(postsAPI.getAll).mockResolvedValue([]);
        vi.mocked(configAPI.getFeatures).mockResolvedValue(DEMO_FEATURE_FLAGS);
        // Simulate a logged-in session with a restaurant attached
        (localStorage.getItem as any).mockImplementation((key: string) => {
            const store: Record<string, string> = {
                rp_token: 'test-token',
                rp_session: 'true',
                rp_restaurant_id: DEMO_RESTAURANT.id,
                rp_feature_flags: JSON.stringify(DEMO_FEATURE_FLAGS),
            };
            return store[key] ?? null;
        });
        window.history.replaceState({}, '', '/');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        (localStorage.getItem as any).mockReset();
    });

    it('renders the v1 Layout when the flag is off (default builds unchanged)', async () => {
        render(<App />);

        // v1 bottom navigation is the Layout's signature
        await waitFor(() => {
            expect(screen.getByText('Studio')).toBeInTheDocument();
        });
        expect(screen.getByText('Home')).toBeInTheDocument();
        // No v2 sidebar buckets anywhere
        expect(screen.queryByText('Restaurant Intelligence')).not.toBeInTheDocument();
        expect(screen.queryByText('Website Design')).not.toBeInTheDocument();
    });

    it('renders ShellV2 when VITE_ADMIN_SHELL=v2', async () => {
        vi.stubEnv('VITE_ADMIN_SHELL', 'v2');
        render(<App />);

        await waitFor(() => {
            expect(screen.getByText('Restaurant Intelligence')).toBeInTheDocument();
        });
        expect(screen.getByText('Website Design')).toBeInTheDocument();
        expect(screen.getByText(/Prototype · sample data/i)).toBeInTheDocument();
        // v1 bottom nav must not render
        expect(screen.queryByText('Home')).not.toBeInTheDocument();
    });
});
