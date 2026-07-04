import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockToArray = vi.fn();
const mockSort = vi.fn<any>(() => ({ toArray: mockToArray }));
const mockFind = vi.fn<any>(() => ({ sort: mockSort }));
const mockFindOneAndUpdate = vi.fn();
const mockUpdateOne = vi.fn();

const mockPostsCollection = {
    find: mockFind,
    findOneAndUpdate: mockFindOneAndUpdate,
    updateOne: mockUpdateOne
};

const mockRestaurantFindOne = vi.fn();
const mockRestaurantsCollection = {
    findOne: mockRestaurantFindOne
};

const mockPublishPost = vi.fn();
const mockSchedule = vi.fn();

vi.mock('@restropulse/db', () => ({
    getPostsCollection: vi.fn(() => mockPostsCollection),
    getRestaurantsCollection: vi.fn(() => mockRestaurantsCollection),
    toApiFormat: vi.fn((value: unknown) => value),
    toObjectId: vi.fn((id: string) => id)
}));

vi.mock('../../../../packages/publishing/dist/publishing-service.js', () => ({
    publishPost: mockPublishPost
}));

vi.mock('node-cron', () => ({
    default: { schedule: mockSchedule }
}));

const {
    getPostsDueForPublishing,
    getRestaurantCredentials,
    processPostForPublishing,
    runPublishingJob,
    getRecentPublishAttempts,
    startPublishingCron,
    triggerManualPublish
} = await import('@restropulse/publishing');

describe('publishing cron service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockToArray.mockResolvedValue([]);
        mockFindOneAndUpdate.mockResolvedValue({ _id: 'post-1', status: 'PUBLISHING' });
        mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    });

    it('gets due scheduled posts', async () => {
        mockToArray.mockResolvedValue([{ _id: 'p1', status: 'SCHEDULED' }]);

        const posts = await getPostsDueForPublishing();

        expect(posts).toHaveLength(1);
        expect(mockFind).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'SCHEDULED',
                scheduledFor: { $lte: expect.any(String) }
            })
        );
    });

    it('gets restaurant credentials', async () => {
        mockRestaurantFindOne.mockResolvedValue({ _id: 'restaurant-1', instagramCredentials: { accessToken: 'enc' } });

        const restaurant = await getRestaurantCredentials('restaurant-1');

        expect(restaurant?._id).toEqual('restaurant-1');
    });

    it('publishes post successfully', async () => {
        const postDocument = {
            _id: 'post-1',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'Caption',
            thumbnail: 'https://example.com/photo.jpg',
            platforms: ['INSTAGRAM'],
            publishAttempts: 0
        };

        mockRestaurantFindOne.mockResolvedValue({
            _id: 'restaurant-1',
            instagramCredentials: {
                userId: 'ig-user',
                pageId: 'page-id',
                accessToken: 'encrypted-token'
            }
        });

        mockPublishPost.mockResolvedValue({
            instagram: { success: true, instagramMediaId: 'media-1', retryable: false }
        });

        const published = await processPostForPublishing(postDocument);

        expect(published).toBe(true);
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { _id: 'post-1' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'POSTED',
                    instagramMediaId: 'media-1'
                })
            })
        );
    });

    it('keeps post scheduled for retryable failures', async () => {
        const postDocument = {
            _id: 'post-2',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'Caption',
            thumbnail: 'https://example.com/photo.jpg',
            platforms: ['INSTAGRAM'],
            publishAttempts: 0
        };

        mockRestaurantFindOne.mockResolvedValue({
            _id: 'restaurant-1',
            instagramCredentials: {
                userId: 'ig-user',
                pageId: 'page-id',
                accessToken: 'encrypted-token'
            }
        });

        mockPublishPost.mockResolvedValue({
            instagram: { success: false, error: 'Rate limit', retryable: true }
        });

        const published = await processPostForPublishing(postDocument);

        expect(published).toBe(false);
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { _id: 'post-2' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'SCHEDULED'
                })
            })
        );
    });

    it('fails permanently on non-retryable failures', async () => {
        const postDocument = {
            _id: 'post-3',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'Caption',
            thumbnail: 'https://example.com/photo.jpg',
            platforms: ['INSTAGRAM'],
            publishAttempts: 0
        };

        mockRestaurantFindOne.mockResolvedValue({
            _id: 'restaurant-1',
            instagramCredentials: {
                userId: 'ig-user',
                pageId: 'page-id',
                accessToken: 'encrypted-token'
            }
        });

        mockPublishPost.mockResolvedValue({
            instagram: { success: false, error: 'Bad request', retryable: false }
        });

        const published = await processPostForPublishing(postDocument);

        expect(published).toBe(false);
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { _id: 'post-3' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'MISSED_DEADLINE'
                })
            })
        );
    });

    it('skips processing when atomic status lock fails', async () => {
        const postDocument = {
            _id: 'post-lock-fail',
            restaurantId: 'restaurant-1',
            publishAttempts: 0
        };

        mockFindOneAndUpdate.mockResolvedValue(null);

        const processed = await processPostForPublishing(postDocument);

        expect(processed).toBe(false);
        expect(mockPublishPost).not.toHaveBeenCalled();
    });

    it('marks post as MISSED_DEADLINE when restaurantId is missing', async () => {
        const postDocument = {
            _id: 'post-no-restaurant',
            publishAttempts: 1
        };

        const processed = await processPostForPublishing(postDocument);

        expect(processed).toBe(false);
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { _id: 'post-no-restaurant' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'MISSED_DEADLINE',
                    publishError: 'No restaurant associated with this post'
                }),
                $inc: { publishAttempts: 1 }
            })
        );
    });

    it('increments attempts without MISSED_DEADLINE when credentials are missing before final attempt', async () => {
        const postDocument = {
            _id: 'post-no-creds',
            restaurantId: 'restaurant-2',
            platforms: ['INSTAGRAM'],
            publishAttempts: 1
        };

        mockRestaurantFindOne.mockResolvedValue(null);

        const processed = await processPostForPublishing(postDocument);

        expect(processed).toBe(false);
        const updatePayload = (mockUpdateOne.mock.calls[0] as any[])[1];
        expect(updatePayload.$set.publishError).toContain('Instagram not connected');
        expect(updatePayload.$set.status).toBeUndefined();
    });

    it('marks MISSED_DEADLINE when credentials are missing on final attempt', async () => {
        const postDocument = {
            _id: 'post-no-creds-final',
            restaurantId: 'restaurant-2',
            platforms: ['INSTAGRAM'],
            publishAttempts: 2
        };

        mockRestaurantFindOne.mockResolvedValue(null);

        const processed = await processPostForPublishing(postDocument);

        expect(processed).toBe(false);
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { _id: 'post-no-creds-final' },
            expect.objectContaining({
                $set: expect.objectContaining({ status: 'MISSED_DEADLINE' }),
                $inc: { publishAttempts: 1 }
            })
        );
    });

    it('keeps post scheduled when Facebook side fails with retryable error', async () => {
        const postDocument = {
            _id: 'post-facebook-retryable',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'Caption',
            thumbnail: 'https://example.com/photo.jpg',
            platforms: ['INSTAGRAM', 'FACEBOOK'],
            publishAttempts: 0
        };

        mockRestaurantFindOne.mockResolvedValue({
            _id: 'restaurant-1',
            instagramCredentials: {
                userId: 'ig-user',
                pageId: 'page-id',
                accessToken: 'encrypted-token'
            }
        });

        mockPublishPost.mockResolvedValue({
            instagram: { success: true, instagramMediaId: 'ig-id', retryable: false },
            facebook: { success: false, error: 'Rate limited', retryable: true }
        });

        const processed = await processPostForPublishing(postDocument);

        expect(processed).toBe(false);
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { _id: 'post-facebook-retryable' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'SCHEDULED',
                    publishError: expect.stringContaining('Facebook: Rate limited')
                })
            })
        );
    });

    it('combines instagram and facebook errors when both fail', async () => {
        const postDocument = {
            _id: 'post-both-fail',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'Caption',
            thumbnail: 'https://example.com/photo.jpg',
            platforms: ['INSTAGRAM', 'FACEBOOK'],
            publishAttempts: 2
        };

        mockRestaurantFindOne.mockResolvedValue({
            _id: 'restaurant-1',
            instagramCredentials: {
                userId: 'ig-user',
                pageId: 'page-id',
                accessToken: 'encrypted-token'
            }
        });

        mockPublishPost.mockResolvedValue({
            instagram: { success: false, error: 'IG failed', retryable: false },
            facebook: { success: false, error: 'FB failed', retryable: false }
        });

        const processed = await processPostForPublishing(postDocument);

        expect(processed).toBe(false);
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { _id: 'post-both-fail' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'MISSED_DEADLINE',
                    publishError: expect.stringContaining('Instagram: IG failed; Facebook: FB failed')
                })
            })
        );
    });

    it('returns recent attempts limited by requested size', async () => {
        mockRestaurantFindOne.mockResolvedValue({
            _id: 'restaurant-1',
            instagramCredentials: {
                userId: 'ig-user',
                pageId: 'page-id',
                accessToken: 'encrypted-token'
            }
        });

        mockPublishPost.mockResolvedValue({
            instagram: { success: true, instagramMediaId: 'media-1', retryable: false }
        });

        await processPostForPublishing({
            _id: 'post-attempt-1',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'One',
            thumbnail: 'https://example.com/one.jpg',
            platforms: ['INSTAGRAM'],
            publishAttempts: 0
        });

        await processPostForPublishing({
            _id: 'post-attempt-2',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'Two',
            thumbnail: 'https://example.com/two.jpg',
            platforms: ['INSTAGRAM'],
            publishAttempts: 0
        });

        const attempts = getRecentPublishAttempts(1);
        expect(attempts.length).toBe(1);
        expect(attempts[0].postId).toBe('post-attempt-2');
    });

    it('runs publishing job and aggregates stats', async () => {
        vi.useFakeTimers();

        const duePosts = [
            {
                _id: 'post-a',
                restaurantId: 'restaurant-1',
                type: 'IMAGE',
                caption: 'Caption A',
                thumbnail: 'https://example.com/a.jpg',
                platforms: ['INSTAGRAM'],
                publishAttempts: 0
            },
            {
                _id: 'post-b',
                restaurantId: 'restaurant-1',
                type: 'IMAGE',
                caption: 'Caption B',
                thumbnail: 'https://example.com/b.jpg',
                platforms: ['INSTAGRAM'],
                publishAttempts: 0
            }
        ];

        mockToArray.mockResolvedValue(duePosts);
        mockRestaurantFindOne.mockResolvedValue({
            _id: 'restaurant-1',
            instagramCredentials: {
                userId: 'ig-user',
                pageId: 'page-id',
                accessToken: 'encrypted-token'
            }
        });

        mockPublishPost
            .mockResolvedValueOnce({ instagram: { success: true, instagramMediaId: 'media-a', retryable: false } })
            .mockResolvedValueOnce({ instagram: { success: false, error: 'Failed', retryable: false } });

        const statsPromise = runPublishingJob();
        await vi.advanceTimersByTimeAsync(4000);
        const stats = await statsPromise;

        expect(stats).toEqual({ published: 1, failed: 1, skipped: 0 });

        vi.useRealTimers();
    });

    it('schedules cron and allows manual trigger', async () => {
        startPublishingCron();
        expect(mockSchedule).toHaveBeenCalledWith(
            '*/5 * * * *',
            expect.any(Function),
            expect.objectContaining({ timezone: 'Asia/Kolkata' })
        );

        mockToArray.mockResolvedValue([]);
        const stats = await triggerManualPublish();
        expect(stats).toEqual({ published: 0, failed: 0, skipped: 0 });
    });

    it('executes scheduled callback and handles processing errors', async () => {
        vi.useFakeTimers();
        const postDoc = {
            _id: 'post-cron-callback',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'Cron callback',
            thumbnail: 'https://example.com/callback.jpg',
            platforms: ['INSTAGRAM'],
            publishAttempts: 0
        };

        mockToArray.mockResolvedValue([postDoc]);
        mockFindOneAndUpdate.mockRejectedValueOnce(new Error('lock failed'));

        startPublishingCron();
        const callback = (mockSchedule.mock.calls[0] as any[])[1] as () => Promise<void>;

        const callbackPromise = callback();
        await vi.advanceTimersByTimeAsync(2000);
        await callbackPromise;

        vi.useRealTimers();
    });

    it('runs initial check in development mode', async () => {
        vi.useFakeTimers();
        const previousEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        mockToArray.mockResolvedValue([]);

        startPublishingCron();
        await vi.advanceTimersByTimeAsync(10000);

        expect(mockFind).toHaveBeenCalled();

        process.env.NODE_ENV = previousEnv;
        vi.useRealTimers();
    });
});
