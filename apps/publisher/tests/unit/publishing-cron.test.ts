import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockToArray = vi.fn();
const mockStaleToArray = vi.fn();
const mockSort = vi.fn<any>(() => ({ toArray: mockToArray }));
// find().sort().toArray() = due posts; find().toArray() = stale PUBLISHING posts
const mockFind = vi.fn<any>(() => ({ sort: mockSort, toArray: mockStaleToArray }));
const mockFindOneAndUpdate = vi.fn();
const mockUpdateOne = vi.fn();
const mockUpdateMany = vi.fn();

const mockPostsCollection = {
    find: mockFind,
    findOneAndUpdate: mockFindOneAndUpdate,
    updateOne: mockUpdateOne,
    updateMany: mockUpdateMany
};

const mockRestaurantFindOne = vi.fn();
const mockRestaurantUpdateOne = vi.fn();
const mockRestaurantsCollection = {
    findOne: mockRestaurantFindOne,
    updateOne: mockRestaurantUpdateOne
};

const mockFailureInsertOne = vi.fn();
const mockPublishFailuresCollection = { insertOne: mockFailureInsertOne };
const mockTrackEvent = vi.fn();

const mockPublishPost = vi.fn();
const mockSchedule = vi.fn();

vi.mock('@restropulse/db', () => ({
    getPostsCollection: vi.fn(() => mockPostsCollection),
    getRestaurantsCollection: vi.fn(() => mockRestaurantsCollection),
    getPublishFailuresCollection: vi.fn(() => mockPublishFailuresCollection),
    toApiFormat: vi.fn((value: unknown) => value),
    toObjectId: vi.fn((id: string) => id)
}));

vi.mock('../../../../packages/publishing/dist/publishing-service.js', () => ({
    publishPost: mockPublishPost
}));

vi.mock('@restropulse/telemetry/server', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    tracedCronJob: vi.fn((_name: string, fn: () => unknown) => fn()),
    trackEvent: mockTrackEvent
}));

vi.mock('node-cron', () => ({
    default: { schedule: mockSchedule }
}));

const {
    getPostsDueForPublishing,
    getRestaurantCredentials,
    processPostForPublishing,
    runPublishingJob,
    reapMissedScheduledPosts,
    reapStalePublishingPosts,
    nextRetryAt,
    PUBLISH_RETRY_BACKOFF_MINUTES,
    REAUTH_PUBLISH_ERROR,
    INTERRUPTED_PUBLISH_ERROR,
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
        mockUpdateMany.mockResolvedValue({ modifiedCount: 0 });
        mockStaleToArray.mockResolvedValue([]);
        mockRestaurantUpdateOne.mockResolvedValue({ modifiedCount: 1 });
        mockFailureInsertOne.mockResolvedValue({ insertedId: 'f1' });
    });

    it('gets due scheduled posts', async () => {
        mockToArray.mockResolvedValue([{ _id: 'p1', status: 'SCHEDULED' }]);

        const posts = await getPostsDueForPublishing();

        expect(posts).toHaveLength(1);
        expect(mockFind).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'SCHEDULED',
                scheduledFor: expect.objectContaining({ $lte: expect.any(String) })
            })
        );
    });

    it('includes a $gte grace-cutoff lower bound alongside the $lte upper bound', async () => {
        mockToArray.mockResolvedValue([]);

        await getPostsDueForPublishing();

        const filter = (mockFind.mock.calls[0] as any[])[0];
        expect(filter.scheduledFor).toEqual(
            expect.objectContaining({
                $lte: expect.any(String),
                $gte: expect.any(String)
            })
        );
        // Lower bound must be strictly before the upper bound.
        expect(new Date(filter.scheduledFor.$gte).getTime()).toBeLessThan(
            new Date(filter.scheduledFor.$lte).getTime()
        );
    });

    it('reaps SCHEDULED posts past the grace cutoff to MISSED_DEADLINE', async () => {
        mockUpdateMany.mockResolvedValue({ modifiedCount: 3 });

        const now = new Date('2026-04-19T12:00:00.000Z');
        const count = await reapMissedScheduledPosts(now);

        expect(count).toBe(3);
        expect(mockUpdateMany).toHaveBeenCalledTimes(1);
        const [filter, update] = mockUpdateMany.mock.calls[0] as any[];
        // Grace is 2h, so cutoff = now - 2h.
        expect(filter).toEqual({
            status: 'SCHEDULED',
            scheduledFor: { $lt: '2026-04-19T10:00:00.000Z' }
        });
        expect(update.$set.status).toBe('MISSED_DEADLINE');
        expect(update.$set.publishError).toBeUndefined();
    });

    it('reapMissedScheduledPosts returns 0 when nothing was reaped', async () => {
        mockUpdateMany.mockResolvedValue({ modifiedCount: 0 });

        const count = await reapMissedScheduledPosts(new Date('2026-04-19T12:00:00.000Z'));

        expect(count).toBe(0);
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
            platform: 'INSTAGRAM',
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
            success: true, externalPostId: 'media-1', retryable: false
        });

        const published = await processPostForPublishing(postDocument);

        expect(published).toBe(true);
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { _id: 'post-1' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'POSTED',
                    externalPostId: 'media-1'
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
            platform: 'INSTAGRAM',
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
            success: false, error: 'Rate limit', retryable: true
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
            platform: 'INSTAGRAM',
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
            success: false, error: 'Bad request', retryable: false
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
            platform: 'INSTAGRAM',
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
            platform: 'INSTAGRAM',
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

    it('keeps post scheduled when Facebook publish fails with retryable error', async () => {
        const postDocument = {
            _id: 'post-facebook-retryable',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'Caption',
            thumbnail: 'https://example.com/photo.jpg',
            platform: 'FACEBOOK',
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
            success: false, error: 'Rate limited', retryable: true
        });

        const processed = await processPostForPublishing(postDocument);

        expect(processed).toBe(false);
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { _id: 'post-facebook-retryable' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'SCHEDULED',
                    publishError: 'Rate limited'
                })
            })
        );
    });

    it('marks Facebook post permanently failed on non-retryable error', async () => {
        const postDocument = {
            _id: 'post-facebook-fail',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'Caption',
            thumbnail: 'https://example.com/photo.jpg',
            platform: 'FACEBOOK',
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
            success: false, error: 'FB failed', retryable: false
        });

        const processed = await processPostForPublishing(postDocument);

        expect(processed).toBe(false);
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { _id: 'post-facebook-fail' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'MISSED_DEADLINE',
                    publishError: 'FB failed'
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
            success: true, externalPostId: 'media-1', retryable: false
        });

        await processPostForPublishing({
            _id: 'post-attempt-1',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'One',
            thumbnail: 'https://example.com/one.jpg',
            platform: 'INSTAGRAM',
            publishAttempts: 0
        });

        await processPostForPublishing({
            _id: 'post-attempt-2',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'Two',
            thumbnail: 'https://example.com/two.jpg',
            platform: 'INSTAGRAM',
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
                platform: 'INSTAGRAM',
                publishAttempts: 0
            },
            {
                _id: 'post-b',
                restaurantId: 'restaurant-1',
                type: 'IMAGE',
                caption: 'Caption B',
                thumbnail: 'https://example.com/b.jpg',
                platform: 'INSTAGRAM',
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
            .mockResolvedValueOnce({ success: true, externalPostId: 'media-a', retryable: false })
            .mockResolvedValueOnce({ success: false, error: 'Failed', retryable: false });

        const statsPromise = runPublishingJob();
        await vi.advanceTimersByTimeAsync(4000);
        const stats = await statsPromise;

        expect(stats).toEqual({ published: 1, failed: 1, skipped: 0, missed: 0, interrupted: 0 });

        vi.useRealTimers();
    });

    it('includes reaped posts in the missed count via runPublishingJob', async () => {
        vi.useFakeTimers();
        mockUpdateMany.mockResolvedValue({ modifiedCount: 2 });
        mockToArray.mockResolvedValue([]);

        const statsPromise = runPublishingJob();
        await vi.advanceTimersByTimeAsync(1000);
        const stats = await statsPromise;

        expect(stats).toEqual({ published: 0, failed: 0, skipped: 0, missed: 2, interrupted: 0 });
        expect(mockUpdateMany).toHaveBeenCalledTimes(1);

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
        expect(stats).toEqual({ published: 0, failed: 0, skipped: 0, missed: 0, interrupted: 0 });
    });

    it('executes scheduled callback and handles processing errors', async () => {
        vi.useFakeTimers();
        const postDoc = {
            _id: 'post-cron-callback',
            restaurantId: 'restaurant-1',
            type: 'IMAGE',
            caption: 'Cron callback',
            thumbnail: 'https://example.com/callback.jpg',
            platform: 'INSTAGRAM',
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

    describe('retry backoff', () => {
        const creds = { _id: 'restaurant-1', instagramCredentials: { userId: 'ig-user', pageId: 'page-id', accessToken: 'enc' } };
        const post = (attempts: number) => ({ _id: 'post-b', restaurantId: 'restaurant-1', type: 'IMAGE', caption: 'c', thumbnail: 't', platform: 'INSTAGRAM', publishAttempts: attempts });

        it('computes the backoff from attempts already made', () => {
            const now = new Date('2026-11-24T10:00:00.000Z');
            expect(nextRetryAt(1, now).toISOString()).toBe('2026-11-24T10:05:00.000Z');
            expect(nextRetryAt(2, now).toISOString()).toBe('2026-11-24T10:20:00.000Z');
            // Clamped to the last step
            expect(nextRetryAt(9, now).getTime() - now.getTime()).toBe(PUBLISH_RETRY_BACKOFF_MINUTES.at(-1)! * 60_000);
            expect(nextRetryAt(0, now).toISOString()).toBe('2026-11-24T10:05:00.000Z');
        });

        it('sets nextPublishAttemptAt on a retryable failure', async () => {
            mockRestaurantFindOne.mockResolvedValue(creds);
            mockPublishPost.mockResolvedValue({ success: false, error: 'Rate limit', retryable: true, failureClass: 'retryable' });

            await processPostForPublishing(post(0));

            const [, update] = mockUpdateOne.mock.calls[0] as any[];
            expect(update.$set.status).toBe('SCHEDULED');
            expect(update.$set.nextPublishAttemptAt).toBeInstanceOf(Date);
            expect(update.$inc).toEqual({ publishAttempts: 1 });
            expect(mockFailureInsertOne).not.toHaveBeenCalled();
        });

        it('only picks up posts whose backoff has elapsed', async () => {
            await getPostsDueForPublishing();
            const filter = (mockFind.mock.calls[0] as any[])[0];
            const backoffClause = filter.$and[1].$or;
            expect(backoffClause).toEqual(expect.arrayContaining([
                { nextPublishAttemptAt: { $exists: false } },
                { nextPublishAttemptAt: { $lte: expect.any(Date) } }
            ]));
        });

        it('clears nextPublishAttemptAt on success', async () => {
            mockRestaurantFindOne.mockResolvedValue(creds);
            mockPublishPost.mockResolvedValue({ success: true, externalPostId: 'm1', retryable: false });

            await processPostForPublishing(post(1));

            const [, update] = mockUpdateOne.mock.calls[0] as any[];
            expect(update.$unset).toEqual({ nextPublishAttemptAt: '' });
        });
    });

    describe('dead-letter', () => {
        const creds = { _id: 'restaurant-1', instagramCredentials: { userId: 'ig-user', pageId: 'page-id', accessToken: 'enc' } };

        it('records a permanent failure with its class and emits an event', async () => {
            mockRestaurantFindOne.mockResolvedValue(creds);
            mockPublishPost.mockResolvedValue({ success: false, error: 'Bad media', errorCode: '36003', retryable: false, failureClass: 'permanent' });

            await processPostForPublishing({ _id: 'post-dl', restaurantId: 'restaurant-1', type: 'IMAGE', platform: 'INSTAGRAM', publishAttempts: 0 });

            expect(mockFailureInsertOne).toHaveBeenCalledWith(expect.objectContaining({
                postId: 'post-dl', restaurantId: 'restaurant-1', failureClass: 'permanent', errorCode: '36003', attempts: 1, error: 'Bad media'
            }));
            expect(mockTrackEvent).toHaveBeenCalledWith('post.publish_dead_lettered', expect.objectContaining({ failureClass: 'permanent' }));
        });

        it('records a retryable failure once attempts run out', async () => {
            mockRestaurantFindOne.mockResolvedValue(creds);
            mockPublishPost.mockResolvedValue({ success: false, error: 'Meta down', retryable: true, failureClass: 'retryable' });

            await processPostForPublishing({ _id: 'post-final', restaurantId: 'restaurant-1', type: 'IMAGE', platform: 'INSTAGRAM', publishAttempts: 2 });

            const [, update] = mockUpdateOne.mock.calls[0] as any[];
            expect(update.$set.status).toBe('MISSED_DEADLINE');
            expect(update.$unset).toEqual({ nextPublishAttemptAt: '' });
            expect(mockFailureInsertOne).toHaveBeenCalledWith(expect.objectContaining({ failureClass: 'retryable', attempts: 3 }));
        });

        it('does not throw when the dead-letter write fails', async () => {
            mockRestaurantFindOne.mockResolvedValue(creds);
            mockFailureInsertOne.mockRejectedValue(new Error('mongo down'));
            mockPublishPost.mockResolvedValue({ success: false, error: 'Bad', retryable: false });

            await expect(processPostForPublishing({ _id: 'p', restaurantId: 'restaurant-1', type: 'IMAGE', platform: 'INSTAGRAM' })).resolves.toBe(false);
        });
    });

    describe('reauth', () => {
        it('pauses the restaurant and keeps the post scheduled without spending an attempt', async () => {
            mockRestaurantFindOne.mockResolvedValue({ _id: 'restaurant-1', instagramCredentials: { userId: 'u', pageId: 'p', accessToken: 'enc' } });
            mockPublishPost.mockResolvedValue({ success: false, error: 'Error validating access token', errorCode: '190', retryable: false, failureClass: 'reauth' });

            const result = await processPostForPublishing({ _id: 'post-r', restaurantId: 'restaurant-1', type: 'IMAGE', platform: 'INSTAGRAM', publishAttempts: 1 });

            expect(result).toBe(false);
            const [restFilter, restUpdate] = mockRestaurantUpdateOne.mock.calls[0] as any[];
            expect(restFilter).toEqual(expect.objectContaining({ 'instagramCredentials.reauthRequiredAt': { $exists: false } }));
            expect(restUpdate.$set['instagramCredentials.reauthRequiredAt']).toBeInstanceOf(Date);
            expect(restUpdate.$set['instagramCredentials.reauthReason']).toBe('Error validating access token');

            const [, postUpdate] = mockUpdateOne.mock.calls[0] as any[];
            expect(postUpdate.$set).toEqual(expect.objectContaining({ status: 'SCHEDULED', publishError: REAUTH_PUBLISH_ERROR }));
            expect(postUpdate.$inc).toBeUndefined();
            expect(mockFailureInsertOne).not.toHaveBeenCalled();
            expect(mockTrackEvent).toHaveBeenCalledWith('integration.meta_reauth_required', expect.objectContaining({ restaurantId: 'restaurant-1' }));
        });

        it('skips publishing for a restaurant already flagged for reconnection', async () => {
            mockRestaurantFindOne.mockResolvedValue({ _id: 'restaurant-1', instagramCredentials: { userId: 'u', pageId: 'p', accessToken: 'enc', reauthRequiredAt: new Date() } });

            const result = await processPostForPublishing({ _id: 'post-paused', restaurantId: 'restaurant-1', platform: 'INSTAGRAM', publishAttempts: 0 });

            expect(result).toBe(false);
            expect(mockPublishPost).not.toHaveBeenCalled();
            const [, update] = mockUpdateOne.mock.calls[0] as any[];
            expect(update.$set.status).toBe('SCHEDULED');
            expect(update.$inc).toBeUndefined();
        });
    });

    describe('stale PUBLISHING reaper', () => {
        it('fails posts stuck in PUBLISHING without retrying them', async () => {
            const now = new Date('2026-11-24T12:00:00.000Z');
            mockStaleToArray.mockResolvedValue([{ _id: 'stuck-1', restaurantId: 'restaurant-1', platform: 'FACEBOOK', publishAttempts: 1 }]);

            const count = await reapStalePublishingPosts(now);

            expect(count).toBe(1);
            const findFilter = (mockFind.mock.calls[0] as any[])[0];
            expect(findFilter).toEqual({ status: 'PUBLISHING', updatedAt: { $lt: new Date('2026-11-24T11:30:00.000Z') } });
            const [filter, update] = mockUpdateOne.mock.calls[0] as any[];
            expect(filter).toEqual(expect.objectContaining({ _id: 'stuck-1', status: 'PUBLISHING' }));
            expect(update.$set).toEqual(expect.objectContaining({ status: 'MISSED_DEADLINE', publishError: INTERRUPTED_PUBLISH_ERROR }));
            expect(mockFailureInsertOne).toHaveBeenCalledWith(expect.objectContaining({ postId: 'stuck-1', failureClass: 'interrupted' }));
        });

        it('does not count a post another worker already moved', async () => {
            mockStaleToArray.mockResolvedValue([{ _id: 'stuck-2' }]);
            mockUpdateOne.mockResolvedValue({ modifiedCount: 0 });

            expect(await reapStalePublishingPosts()).toBe(0);
            expect(mockFailureInsertOne).not.toHaveBeenCalled();
        });

        it('runs as part of the publishing job', async () => {
            mockStaleToArray.mockResolvedValue([{ _id: 'stuck-3', restaurantId: 'r' }]);

            const stats = await runPublishingJob();

            expect(stats.interrupted).toBe(1);
        });
    });
});
