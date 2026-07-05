/**
 * DEMO MODE (VITE_DEMO_MODE=true): api-client switch for the merchant dashboard.
 *
 * The switch in api.ts is resolved at module load, so every test stubs the
 * env first, resets the module registry, and re-imports ../api dynamically.
 * Mirrors apps/storefront/tests/demo-mode.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const importApi = () => import('../api');

// tests/setup.ts installs a non-functional localStorage stub; the demo client
// needs a working one (it keeps the session token keys there).
function makeLocalStorage() {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => { store[key] = String(value); },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
    };
}

beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeLocalStorage());
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('api client switch', () => {
    it('signs in the sample owner and serves fixtures without any network call when the flag is on', async () => {
        vi.stubEnv('VITE_DEMO_MODE', 'true');
        const fetchMock = vi.fn(() => { throw new Error('demo mode must not fetch'); });
        vi.stubGlobal('fetch', fetchMock);

        const { authAPI, restaurantAPI, postsAPI, orderingAdminAPI } = await importApi();

        // Dummy auth: any credentials sign in the sample owner.
        const auth = await authAPI.verifyOtp('anything', 'anything');
        expect(auth.success).toBe(true);
        expect(auth.user?.name).toContain('[SAMPLE]');
        expect(localStorage.getItem('rp_restaurant_id')).toBe('demo-r1');

        const restaurant = await restaurantAPI.get('demo-r1');
        expect(restaurant.name).toBe('[SAMPLE] Demo Kitchen');

        // Dashboard analytics + content studio posts come from fixtures.
        const analytics = await restaurantAPI.getAnalytics('demo-r1');
        expect(analytics.postsPerWeek.length).toBeGreaterThan(0);
        const posts = await postsAPI.getAll();
        expect(posts.length).toBeGreaterThanOrEqual(8);
        expect(posts.some((p) => p.status === 'PENDING_APPROVAL')).toBe(true);
        expect(posts.some((p) => p.status === 'SCHEDULED')).toBe(true);
        expect(posts.some((p) => p.status === 'POSTED')).toBe(true);

        // Ordering: seed menu (4 categories / 14 items) + descending funnel.
        const categories = await orderingAdminAPI.getCategories();
        const items = await orderingAdminAPI.getItems();
        expect(categories).toHaveLength(4);
        expect(items).toHaveLength(14);
        const funnel = await orderingAdminAPI.getAnalyticsSummary();
        const counts = ['menu_view', 'item_view', 'add_to_cart', 'begin_checkout', 'login_prompt', 'order_placed']
            .map((name) => funnel.events.find((e) => e.name === name)!.count);
        expect([...counts].sort((a, b) => b - a)).toEqual(counts); // strictly descending order preserved

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('mutates local demo state on approve/reject (content-engine workflow)', async () => {
        vi.stubEnv('VITE_DEMO_MODE', 'true');
        const fetchMock = vi.fn(() => { throw new Error('demo mode must not fetch'); });
        vi.stubGlobal('fetch', fetchMock);

        const { postsAPI } = await importApi();

        const pending = (await postsAPI.getAll()).find((p) => p.status === 'PENDING_APPROVAL')!;
        const approved = await postsAPI.update(pending.id, { status: 'SCHEDULED' });
        expect(approved.status).toBe('SCHEDULED');

        // Local state sticks across reads (no persistence, in-memory only).
        const after = await postsAPI.getAll();
        expect(after.find((p) => p.id === pending.id)?.status).toBe('SCHEDULED');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('uses the real fetch-backed client when the flag is off', async () => {
        const fetchMock = vi.fn(async (..._args: unknown[]) => ({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { id: 'r1', name: 'Real Place' } }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        const { restaurantAPI } = await importApi();
        const restaurant = await restaurantAPI.get('r1');

        expect(restaurant.name).toBe('Real Place');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]![0])).toContain('/restaurant/r1');
    });
});
