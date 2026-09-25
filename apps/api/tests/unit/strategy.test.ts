import { describe, it, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Define Mock Functions
const mockFindContentStrategy = vi.fn();
const mockUpdateContentStrategy = vi.fn();
const mockFindAllCycles = vi.fn();
const mockFindCycleById = vi.fn();
const mockCreateCycle = vi.fn();
const mockUpdateCycle = vi.fn();

// Mock the module - keep real collection getters, override strategy helper functions
vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        findContentStrategy: mockFindContentStrategy,
        updateContentStrategy: mockUpdateContentStrategy,
        findAllCycles: mockFindAllCycles,
        findCycleById: mockFindCycleById,
        createCycle: mockCreateCycle,
        updateCycle: mockUpdateCycle
    };
});

// Import actual implementation using vi.importActual to get real implementations
let actualStrategyDb: any;

// Helper to reset to actual implementation
const useActualImplementation = async () => {
    if (!actualStrategyDb) {
        actualStrategyDb = await vi.importActual('@restropulse/db');
    }
    mockFindContentStrategy.mockImplementation(actualStrategyDb.findContentStrategy);
    mockUpdateContentStrategy.mockImplementation(actualStrategyDb.updateContentStrategy);
    mockFindAllCycles.mockImplementation(actualStrategyDb.findAllCycles);
    mockFindCycleById.mockImplementation(actualStrategyDb.findCycleById);
    mockCreateCycle.mockImplementation(actualStrategyDb.createCycle);
    mockUpdateCycle.mockImplementation(actualStrategyDb.updateCycle);
};

// Dynamic Import of Test Helper
const { createTestApp, mockStrategyCycle, generateAuthToken } = await import('../helpers/testHelper.js');

const app = createTestApp();
const authToken = generateAuthToken();

describe('Strategy Routes - Unit Tests', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await useActualImplementation();
    });

    describe('GET /api/strategy', () => {
        it('should get content strategy', async () => {
            const response = await request(app)
                .get('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('data');
        });

        it('should return strategy with correct structure', async () => {
            const response = await request(app)
                .get('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.body.data).toHaveProperty('postsPerWeek');
            expect(response.body.data).toHaveProperty('focusCategories');
            expect(response.body.data).toHaveProperty('bestTime');
            expect(response.body.data).toHaveProperty('theme');
        });

        it('should return array for focusCategories', async () => {
            const response = await request(app)
                .get('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`);

            expect(Array.isArray(response.body.data.focusCategories)).toBe(true);
        });

        it('should handle database error', async () => {
            mockFindContentStrategy.mockRejectedValue(new Error('DB Error'));

            const response = await request(app)
                .get('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error'
            });
        });

        it('should return default strategy if none exists', async () => {
            mockFindContentStrategy.mockResolvedValue(null);

            const response = await request(app)
                .get('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.id).toBe('default');
            expect(response.body.data.postsPerWeek).toBe(5);
        });
    });

    describe('PUT /api/strategy', () => {
        it('should update content strategy', async () => {
            const updateData = {
                postsPerWeek: 7,
                theme: 'Updated Theme'
            };

            const response = await request(app)
                .put('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`)
                .send(updateData);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.postsPerWeek).toBe(7);
            expect(response.body.data.theme).toBe('Updated Theme');
        });

        it('should handle partial updates', async () => {
            const response = await request(app)
                .put('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ postsPerWeek: 10 });

            expect(response.status).toBe(200);
            expect(response.body.data.postsPerWeek).toBe(10);
        });

        it('should update focusCategories array', async () => {
            const newCategories = ['Videos', 'Stories', 'Reels'];
            const response = await request(app)
                .put('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ focusCategories: newCategories });

            expect(response.body.data.focusCategories).toEqual(newCategories);
        });

        it('should return success message', async () => {
            const response = await request(app)
                .put('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ bestTime: '7:00 PM - 9:00 PM' });

            expect(response.body).toHaveProperty('message', 'Content strategy updated successfully');
        });

        it('should handle database error', async () => {
            mockUpdateContentStrategy.mockRejectedValue(new Error('Update Error'));

            const response = await request(app)
                .put('/api/strategy')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ postsPerWeek: 5 });

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error'
            });
        });
    });

    describe('GET /api/strategy/cycles', () => {
        it('should get all strategy cycles', async () => {
            const response = await request(app)
                .get('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('success', true);
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        it('should return cycles with correct structure', async () => {
            const response = await request(app)
                .get('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`);

            if (response.body.data.length > 0) {
                const cycle = response.body.data[0];
                expect(cycle).toHaveProperty('id');
                expect(cycle).toHaveProperty('period');
                expect(cycle).toHaveProperty('status');
                expect(cycle).toHaveProperty('summary');
                expect(cycle).toHaveProperty('plannedPosts');
                expect(cycle).toHaveProperty('focus');
            }
        });

        it('should handle database error', async () => {
            mockFindAllCycles.mockRejectedValue(new Error('DB Error'));

            const response = await request(app)
                .get('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error'
            });
        });
    });

    describe('GET /api/strategy/cycles/:id', () => {
        it('should get cycle by valid ID', async () => {
            const response = await request(app)
                .get('/api/strategy/cycles/sc1')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('success', true);
            expect(response.body.data).toHaveProperty('id', 'sc1');
        });

        it('should return 404 for non-existent cycle', async () => {
            const response = await request(app)
                .get('/api/strategy/cycles/non-existent')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(404);
            expect(response.body).toHaveProperty('success', false);
            expect(response.body).toHaveProperty('error', 'Strategy cycle not found');
        });

        it('should return complete cycle data', async () => {
            const response = await request(app)
                .get('/api/strategy/cycles/sc1')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.body.data).toHaveProperty('startDate');
            expect(response.body.data).toHaveProperty('endDate');
            expect(response.body.data).toHaveProperty('plannedPosts');
            expect(Array.isArray(response.body.data.plannedPosts)).toBe(true);
        });

        it('should handle database error', async () => {
            mockFindCycleById.mockRejectedValue(new Error('DB Error'));

            const response = await request(app)
                .get('/api/strategy/cycles/123')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error'
            });
        });
    });

    describe('POST /api/strategy/cycles', () => {
        it('should create new strategy cycle', async () => {
            const newCycle = {
                period: 'July 2024',
                startDate: '2024-07-01',
                endDate: '2024-07-31',
                status: 'PENDING_APPROVAL',
                summary: 'New cycle for July',
                plannedPosts: [
                    { category: 'Images', count: 10 },
                    { category: 'Videos', count: 5 }
                ],
                focus: ['Summer Campaign', 'Outdoor Dining']
            };

            const response = await request(app)
                .post('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`)
                .send(newCycle);

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('success', true);
            expect(response.body.data).toHaveProperty('id');
            expect(response.body.data.period).toBe(newCycle.period);
            expect(response.body.data.summary).toBe(newCycle.summary);
        });

        it('should auto-generate ID for new cycle', async () => {
            const newCycle = {
                period: 'August 2024',
                startDate: '2024-08-01',
                endDate: '2024-08-31',
                status: 'ACTIVE',
                summary: 'August cycle',
                plannedPosts: [],
                focus: []
            };

            const response = await request(app)
                .post('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`)
                .send(newCycle);

            expect(response.body.data).toHaveProperty('id');
            // MongoDB generates ObjectId strings (24 hex chars)
            expect(response.body.data.id).toMatch(/^[a-f0-9]{24}$/);
        });

        it('should handle cycle with feedback', async () => {
            const newCycle = {
                period: 'September 2024',
                startDate: '2024-09-01',
                endDate: '2024-09-30',
                status: 'CHANGES_REQUESTED',
                summary: 'September cycle',
                plannedPosts: [],
                focus: [],
                feedback: 'Please add more video content'
            };

            const response = await request(app)
                .post('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`)
                .send(newCycle);

            expect(response.status).toBe(201);
            expect(response.body.data.feedback).toBe(newCycle.feedback);
        });

        it('should return success message', async () => {
            const newCycle = {
                period: 'Test Period',
                startDate: '2024-10-01',
                endDate: '2024-10-31',
                status: 'ACTIVE',
                summary: 'Test',
                plannedPosts: [],
                focus: []
            };

            const response = await request(app)
                .post('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`)
                .send(newCycle);

            expect(response.body).toHaveProperty('message', 'Strategy cycle created successfully');
        });

        it('should handle database error', async () => {
            mockCreateCycle.mockRejectedValue(new Error('Create Error'));

            const response = await request(app)
                .post('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    period: 'Test Period',
                    startDate: '2024-01-01',
                    endDate: '2024-01-31'
                });

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error'
            });
        });
    });

    describe('PUT /api/strategy/cycles/:id', () => {
        it('should update existing cycle', async () => {
            const updateData = {
                summary: 'Updated summary',
                status: 'APPROVED'
            };

            const response = await request(app)
                .put('/api/strategy/cycles/sc1')
                .set('Authorization', `Bearer ${authToken}`)
                .send(updateData);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.summary).toBe(updateData.summary);
            expect(response.body.data.status).toBe(updateData.status);
        });

        it('should return 404 for non-existent cycle', async () => {
            const response = await request(app)
                .put('/api/strategy/cycles/non-existent')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ summary: 'test' });

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });

        it('should preserve cycle ID when updating', async () => {
            const response = await request(app)
                .put('/api/strategy/cycles/sc1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ id: 'different-id', summary: 'test' });

            expect(response.body.data.id).toBe('sc1');
        });

        it('should update plannedPosts array', async () => {
            const newPlannedPosts = [
                { category: 'Stories', count: 20 },
                { category: 'Reels', count: 15 }
            ];

            const response = await request(app)
                .put('/api/strategy/cycles/sc1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ plannedPosts: newPlannedPosts });

            expect(response.body.data.plannedPosts).toEqual(newPlannedPosts);
        });

        it('should update focus array', async () => {
            const newFocus = ['New Focus 1', 'New Focus 2'];

            const response = await request(app)
                .put('/api/strategy/cycles/sc1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ focus: newFocus });

            expect(response.body.data.focus).toEqual(newFocus);
        });

        it('should handle feedback updates', async () => {
            const response = await request(app)
                .put('/api/strategy/cycles/sc1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ feedback: 'Looks great, approved!' });

            expect(response.body.data.feedback).toBe('Looks great, approved!');
        });

        it('should handle database error', async () => {
            mockUpdateCycle.mockRejectedValue(new Error('Update Error'));

            const response = await request(app)
                .put('/api/strategy/cycles/123')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ period: 'Updated Period' });

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error'
            });
        });

        it('should return 409 when marking CHANGES_REQUESTED past the approval deadline', async () => {
            // startDate 1h from now; buffer 48h -> deadline was 47h ago.
            const startDate = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
            mockFindCycleById.mockResolvedValueOnce({
                id: 'past-deadline-cycle',
                startDate,
                status: 'PENDING_APPROVAL',
                restaurantId: 'r1',
            } as any);

            const response = await request(app)
                .put('/api/strategy/cycles/past-deadline-cycle')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ status: 'CHANGES_REQUESTED' });

            expect(response.status).toBe(409);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toMatch(/deadline/i);
        });

        it('should allow CHANGES_REQUESTED when still within the approval window', async () => {
            // startDate 60 days out -> deadline is 58 days from now (still open).
            const startDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
            mockFindCycleById.mockResolvedValueOnce({
                id: 'open-cycle',
                startDate,
                status: 'PENDING_APPROVAL',
                restaurantId: 'r1',
            } as any);
            mockUpdateCycle.mockResolvedValueOnce({
                id: 'open-cycle',
                status: 'CHANGES_REQUESTED',
                startDate,
            } as any);

            const response = await request(app)
                .put('/api/strategy/cycles/open-cycle')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ status: 'CHANGES_REQUESTED' });

            expect(response.status).toBe(200);
            expect(response.body.data.status).toBe('CHANGES_REQUESTED');
        });

        it('should allow APPROVED transition past the deadline (no 409)', async () => {
            const startDate = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
            mockUpdateCycle.mockResolvedValueOnce({
                id: 'past-approve',
                status: 'APPROVED',
                startDate,
            } as any);

            const response = await request(app)
                .put('/api/strategy/cycles/past-approve')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ status: 'APPROVED' });

            expect(response.status).toBe(200);
            expect(response.body.data.status).toBe('APPROVED');
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty plannedPosts array', async () => {
            const newCycle = {
                period: 'Test',
                startDate: '2024-11-01',
                endDate: '2024-11-30',
                status: 'ACTIVE',
                summary: 'Test',
                plannedPosts: [],
                focus: []
            };

            const response = await request(app)
                .post('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`)
                .send(newCycle);

            expect(response.status).toBe(201);
            expect(response.body.data.plannedPosts).toEqual([]);
        });

        it('should handle empty focus array', async () => {
            const newCycle = {
                period: 'Test',
                startDate: '2024-11-01',
                endDate: '2024-11-30',
                status: 'ACTIVE',
                summary: 'Test',
                plannedPosts: [],
                focus: []
            };

            const response = await request(app)
                .post('/api/strategy/cycles')
                .set('Authorization', `Bearer ${authToken}`)
                .send(newCycle);

            expect(response.status).toBe(201);
            expect(response.body.data.focus).toEqual([]);
        });
    });
});
