import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';

// -- Mock Setup --

const mockToArray = vi.fn();
const mockSort = vi.fn<any>(() => ({ toArray: mockToArray }));
const mockFind = vi.fn<any>(() => ({ sort: mockSort }));
const mockFindOne = vi.fn();
const mockFindOneAndUpdate = vi.fn();
const mockUpdateOne = vi.fn();
const mockPostsCollection = {
    find: mockFind,
    findOne: mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate,
    updateOne: mockUpdateOne
};

const mockRestFindOne = vi.fn();
const mockRestaurantsCollection = {
    findOne: mockRestFindOne
};

const mockPublishPost = vi.fn();
const mockSchedule = vi.fn();

// Mock the DB connection module to return our mock collections
const mockGetPostsCollection = vi.fn(() => mockPostsCollection);
const mockGetRestaurantsCollection = vi.fn(() => mockRestaurantsCollection);

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        getPostsCollection: mockGetPostsCollection,
        getRestaurantsCollection: mockGetRestaurantsCollection
    };
});

// Mock modules before importing subject
vi.mock('../../../../packages/publishing/dist/publishing-service.js', () => ({
    publishPost: mockPublishPost
}));

vi.mock('node-cron', () => ({
    default: { schedule: mockSchedule }
}));

// Import subject
const {
    getPostsDueForPublishing,
    getRestaurantCredentials,
    processPostForPublishing,
    runPublishingJob,
    getRecentPublishAttempts,
    startPublishingCron,
    triggerManualPublish
} = await import('@restropulse/publishing');

describe('Publishing Cron Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockToArray.mockResolvedValue([]);
        mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
        // Mock findOneAndUpdate to return a successful update (the post doc)
        mockFindOneAndUpdate.mockResolvedValue({ _id: 'post-1', status: 'PUBLISHING' });
    });

    describe('getPostsDueForPublishing', () => {
        it('should query scheduled posts with scheduledFor in the past', async () => {
            mockToArray.mockResolvedValue([{ _id: 'p1', status: 'SCHEDULED' }]);

            const result = await getPostsDueForPublishing();

            expect(mockGetPostsCollection).toHaveBeenCalled();
            expect(mockFind).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'SCHEDULED',
                    scheduledFor: { $lte: expect.any(String) }
                })
            );
            expect(result).toHaveLength(1);
        });

        it('should return empty array when no posts are due', async () => {
            mockToArray.mockResolvedValue([]);

            const result = await getPostsDueForPublishing();

            expect(result).toHaveLength(0);
        });
    });

    describe('getRestaurantCredentials', () => {
        it('should find restaurant with Instagram credentials', async () => {
            const mockRestaurant = {
                _id: 'rest-1',
                instagramCredentials: {
                    userId: 'ig-123',
                    accessToken: 'encrypted-token'
                }
            };
            mockRestFindOne.mockResolvedValue(mockRestaurant);

            const result = await getRestaurantCredentials('rest-1');

            expect(result).toEqual(mockRestaurant);
            expect(mockRestFindOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: 'rest-1',
                    'instagramCredentials.accessToken': { $exists: true, $ne: null }
                })
            );
        });

        it('should return null when restaurant has no credentials', async () => {
            mockRestFindOne.mockResolvedValue(null);

            const result = await getRestaurantCredentials('rest-2');

            expect(result).toBeNull();
        });
    });

    describe('processPostForPublishing', () => {
        const mockPostDoc = {
            _id: 'post-1',
            restaurantId: 'rest-1',
            type: 'IMAGE',
            caption: 'Test post',
            thumbnail: 'https://example.com/img.jpg',
            platforms: ['INSTAGRAM'],
            publishAttempts: 0
        };

        const mockRestaurant = {
            _id: 'rest-1',
            instagramCredentials: {
                userId: 'ig-123',
                pageId: 'page-456',
                accessToken: 'encrypted-token'
            }
        };

        it('should publish a post successfully', async () => {
            mockRestFindOne.mockResolvedValue(mockRestaurant);
            mockPublishPost.mockResolvedValue({
                instagram: { success: true, instagramMediaId: 'media-999', retryable: false }
            });

            const result = await processPostForPublishing(mockPostDoc);

            expect(result).toBe(true);

            // Expect atomic status lock with findOneAndUpdate
            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: 'post-1',
                    status: 'SCHEDULED'
                }),
                expect.objectContaining({
                    $set: expect.objectContaining({ status: 'PUBLISHING' })
                }),
                expect.any(Object)
            );

            expect(mockPublishPost).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'post-1',
                    type: 'IMAGE',
                    caption: 'Test post'
                }),
                expect.objectContaining({
                    userId: 'ig-123',
                    pageId: 'page-456',
                    accessToken: 'encrypted-token'
                })
            );

            // Verify status update to POSTED
            expect(mockUpdateOne).toHaveBeenCalledWith(
                { _id: 'post-1' },
                expect.objectContaining({
                    $set: expect.objectContaining({
                        status: 'POSTED',
                        instagramMediaId: 'media-999'
                    })
                })
            );
        });

        it('should fail when post has no restaurantId', async () => {
            const postWithoutRestaurant = { _id: 'post-2', publishAttempts: 0 };

            const result = await processPostForPublishing(postWithoutRestaurant);

            expect(result).toBe(false);

            // Should still try atomic lock first
            expect(mockFindOneAndUpdate).toHaveBeenCalled();

            expect(mockUpdateOne).toHaveBeenCalledWith(
                { _id: 'post-2' },
                expect.objectContaining({
                    $set: expect.objectContaining({
                        status: 'MISSED_DEADLINE',
                        publishError: 'No restaurant associated with this post'
                    })
                })
            );
        });

        it('should fail when restaurant has no Instagram credentials', async () => {
            mockRestFindOne.mockResolvedValue(null);

            const result = await processPostForPublishing(mockPostDoc);

            expect(result).toBe(false);
            expect(mockPublishPost).not.toHaveBeenCalled();
        });

        it('should mark as MISSED_DEADLINE after max attempts with no credentials', async () => {
            mockRestFindOne.mockResolvedValue(null);
            const postWithMaxAttempts = { ...mockPostDoc, publishAttempts: 2 };

            const result = await processPostForPublishing(postWithMaxAttempts);

            expect(result).toBe(false);
            expect(mockUpdateOne).toHaveBeenCalledWith(
                { _id: 'post-1' },
                expect.objectContaining({
                    $set: expect.objectContaining({
                        status: 'MISSED_DEADLINE'
                    })
                })
            );
        });

        it('should handle retryable publishing failure', async () => {
            mockRestFindOne.mockResolvedValue(mockRestaurant);
            mockPublishPost.mockResolvedValue({
                instagram: { success: false, error: 'Rate limited', retryable: true }
            });

            const result = await processPostForPublishing(mockPostDoc);

            expect(result).toBe(false);

            // Should set status to SCHEDULED (retryable and not max attempts)
            const updateCall = mockUpdateOne.mock.calls[0] as any[];
            const setOps = updateCall[1].$set;
            expect(setOps.status).toBe('SCHEDULED');
            expect(setOps.publishError).toContain('Rate limited');
        });

        it('should mark as MISSED_DEADLINE on non-retryable failure', async () => {
            mockRestFindOne.mockResolvedValue(mockRestaurant);
            mockPublishPost.mockResolvedValue({
                instagram: { success: false, error: 'Invalid media', retryable: false }
            });

            const result = await processPostForPublishing(mockPostDoc);

            expect(result).toBe(false);
            expect(mockUpdateOne).toHaveBeenCalledWith(
                { _id: 'post-1' },
                expect.objectContaining({
                    $set: expect.objectContaining({
                        status: 'MISSED_DEADLINE'
                    })
                })
            );
        });

        it('should mark as MISSED_DEADLINE when max retries reached even if retryable', async () => {
            mockRestFindOne.mockResolvedValue(mockRestaurant);
            mockPublishPost.mockResolvedValue({
                instagram: { success: false, error: 'Rate limited', retryable: true }
            });

            const postAtMaxRetry = { ...mockPostDoc, publishAttempts: 2 };
            const result = await processPostForPublishing(postAtMaxRetry);

            expect(result).toBe(false);
            expect(mockUpdateOne).toHaveBeenCalledWith(
                { _id: 'post-1' },
                expect.objectContaining({
                    $set: expect.objectContaining({
                        status: 'MISSED_DEADLINE'
                    })
                })
            );
        });
    });

    describe('runPublishingJob', () => {
        it('should return zero stats when no posts are due', async () => {
            mockToArray.mockResolvedValue([]);

            const stats = await runPublishingJob();

            expect(stats).toEqual({ published: 0, failed: 0, skipped: 0 });
        });

        it('should process multiple posts', async () => {
            vi.useFakeTimers();

            const posts = [
                {
                    _id: 'p1',
                    restaurantId: 'r1',
                    type: 'IMAGE',
                    caption: 'Post 1',
                    thumbnail: 'https://example.com/1.jpg',
                    platforms: ['INSTAGRAM'],
                    publishAttempts: 0
                },
                {
                    _id: 'p2',
                    restaurantId: 'r1',
                    type: 'IMAGE',
                    caption: 'Post 2',
                    thumbnail: 'https://example.com/2.jpg',
                    platforms: ['INSTAGRAM'],
                    publishAttempts: 0
                }
            ];

            mockToArray.mockResolvedValue(posts);
            mockRestFindOne.mockResolvedValue({
                _id: 'r1',
                instagramCredentials: {
                    userId: 'ig-123',
                    pageId: 'page-456',
                    accessToken: 'enc-token'
                }
            });

            // First post succeeds, second fails (non-retryable)
            mockPublishPost
                .mockResolvedValueOnce({ instagram: { success: true, instagramMediaId: 'media-1', retryable: false } })
                .mockResolvedValueOnce({ instagram: { success: false, error: 'Failed', retryable: false } });

            const resultPromise = runPublishingJob();

            // Advance past the 2-second rate-limit delays between posts
            await vi.advanceTimersByTimeAsync(4000);

            const stats = await resultPromise;

            expect(stats.published).toBe(1);
            expect(stats.failed).toBe(1);

            vi.useRealTimers();
        });
    });

    describe('startPublishingCron', () => {
        it('should schedule cron job every 5 minutes', () => {
            startPublishingCron();

            expect(mockSchedule).toHaveBeenCalledWith(
                '*/5 * * * *',
                expect.any(Function),
                expect.objectContaining({ timezone: 'Asia/Kolkata' })
            );
        });
    });

    describe('getRecentPublishAttempts', () => {
        it('should return an array (initially empty)', () => {
            const attempts = getRecentPublishAttempts();
            expect(Array.isArray(attempts)).toBe(true);
        });
    });

    describe('triggerManualPublish', () => {
        it('should call runPublishingJob and return stats', async () => {
            mockToArray.mockResolvedValue([]);

            const stats = await triggerManualPublish();

            expect(stats).toEqual({ published: 0, failed: 0, skipped: 0 });
        });
    });
});
