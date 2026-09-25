import { describe, test, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, generateAuthToken } from '../helpers/testHelper.js';

const app = createTestApp();
const authToken = generateAuthToken();

describe('Integration Tests - Complete Workflows', () => {
    describe('User Authentication Flow', () => {
        it('should complete full login-session-logout flow', async () => {
            // 1. Login
            const loginResponse = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'arjun@spicelounge.com',
                    password: 'demo123'
                });

            expect(loginResponse.status).toBe(200);
            expect(loginResponse.body.success).toBe(true);
            const token = loginResponse.body.token;

            // 2. Check session with token
            const sessionResponse = await request(app)
                .get('/api/auth/session')
                .set('Authorization', `Bearer ${token}`);

            expect(sessionResponse.status).toBe(200);
            expect(sessionResponse.body.success).toBe(true);

            // 3. Logout
            const logoutResponse = await request(app)
                .post('/api/auth/logout');

            expect(logoutResponse.status).toBe(200);
            expect(logoutResponse.body.success).toBe(true);
        });

        it('should fail to access protected routes without auth', async () => {
            const response = await request(app)
                .get('/api/auth/session');

            expect(response.status).toBe(401);
        });
    });

    describe('Restaurant Management Flow', () => {
        it('should complete CRUD operations on restaurant', async () => {
            // 1. Get initial restaurant data (public)
            const getResponse = await request(app)
                .get('/api/restaurant/r1');

            expect(getResponse.status).toBe(200);

            // 2. Update restaurant
            const updateResponse = await request(app)
                .put('/api/restaurant/r1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ name: 'Updated Restaurant' });

            expect(updateResponse.status).toBe(200);
            expect(updateResponse.body.data.name).toBe('Updated Restaurant');

            // 3. Add offer
            const offerResponse = await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'ADD', payload: 'New Offer' });

            expect(offerResponse.status).toBe(200);
            expect(offerResponse.body.data.activeOffers).toContain('New Offer');

            // 4. Add chef special
            const specialResponse = await request(app)
                .patch('/api/restaurant/r1/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'ADD', payload: 'New Special' });

            expect(specialResponse.status).toBe(200);
            expect(specialResponse.body.data.chefSpecials).toContain('New Special');

            // 5. Update menu
            const menuResponse = await request(app)
                .patch('/api/restaurant/r1/menu')
                .set('Authorization', `Bearer ${authToken}`);

            expect(menuResponse.status).toBe(200);
            expect(menuResponse.body.data.menuLastUpdated).toBeDefined();
        });

        it('should manage multiple offers lifecycle', async () => {
            // Get initial count (public)
            const initialResponse = await request(app)
                .get('/api/restaurant/r1');
            const initialCount = initialResponse.body.data.activeOffers?.length || 0;

            // Add multiple offers
            await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'ADD', payload: 'Offer 1' });

            await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'ADD', payload: 'Offer 2' });

            const getResponse = await request(app)
                .get('/api/restaurant/r1');

            expect(getResponse.body.data.activeOffers.length).toBe(initialCount + 2);

            // Delete one offer
            await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'DELETE', payload: 0 });

            const afterDeleteResponse = await request(app)
                .get('/api/restaurant/r1');

            expect(afterDeleteResponse.body.data.activeOffers.length).toBe(initialCount + 1);
        });
    });

    describe('Posts Management Flow', () => {
        it('should complete full post lifecycle', async () => {
            // 1. Create post
            const createResponse = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE',
                    status: 'PENDING_APPROVAL',
                    thumbnail: '/it.jpg',
                    caption: 'Test Post',
                    platforms: ['INSTAGRAM']
                });

            expect(createResponse.status).toBe(201);
            const postId = createResponse.body.data[0].id;

            // 2. Get the created post
            const getResponse = await request(app)
                .get(`/api/posts/${postId}`);

            expect(getResponse.status).toBe(200);
            expect(getResponse.body.data.caption).toBe('Test Post');

            // 3. Update the post
            const updateResponse = await request(app)
                .put(`/api/posts/${postId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    caption: 'Updated Caption',
                    status: 'APPROVED'
                });

            expect(updateResponse.status).toBe(200);
            expect(updateResponse.body.data.caption).toBe('Updated Caption');

            // 4. Delete the post
            const deleteResponse = await request(app)
                .delete(`/api/posts/${postId}`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(deleteResponse.status).toBe(200);

            // 5. Verify deletion
            const verifyResponse = await request(app)
                .get(`/api/posts/${postId}`);

            expect(verifyResponse.status).toBe(404);
        });

        it('should handle post approval workflow', async () => {
            // Create pending post
            const createResponse = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'CAROUSEL',
                    status: 'PENDING_APPROVAL',
                    thumbnail: '/carousel.jpg',
                    caption: 'Pending Post',
                    platforms: ['FACEBOOK']
                });

            const postId = createResponse.body.data[0].id;

            // Request changes
            await request(app)
                .put(`/api/posts/${postId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    status: 'CHANGES_REQUESTED',
                    feedback: JSON.stringify({ note: 'Please improve caption' })
                });

            let getResponse = await request(app)
                .get(`/api/posts/${postId}`);

            expect(getResponse.body.data.status).toBe('CHANGES_REQUESTED');

            // Resubmit for approval
            await request(app)
                .put(`/api/posts/${postId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    caption: 'Improved Caption',
                    status: 'PENDING_APPROVAL'
                });

            // Approve
            await request(app)
                .put(`/api/posts/${postId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({ status: 'SCHEDULED' });

            getResponse = await request(app)
                .get(`/api/posts/${postId}`);

            expect(getResponse.body.data.status).toBe('SCHEDULED');
        });

        it('should get all posts and filter results', async () => {
            // Create multiple posts
            await request(app).post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE',
                    status: 'POSTED',
                    thumbnail: '/img1.jpg',
                    caption: 'Posted Image',
                    platforms: ['INSTAGRAM']
                });

            await request(app).post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'VIDEO',
                    status: 'SCHEDULED',
                    thumbnail: '/vid1.jpg',
                    caption: 'Scheduled Video',
                    platforms: ['FACEBOOK']
                });

            const response = await request(app)
                .get('/api/posts')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Strategy Management Flow', () => {
        it('should manage content strategy and cycles', async () => {
            // 1. Get current strategy
            const strategyResponse = await request(app)
                .get('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`);

            expect(strategyResponse.status).toBe(200);

            // 2. Update strategy
            const updateStrategyResponse = await request(app)
                .put('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    postsPerWeek: 8,
                    focusCategories: ['Videos', 'Stories']
                });

            expect(updateStrategyResponse.status).toBe(200);
            expect(updateStrategyResponse.body.data.postsPerWeek).toBe(8);

            // 3. Create new cycle
            const createCycleResponse = await request(app)
                .post('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    period: 'Integration Test Cycle',
                    startDate: '2024-06-01',
                    endDate: '2024-06-30',
                    status: 'PENDING_APPROVAL',
                    summary: 'Test cycle for integration',
                    plannedPosts: [{ category: 'Test', count: 5 }],
                    focus: ['Testing']
                });

            expect(createCycleResponse.status).toBe(201);
            const cycleId = createCycleResponse.body.data.id;

            // 4. Update cycle status
            const updateCycleResponse = await request(app)
                .put(`/api/strategy/cycles/${cycleId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({ status: 'APPROVED' });

            expect(updateCycleResponse.status).toBe(200);
            expect(updateCycleResponse.body.data.status).toBe('APPROVED');

            // 5. Get all cycles
            const cyclesResponse = await request(app)
                .get('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`);

            expect(cyclesResponse.status).toBe(200);
            expect(cyclesResponse.body.data.length).toBeGreaterThanOrEqual(1);
        });

        it('should handle cycle approval workflow', async () => {
            // Use a future startDate so the deadline-enforcement guard in PUT
            // /api/strategy/cycles/:id does not reject the CHANGES_REQUESTED
            // transition (cycle buffer is 48h before startDate).
            const futureStart = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            const futureEnd = new Date(futureStart.getTime() + 30 * 24 * 60 * 60 * 1000);

            // Create cycle
            const createResponse = await request(app)
                .post('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    period: 'Approval Test',
                    startDate: futureStart.toISOString(),
                    endDate: futureEnd.toISOString(),
                    status: 'PENDING_APPROVAL',
                    summary: 'Needs approval',
                    plannedPosts: [],
                    focus: []
                });

            const cycleId = createResponse.body.data.id;

            // Request changes
            await request(app)
                .put(`/api/strategy/cycles/${cycleId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    status: 'CHANGES_REQUESTED',
                    feedback: 'Please add more content'
                });

            let getResponse = await request(app)
                .get(`/api/strategy/cycles/${cycleId}`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(getResponse.body.data.status).toBe('CHANGES_REQUESTED');

            // Update and resubmit
            await request(app)
                .put(`/api/strategy/cycles/${cycleId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    summary: 'Updated with more content',
                    plannedPosts: [
                        { category: 'Images', count: 10 },
                        { category: 'Videos', count: 5 }
                    ],
                    status: 'PENDING_APPROVAL'
                });

            // Approve
            await request(app)
                .put(`/api/strategy/cycles/${cycleId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({ status: 'APPROVED' });

            getResponse = await request(app)
                .get(`/api/strategy/cycles/${cycleId}`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(getResponse.body.data.status).toBe('APPROVED');
        });
    });

    describe('Cross-Entity Integration', () => {
        it('should coordinate restaurant updates with content strategy', async () => {
            // Update restaurant offers
            await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'ADD', payload: 'Summer Sale 30% Off' });

            // Create post about the offer
            const postResponse = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    type: 'IMAGE',
                    status: 'SCHEDULED',
                    thumbnail: '/sale.jpg',
                    caption: 'Summer Sale is here! 30% Off on all items',
                    platforms: ['INSTAGRAM', 'FACEBOOK']
                });

            expect(postResponse.status).toBe(201);

            // Update strategy to reflect campaign
            const strategyResponse = await request(app)
                .put('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    theme: 'Summer Sale Campaign',
                    focusCategories: ['Promotions', 'Offers']
                });

            expect(strategyResponse.status).toBe(200);
        });

        it('should handle concurrent operations', async () => {
            // Simulate multiple concurrent requests
            const promises = [
                request(app).get('/api/posts').set('Authorization', `Bearer ${authToken}`),
                request(app).get('/api/restaurant/r1'),
                request(app).get('/api/strategy').set('Authorization', `Bearer ${authToken}`),
                request(app).get('/api/strategy/cycles').set('Authorization', `Bearer ${authToken}`)
            ];

            const responses = await Promise.all(promises);

            responses.forEach(response => {
                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
            });
        });
    });

    describe('Error Handling Integration', () => {
        it('should handle invalid routes gracefully', async () => {
            const response = await request(app)
                .get('/api/invalid/route');

            expect(response.status).toBe(404);
        });

        it('should handle malformed JSON', async () => {
            const response = await request(app)
                .post('/api/posts')
                .set('Content-Type', 'application/json')
                .send('{"invalid": json}');

            expect(response.status).toBeGreaterThanOrEqual(400);
        });

        it('should validate required fields', async () => {
            // Posts now require a caption - sending empty body should return 400
            const response = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${authToken}`)
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Caption is required');
        });
    });

    describe('Health Check Integration', () => {
        it('should respond to health check', async () => {
            const response = await request(app)
                .get('/health');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status', 'ok');
            expect(response.body).toHaveProperty('timestamp');
        });
    });
});
