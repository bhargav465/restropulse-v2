import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockToArray = vi.fn();
const mockFind = vi.fn(() => ({ toArray: mockToArray }));
const mockFindOne = vi.fn();
const mockUpdateOne = vi.fn();
const mockRestaurantsCollection = {
    find: mockFind,
    findOne: mockFindOne,
    updateOne: mockUpdateOne
};

const mockRefreshAccessToken = vi.fn();
const mockEncrypt = vi.fn((value: string) => `encrypted_${value}`);
const mockSchedule = vi.fn();

vi.mock('@restropulse/db', () => ({
    getRestaurantsCollection: vi.fn(() => mockRestaurantsCollection),
    toObjectId: vi.fn((id: string) => id)
}));

vi.mock('../../../../packages/publishing/dist/meta-api.js', () => ({
    refreshAccessToken: mockRefreshAccessToken
}));

vi.mock('../../../../packages/publishing/dist/encryption.js', () => ({
    encrypt: mockEncrypt
}));

vi.mock('node-cron', () => ({
    default: { schedule: mockSchedule }
}));

const {
    getRestaurantsNeedingRefresh,
    refreshRestaurantToken,
    checkAndRefreshTokenIfNeeded,
    triggerManualRefresh,
    getRecentRefreshAttempts,
    startTokenRefreshCron
} = await import('@restropulse/publishing');

describe('token refresh cron service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('queries restaurants needing refresh', async () => {
        mockToArray.mockResolvedValue([{ _id: 'restaurant-1' }]);

        const restaurants = await getRestaurantsNeedingRefresh();

        expect(restaurants).toHaveLength(1);
        expect(mockFind).toHaveBeenCalledWith({
            'instagramCredentials.accessToken': { $exists: true, $ne: null },
            'instagramCredentials.tokenExpiresAt': { $lt: expect.any(Date) }
        });
    });

    it('refreshes single restaurant token', async () => {
        const restaurant = {
            _id: 'restaurant-1',
            instagramCredentials: {
                username: 'account',
                accessToken: 'old-token'
            }
        };

        const expiresAt = new Date();
        mockRefreshAccessToken.mockResolvedValue({ accessToken: 'new-token', expiresAt });

        const refreshed = await refreshRestaurantToken(restaurant);

        expect(refreshed).toBe(true);
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { _id: 'restaurant-1' },
            {
                $set: {
                    'instagramCredentials.accessToken': 'encrypted_new-token',
                    'instagramCredentials.tokenExpiresAt': expiresAt,
                    'instagramCredentials.lastRefreshedAt': expect.any(Date),
                    updatedAt: expect.any(Date)
                }
            }
        );
    });

    it('returns false when token refresh fails', async () => {
        const restaurant = {
            _id: 'restaurant-1',
            instagramCredentials: {
                username: 'account',
                accessToken: 'old-token'
            }
        };

        mockRefreshAccessToken.mockResolvedValue(null);

        const refreshed = await refreshRestaurantToken(restaurant);

        expect(refreshed).toBe(false);
    });

    it('returns false when refresh throws exception', async () => {
        const restaurant = {
            _id: 'restaurant-exception',
            instagramCredentials: {
                username: 'account',
                accessToken: 'old-token'
            }
        };

        mockRefreshAccessToken.mockRejectedValue(new Error('API exception'));

        const refreshed = await refreshRestaurantToken(restaurant);

        expect(refreshed).toBe(false);
    });

    it('returns false when restaurant has no credentials', async () => {
        const refreshed = await refreshRestaurantToken({ _id: 'restaurant-no-creds' });
        expect(refreshed).toBe(false);
        expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('on-demand refreshes token that expires soon', async () => {
        mockFindOne.mockResolvedValue({
            _id: 'restaurant-1',
            instagramCredentials: {
                username: 'account',
                accessToken: 'old-token',
                tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
            }
        });

        mockRefreshAccessToken.mockResolvedValue({
            accessToken: 'new-token',
            expiresAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000)
        });

        const result = await checkAndRefreshTokenIfNeeded('restaurant-1');

        expect(result).toBe(true);
        expect(mockRefreshAccessToken).toHaveBeenCalled();
    });

    it('returns false when on-demand check cannot find restaurant', async () => {
        mockFindOne.mockResolvedValue(null);

        const result = await checkAndRefreshTokenIfNeeded('missing-restaurant');

        expect(result).toBe(false);
    });

    it('returns true and skips refresh when token is valid for more than 7 days', async () => {
        mockFindOne.mockResolvedValue({
            _id: 'restaurant-2',
            instagramCredentials: {
                username: 'account',
                accessToken: 'old-token',
                tokenExpiresAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000)
            }
        });

        const result = await checkAndRefreshTokenIfNeeded('restaurant-2');

        expect(result).toBe(true);
        expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('manual refresh aggregates success and failure counts', async () => {
        mockToArray.mockResolvedValue([
            { _id: 'r1', instagramCredentials: { accessToken: 'token-1' } },
            { _id: 'r2', instagramCredentials: { accessToken: 'token-2' } }
        ]);

        mockRefreshAccessToken
            .mockResolvedValueOnce({ accessToken: 'new-1', expiresAt: new Date() })
            .mockResolvedValueOnce(null);

        const result = await triggerManualRefresh();

        expect(result).toEqual({ success: 1, failed: 1 });
    });

    it('schedules cron with expected expression', () => {
        startTokenRefreshCron();

        expect(mockSchedule).toHaveBeenCalledWith(
            '0 2 * * *',
            expect.any(Function),
            expect.objectContaining({ timezone: 'Asia/Kolkata' })
        );
    });

    it('executes scheduled callback and processes restaurants', async () => {
        vi.useFakeTimers();
        mockToArray.mockResolvedValue([
            {
                _id: 'r-callback',
                instagramCredentials: {
                    username: 'callback-user',
                    accessToken: 'old-token',
                    tokenExpiresAt: new Date()
                }
            }
        ]);

        mockRefreshAccessToken.mockResolvedValue({ accessToken: 'new-token', expiresAt: new Date() });

        startTokenRefreshCron();
        const callback = (mockSchedule.mock.calls[0] as any[])[1] as () => Promise<void>;

        const callbackPromise = callback();
        await vi.advanceTimersByTimeAsync(1000);
        await callbackPromise;

        expect(mockUpdateOne).toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('runs initial development check', async () => {
        vi.useFakeTimers();
        const previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        mockToArray.mockResolvedValue([]);

        startTokenRefreshCron();
        await vi.advanceTimersByTimeAsync(5000);

        expect(mockFind).toHaveBeenCalled();

        process.env.NODE_ENV = previousEnv;
        vi.useRealTimers();
    });

    it('returns recent refresh attempts using limit', async () => {
        const firstRestaurant = {
            _id: 'attempt-1',
            instagramCredentials: {
                username: 'first',
                accessToken: 'token-1'
            }
        };

        const secondRestaurant = {
            _id: 'attempt-2',
            instagramCredentials: {
                username: 'second',
                accessToken: 'token-2'
            }
        };

        mockRefreshAccessToken
            .mockResolvedValueOnce({ accessToken: 'new-1', expiresAt: new Date() })
            .mockResolvedValueOnce(null);

        await refreshRestaurantToken(firstRestaurant);
        await refreshRestaurantToken(secondRestaurant);

        const attempts = getRecentRefreshAttempts(1);
        expect(attempts.length).toBe(1);
        expect(attempts[0].restaurantId).toBe('attempt-2');
    });
});
