import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Define Mocks
const mockFindActiveSubscription = vi.fn();
const mockGetWeeklyPostCounts = vi.fn();
const mockGetDailyAdhocPostCounts = vi.fn();
const mockDeductCredits = vi.fn();
const mockCreatePost = vi.fn();
const mockFindAllPosts = vi.fn();
const mockFindPostById = vi.fn();
const mockUpdatePost = vi.fn();
const mockDeletePost = vi.fn();
const mockFindPostsByStatus = vi.fn();
const mockCreateInvoice = vi.fn();

vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        findActiveSubscription: mockFindActiveSubscription,
        getWeeklyPostCounts: mockGetWeeklyPostCounts,
        getDailyAdhocPostCounts: mockGetDailyAdhocPostCounts,
        deductCredits: mockDeductCredits,
        createPost: mockCreatePost,
        findAllPosts: mockFindAllPosts,
        findPostById: mockFindPostById,
        updatePost: mockUpdatePost,
        deletePost: mockDeletePost,
        findPostsByStatus: mockFindPostsByStatus,
        createInvoice: mockCreateInvoice,
    };
});

vi.mock('@restropulse/publishing', () => ({
    publishPost: vi.fn(),
    triggerManualPublish: vi.fn(),
    getRecentPublishAttempts: vi.fn(),
    startPublishingCron: vi.fn(),
}));

vi.mock('../../src/services/razorpay.js', () => ({
    createRazorpaySubscription: vi.fn(),
    cancelRazorpaySubscription: vi.fn(),
    createRazorpayOrder: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    verifyPaymentSignature: vi.fn(),
    getRazorpayKeyId: vi.fn().mockReturnValue('rzp_test_key'),
    createRazorpayOffer: vi.fn(),
    fetchRazorpayInvoice: vi.fn(),
    listRazorpayInvoices: vi.fn(),
}));

const { createTestApp, generateAuthToken } = await import('../helpers/testHelper.js');

const authToken = generateAuthToken();
const app = createTestApp();

const emptyCounts = () => ({
    INSTAGRAM: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0 },
    FACEBOOK: { IMAGE: 0, VIDEO: 0, STORY: 0, CAROUSEL: 0, REEL: 0 },
});

const growthLimits = {
    weekly: {
        INSTAGRAM: { IMAGE: 3, STORY: 3, CAROUSEL: 2, REEL: 2, VIDEO: 2 },
        FACEBOOK: { IMAGE: 3, CAROUSEL: 2, VIDEO: 2, STORY: 2 },
    },
};

describe('enforcePlanLimits Middleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetDailyAdhocPostCounts.mockResolvedValue(emptyCounts());
        mockCreatePost.mockResolvedValue({
            id: 'p-new', type: 'IMAGE', status: 'PENDING_APPROVAL',
            caption: 'Test', thumbnail: '/test.jpg', platforms: ['INSTAGRAM'],
            restaurantId: 'r1',
        });
    });

    describe('Active subscription within limits', () => {
        test('should allow post creation when within plan limits (single platform)', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: growthLimits },
            });
            mockGetWeeklyPostCounts.mockResolvedValue(emptyCounts());

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).not.toHaveBeenCalled();
        });

        test('should allow REEL when within reel limit', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: growthLimits },
            });
            const counts = emptyCounts();
            counts.INSTAGRAM.REEL = 1;
            mockGetWeeklyPostCounts.mockResolvedValue(counts);

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'REEL', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).not.toHaveBeenCalled();
        });

        test('should allow multi-platform post when within limits on BOTH', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: growthLimits },
            });
            mockGetWeeklyPostCounts.mockResolvedValue(emptyCounts());

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM', 'FACEBOOK'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).not.toHaveBeenCalled();
        });
    });

    describe('Over plan limits - uses credits', () => {
        test('should deduct credits when IMAGE exceeds plan limit on Instagram', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: growthLimits },
            });
            const counts = emptyCounts();
            counts.INSTAGRAM.IMAGE = 3; // at limit
            mockGetWeeklyPostCounts.mockResolvedValue(counts);

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).toHaveBeenCalledWith('sub-1', 1);
        });

        test('should deduct 4 credits for REEL when over limit', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: growthLimits },
            });
            const counts = emptyCounts();
            counts.INSTAGRAM.REEL = 2; // at limit
            mockGetWeeklyPostCounts.mockResolvedValue(counts);

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'REEL', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).toHaveBeenCalledWith('sub-1', 4);
        });

        test('should deduct 3 credits for CAROUSEL when over limit', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: growthLimits },
            });
            const counts = emptyCounts();
            counts.INSTAGRAM.CAROUSEL = 2; // at limit
            mockGetWeeklyPostCounts.mockResolvedValue(counts);

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'CAROUSEL', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).toHaveBeenCalledWith('sub-1', 3);
        });

        test('should use credits when over limit on Facebook only (multi-platform)', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: growthLimits },
            });
            const counts = emptyCounts();
            counts.FACEBOOK.IMAGE = 3; // Facebook at limit, Instagram still has room
            mockGetWeeklyPostCounts.mockResolvedValue(counts);

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM', 'FACEBOOK'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).toHaveBeenCalledWith('sub-1', 1);
        });

        test('should use credits when Facebook not in plan (Starter)', async () => {
            const starterLimits = {
                weekly: {
                    INSTAGRAM: { IMAGE: 2, STORY: 2, CAROUSEL: 1, REEL: 1, VIDEO: 1 },
                },
            };
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: starterLimits },
            });
            mockGetWeeklyPostCounts.mockResolvedValue(emptyCounts());

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['FACEBOOK'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).toHaveBeenCalledWith('sub-1', 1);
        });

        test('should use credits when REEL on Facebook (not in PLATFORM_POST_TYPES for FB)', async () => {
            // Facebook limits don't include REEL
            const fbNoReelLimits = {
                weekly: {
                    INSTAGRAM: { IMAGE: 3, REEL: 2 },
                    FACEBOOK: { IMAGE: 3, VIDEO: 2, STORY: 2 }, // no REEL
                },
            };
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: fbNoReelLimits },
            });
            mockGetWeeklyPostCounts.mockResolvedValue(emptyCounts());

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'REEL', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['FACEBOOK'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).toHaveBeenCalledWith('sub-1', 4);
        });
    });

    describe('No subscription or credits', () => {
        test('should return 403 when no subscription exists', async () => {
            mockFindActiveSubscription.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('No subscription found');
        });

        test('should return 403 when over limit and no credits', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 0,
                planSnapshot: { limits: growthLimits },
            });
            const counts = emptyCounts();
            counts.INSTAGRAM.IMAGE = 3;
            mockGetWeeklyPostCounts.mockResolvedValue(counts);

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(403);
            expect(res.body.creditsNeeded).toBe(1);
            expect(res.body.creditsAvailable).toBe(0);
        });

        test('should return 403 when REEL costs more credits than available', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 3,
                planSnapshot: { limits: growthLimits },
            });
            const counts = emptyCounts();
            counts.INSTAGRAM.REEL = 2; // at limit
            mockGetWeeklyPostCounts.mockResolvedValue(counts);

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'REEL', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(403);
            expect(res.body.creditsNeeded).toBe(4);
            expect(res.body.creditsAvailable).toBe(3);
        });
    });

    describe('No active plan (NONE/CANCELLED) - credits only', () => {
        test('should allow post creation with credits when status is NONE', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'NONE', credits: 20,
            });

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).toHaveBeenCalledWith('sub-1', 1);
        });

        test('should allow post creation with credits when status is CANCELLED', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'CANCELLED', credits: 5,
            });

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).toHaveBeenCalledWith('sub-1', 1);
        });
    });

    describe('PAST_DUE subscription', () => {
        test('should still check plan limits when status is PAST_DUE', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'PAST_DUE', credits: 5,
                planSnapshot: { limits: growthLimits },
            });
            mockGetWeeklyPostCounts.mockResolvedValue(emptyCounts());

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).not.toHaveBeenCalled();
        });
    });

    describe('Daily adhoc post limit', () => {
        const growthLimitsWithDailyAdhoc = {
            weekly: growthLimits.weekly,
            dailyAdhoc: {
                INSTAGRAM: { IMAGE: 2, STORY: 2, CAROUSEL: 1, REEL: 1, VIDEO: 1 },
            },
        };

        test('should allow adhoc post when within both weekly and daily adhoc limits', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: growthLimitsWithDailyAdhoc },
            });
            mockGetWeeklyPostCounts.mockResolvedValue(emptyCounts());
            const dailyCounts = emptyCounts();
            dailyCounts.INSTAGRAM.IMAGE = 1; // below dailyAdhoc limit of 2
            mockGetDailyAdhocPostCounts.mockResolvedValue(dailyCounts);

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).not.toHaveBeenCalled();
        });

        test('should fall back to credits when within weekly limit but at daily adhoc limit', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: growthLimitsWithDailyAdhoc },
            });
            mockGetWeeklyPostCounts.mockResolvedValue(emptyCounts()); // plenty of weekly room
            const dailyCounts = emptyCounts();
            dailyCounts.INSTAGRAM.IMAGE = 2; // at dailyAdhoc limit
            mockGetDailyAdhocPostCounts.mockResolvedValue(dailyCounts);

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(201);
            expect(mockDeductCredits).toHaveBeenCalledWith('sub-1', 1);
        });

        test('should not apply daily adhoc limit to strategy-generated posts', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: growthLimitsWithDailyAdhoc },
            });
            mockGetWeeklyPostCounts.mockResolvedValue(emptyCounts());
            const dailyCounts = emptyCounts();
            dailyCounts.INSTAGRAM.IMAGE = 2; // at dailyAdhoc limit -- should not matter here
            mockGetDailyAdhocPostCounts.mockResolvedValue(dailyCounts);

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'], strategyId: 'cycle-1',
                });

            expect(res.status).toBe(201);
            expect(mockGetDailyAdhocPostCounts).not.toHaveBeenCalled();
            expect(mockDeductCredits).not.toHaveBeenCalled();
        });

        test('should skip daily adhoc check entirely when plan has no dailyAdhoc limits configured', async () => {
            mockFindActiveSubscription.mockResolvedValue({
                id: 'sub-1', restaurantId: 'r1', status: 'ACTIVE', credits: 10,
                planSnapshot: { limits: growthLimits }, // no dailyAdhoc key
            });
            mockGetWeeklyPostCounts.mockResolvedValue(emptyCounts());

            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE', caption: 'Test', thumbnail: '/test.jpg',
                    platforms: ['INSTAGRAM'],
                });

            expect(res.status).toBe(201);
            expect(mockGetDailyAdhocPostCounts).not.toHaveBeenCalled();
            expect(mockDeductCredits).not.toHaveBeenCalled();
        });
    });
});
