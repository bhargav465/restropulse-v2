
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';

// Create mocks
const mockToArray = vi.fn();
const mockFindOne = vi.fn();
const mockFind = vi.fn(() => ({ toArray: mockToArray }));
const mockUpdateOne = vi.fn();
const mockCollection = {
    find: mockFind,
    findOne: mockFindOne,
    updateOne: mockUpdateOne
};
const mockGetRestaurantsCollection = vi.fn(() => mockCollection);

const mockRefreshAccessToken = vi.fn();
const mockEncrypt = vi.fn((val: string) => `encrypted_${val}`);
const mockSchedule = vi.fn();

// Mock modules BEFORE importing the subject
vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        getRestaurantsCollection: mockGetRestaurantsCollection
    };
});

vi.mock('../../../../packages/publishing/dist/meta-api.js', () => ({
    refreshAccessToken: mockRefreshAccessToken
}));

vi.mock('../../../../packages/publishing/dist/encryption.js', () => ({
    encrypt: mockEncrypt
}));

vi.mock('node-cron', () => ({
    default: { schedule: mockSchedule }
}));

// Import subject
const {
    getRestaurantsNeedingRefresh,
    refreshRestaurantToken,
    checkAndRefreshTokenIfNeeded,
    triggerManualRefresh,
    getRecentRefreshAttempts,
    startTokenRefreshCron
} = await import('@restropulse/publishing');

describe('Token Refresh Cron Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getRestaurantsNeedingRefresh', () => {
        it('should query restaurants with expiring tokens', async () => {
            (mockToArray as any).mockResolvedValue(['res1', 'res2']);

            const result = await getRestaurantsNeedingRefresh();

            expect(mockGetRestaurantsCollection).toHaveBeenCalled();
            expect(mockFind).toHaveBeenCalledWith({
                'instagramCredentials.accessToken': { $exists: true, $ne: null },
                'instagramCredentials.tokenExpiresAt': { $lt: expect.any(Date) }
            });
            expect(result).toEqual(['res1', 'res2']);
        });
    });

    describe('refreshRestaurantToken', () => {
        const mockRestaurant = {
            _id: 'res-123',
            instagramCredentials: {
                username: 'my_ig',
                accessToken: 'old-token'
            }
        };

        it('should skip if no credentials', async () => {
            const result = await refreshRestaurantToken({ _id: 'res-123' });
            expect(result).toBe(false);
            expect(mockRefreshAccessToken).not.toHaveBeenCalled();
        });

        it('should refresh token successfully', async () => {
            const now = new Date();
            (mockRefreshAccessToken as any).mockResolvedValue({
                accessToken: 'new-token',
                expiresAt: now
            });

            const result = await refreshRestaurantToken(mockRestaurant);

            expect(result).toBe(true);
            expect(mockRefreshAccessToken).toHaveBeenCalledWith('old-token');
            expect(mockUpdateOne).toHaveBeenCalledWith(
                { _id: mockRestaurant._id },
                {
                    $set: {
                        'instagramCredentials.accessToken': 'encrypted_new-token',
                        'instagramCredentials.tokenExpiresAt': now,
                        'instagramCredentials.lastRefreshedAt': expect.any(Date),
                        updatedAt: expect.any(Date)
                    }
                }
            );
        });

        it('should handle refresh failure', async () => {
            (mockRefreshAccessToken as any).mockResolvedValue(null);

            const result = await refreshRestaurantToken(mockRestaurant);

            expect(result).toBe(false);
            expect(mockUpdateOne).not.toHaveBeenCalled();
        });

        it('should handle exception', async () => {
            (mockRefreshAccessToken as any).mockRejectedValue(new Error('API Error'));

            const result = await refreshRestaurantToken(mockRestaurant);

            expect(result).toBe(false);
        });
    });

    describe('checkAndRefreshTokenIfNeeded', () => {
        const mockRestaurant = {
            _id: 'res-123',
            instagramCredentials: {
                username: 'my_ig',
                accessToken: 'old-token',
                tokenExpiresAt: new Date(Date.now() + 86400000) // 1 day
            }
        };

        it('should return false if restaurant not found or no credentials', async () => {
            (mockFindOne as any).mockResolvedValue(null);
            let result = await checkAndRefreshTokenIfNeeded('res-123');
            expect(result).toBe(false);

            (mockFindOne as any).mockResolvedValue({});
            result = await checkAndRefreshTokenIfNeeded('res-123');
            expect(result).toBe(false);
        });

        it('should refresh if token expiring in < 7 days', async () => {
            // Expires in 1 day
            (mockFindOne as any).mockResolvedValue(mockRestaurant);
            (mockRefreshAccessToken as any).mockResolvedValue({ accessToken: 'new', expiresAt: new Date() });

            const result = await checkAndRefreshTokenIfNeeded('res-123');

            expect(result).toBe(true);
            expect(mockRefreshAccessToken).toHaveBeenCalled();
        });

        it('should NOT refresh if token valid for > 7 days', async () => {
            (mockFindOne as any).mockResolvedValue({
                ...mockRestaurant,
                instagramCredentials: {
                    ...mockRestaurant.instagramCredentials,
                    tokenExpiresAt: new Date(Date.now() + 8 * 24 * 3600 * 1000) // 8 days
                }
            });

            const result = await checkAndRefreshTokenIfNeeded('res-123');

            expect(result).toBe(true);
            expect(mockRefreshAccessToken).not.toHaveBeenCalled();
        });
    });

    describe('triggerManualRefresh', () => {
        it('should trigger refresh for all needed restaurants', async () => {
            const restaurants = [
                { _id: 'r1', instagramCredentials: { accessToken: 't1' } },
                { _id: 'r2', instagramCredentials: { accessToken: 't2' } }
            ];
            (mockToArray as any).mockResolvedValue(restaurants);
            (mockRefreshAccessToken as any)
                .mockResolvedValueOnce({ accessToken: 'new1', expiresAt: new Date() }) // r1 success
                .mockResolvedValueOnce(null); // r2 fail

            const result = await triggerManualRefresh();

            expect(result.success).toBe(1);
            expect(result.failed).toBe(1);
        });
    });

    describe('getRecentRefreshAttempts', () => {
        it('should return attempts list', () => {
            const attempts = getRecentRefreshAttempts();
            expect(Array.isArray(attempts)).toBe(true);
        });
    });

    describe('startTokenRefreshCron', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should schedule cron job', () => {
            startTokenRefreshCron();
            expect(mockSchedule).toHaveBeenCalledWith('0 2 * * *', expect.any(Function), expect.any(Object));
        });

        it('should execute scheduled job callback with items', async () => {
            vi.useFakeTimers();

            // Setup mock data for the job execution
            (mockToArray as any).mockResolvedValue([{
                _id: 'cron-res',
                instagramCredentials: { accessToken: 'cron-token', tokenExpiresAt: new Date(), username: 'cron-user' }
            }]);
            (mockRefreshAccessToken as any).mockResolvedValue({ accessToken: 'refreshed', expiresAt: new Date() });

            startTokenRefreshCron();

            // Get the callback passed to cron.schedule from the LAST call
            const calls = mockSchedule.mock.calls;
            const cronCallback = calls[calls.length - 1][1] as any;

            const callbackPromise = cronCallback(); // Execute it

            // Advance past the 1-second rate-limit delay between refreshes
            await vi.advanceTimersByTimeAsync(1000);

            await callbackPromise;

            // Verify it did work
            expect(mockFind).toHaveBeenCalled();
            expect(mockRefreshAccessToken).toHaveBeenCalledWith('cron-token');
            expect(mockUpdateOne).toHaveBeenCalledWith(
                { _id: 'cron-res' },
                expect.any(Object)
            );

            vi.useRealTimers();
        });

        it('should execute scheduled job callback with NO items', async () => {
            // Return empty list
            (mockToArray as any).mockResolvedValue([]);

            startTokenRefreshCron();

            const calls = mockSchedule.mock.calls;
            const cronCallback = calls[calls.length - 1][1] as any;

            await cronCallback(); // Execute it

            expect(mockFind).toHaveBeenCalled();
            expect(mockRefreshAccessToken).not.toHaveBeenCalled();
        });
    });
});
