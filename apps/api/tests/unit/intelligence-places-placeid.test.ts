/**
 * Place-picker short-circuit (Brief 10). When the owner confirmed a placeId, the
 * scan pipeline's base-restaurant resolution must SKIP the text-search
 * disambiguation call and go straight to Place Details — asserted via the mocked
 * Places (fetch) call count.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { findOne, updateOne } = vi.hoisted(() => ({ findOne: vi.fn(), updateOne: vi.fn() }));

// Partial mock — keep the real db (the global setup seeds via it) and override
// only the competitor cache so we can force a cache miss + count fetch calls.
vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@restropulse/db')>();
    return {
        ...actual,
        getCompetitorCacheCollection: () => ({ findOne, updateOne }),
    };
});

import { getBaseRestaurantDetails } from '../../src/services/intelligence/places.js';

const DETAIL = {
    id: 'ChIJdetail',
    location: { latitude: 12.9, longitude: 77.6 },
    priceLevel: 'PRICE_LEVEL_MODERATE',
    displayName: { text: 'Base Kitchen' },
    rating: 4.5,
    userRatingCount: 800,
};

const originalFetch = global.fetch;

describe('getBaseRestaurantDetails — placeId short-circuit', () => {
    beforeEach(() => {
        process.env.GOOGLE_MAPS_API_KEY = 'test-key';
        findOne.mockReset();
        updateOne.mockReset();
        findOne.mockResolvedValue(null); // cache miss → forces a detail fetch
        updateOne.mockResolvedValue(undefined);
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('with a placeId: one Place Details fetch, zero text-search calls', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => DETAIL });
        global.fetch = fetchMock as unknown as typeof fetch;

        const base = await getBaseRestaurantDetails('Base Kitchen', 'Bengaluru', 'ChIJconfirmed');

        expect(base?.placeId).toBe('ChIJconfirmed');
        expect(base?.priceLevel).toBe(2); // PRICE_LEVEL_MODERATE
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = String(fetchMock.mock.calls[0][0]);
        expect(url).toContain('/places/ChIJconfirmed');
        expect(url).not.toContain('searchText');
    });

    it('without a placeId: text-search THEN detail fetch (2 calls)', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    places: [
                        {
                            id: 'ChIJfound',
                            displayName: { text: 'Base Kitchen' },
                            rating: 4.5,
                            userRatingCount: 800,
                            location: { latitude: 12.9, longitude: 77.6 },
                        },
                    ],
                }),
            })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ ...DETAIL, id: 'ChIJfound' }) });
        global.fetch = fetchMock as unknown as typeof fetch;

        const base = await getBaseRestaurantDetails('Base Kitchen', 'Bengaluru');

        expect(base?.placeId).toBe('ChIJfound');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[0][0])).toContain('searchText');
    });
});
