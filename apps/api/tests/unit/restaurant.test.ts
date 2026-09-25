import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Define Mocks
const mockFindRestaurantById = vi.fn();
const mockCreateRestaurant = vi.fn();
const mockUpdateRestaurant = vi.fn();
const mockAddOffer = vi.fn();
const mockRemoveOffer = vi.fn();
const mockAddSpecial = vi.fn();
const mockRemoveSpecial = vi.fn();
const mockUpdateMenuTimestamp = vi.fn();
const mockFindRestaurantsWithInstagram = vi.fn();
const mockUpdateInstagramCredentials = vi.fn();
const mockRemoveInstagramCredentials = vi.fn();
const mockFindUserById = vi.fn();
const mockUpdateUser = vi.fn();
const mockGetAccountManagersByCityAndZone = vi.fn();
const mockCreateSubscription = vi.fn();

// Mock Module - keep real collection getters, override restaurant helper functions
vi.mock('@restropulse/db', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        findRestaurantById: mockFindRestaurantById,
        createRestaurant: mockCreateRestaurant,
        updateRestaurant: mockUpdateRestaurant,
        addOffer: mockAddOffer,
        removeOffer: mockRemoveOffer,
        addSpecial: mockAddSpecial,
        removeSpecial: mockRemoveSpecial,
        updateMenuTimestamp: mockUpdateMenuTimestamp,
        findRestaurantsWithInstagram: mockFindRestaurantsWithInstagram,
        updateInstagramCredentials: mockUpdateInstagramCredentials,
        removeInstagramCredentials: mockRemoveInstagramCredentials,
        findUserById: mockFindUserById,
        updateUser: mockUpdateUser,
        getAccountManagersByCityAndZone: mockGetAccountManagersByCityAndZone,
        createSubscription: mockCreateSubscription,
    };
});

// Import actual implementation using vi.importActual to get real implementations
let actualDb: any;

// Import Helpers
const { createTestApp, mockRestaurant, mockUser, generateAuthToken } = await import('../helpers/testHelper.js');
const { getRestaurantsCollection, getUsersCollection, getAccountManagersCollection } = await import('@restropulse/db');
const { generateTokens } = await import('../../src/services/jwt.js');

const authToken = generateAuthToken();

// Reset Helper
const useActualImplementation = async () => {
    if (!actualDb) {
        actualDb = await vi.importActual('@restropulse/db');
    }
    mockFindRestaurantById.mockImplementation(actualDb.findRestaurantById);
    mockCreateRestaurant.mockImplementation(actualDb.createRestaurant);
    mockUpdateRestaurant.mockImplementation(actualDb.updateRestaurant);
    mockAddOffer.mockImplementation(actualDb.addOffer);
    mockRemoveOffer.mockImplementation(actualDb.removeOffer);
    mockAddSpecial.mockImplementation(actualDb.addSpecial);
    mockRemoveSpecial.mockImplementation(actualDb.removeSpecial);
    mockUpdateMenuTimestamp.mockImplementation(actualDb.updateMenuTimestamp);
    mockFindRestaurantsWithInstagram.mockImplementation(actualDb.findRestaurantsWithInstagram);
    mockUpdateInstagramCredentials.mockImplementation(actualDb.updateInstagramCredentials);
    mockRemoveInstagramCredentials.mockImplementation(actualDb.removeInstagramCredentials);
    mockFindUserById.mockImplementation(actualDb.findUserById);
    mockUpdateUser.mockImplementation(actualDb.updateUser);
    mockGetAccountManagersByCityAndZone.mockImplementation(actualDb.getAccountManagersByCityAndZone);
    mockCreateSubscription.mockResolvedValue({ id: 'sub-test', restaurantId: '', status: 'NONE', credits: 20 });
};

const app = createTestApp();

describe('Restaurant Routes - Unit Tests', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await useActualImplementation();
        // Reset restaurant state in memory DB
        const col = getRestaurantsCollection();
        await col.updateOne(
            { _id: 'r1' as any },
            { $set: mockRestaurant },
            { upsert: true }
        );
    });

    describe('GET /api/restaurant/:id', () => {
        it('should get restaurant by valid ID', async () => {
            const response = await request(app)
                .get('/api/restaurant/r1');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toMatchObject({
                id: 'r1',
                name: mockRestaurant.name,
                cuisine: mockRestaurant.cuisine
            });
        });

        it('should return 404 for non-existent restaurant', async () => {
            const response = await request(app)
                .get('/api/restaurant/invalid-id');

            expect(response.status).toBe(404);
            expect(response.body).toHaveProperty('success', false);
            expect(response.body).toHaveProperty('error', 'Restaurant not found');
        });

        it('should return complete restaurant data structure', async () => {
            const response = await request(app)
                .get('/api/restaurant/r1');

            expect(response.body.data).toHaveProperty('location');
            expect(response.body.data).toHaveProperty('accountManager');
            expect(response.body.data).toHaveProperty('integrations');
        });

        it('should handle database error', async () => {
            mockFindRestaurantById.mockRejectedValue(new Error('DB Error'));

            const response = await request(app)
                .get('/api/restaurant/r1');

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error'
            });
        });
    });

    describe('PUT /api/restaurant/:id', () => {
        it('should update restaurant with valid data', async () => {
            const updateData = {
                name: 'Updated Restaurant Name',
                cuisine: 'Updated Cuisine'
            };

            const response = await request(app)
                .put('/api/restaurant/r1')
                .set('Authorization', `Bearer ${authToken}`)
                .send(updateData);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('success', true);
            expect(response.body.data.name).toBe(updateData.name);
            expect(response.body.data.cuisine).toBe(updateData.cuisine);
            expect(response.body.data.id).toBe('r1');
        });

        it('should return 403 when restaurantId does not match auth context', async () => {
            const response = await request(app)
                .put('/api/restaurant/invalid-id')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ name: 'Test' });

            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Forbidden');
        });

        it('should preserve ID when updating', async () => {
            const response = await request(app)
                .put('/api/restaurant/r1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ id: 'different-id', name: 'Test' });

            expect(response.body.data.id).toBe('r1');
        });

        it('should handle partial updates', async () => {
            const response = await request(app)
                .put('/api/restaurant/r1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ cuisine: 'Only Cuisine Update' });

            expect(response.status).toBe(200);
            expect(response.body.data.cuisine).toBe('Only Cuisine Update');
        });

        it('should handle database error', async () => {
            mockUpdateRestaurant.mockRejectedValue(new Error('Update Error'));

            const response = await request(app)
                .put('/api/restaurant/r1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ name: 'New Name' });

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error'
            });
        });
    });

    describe('PATCH /api/restaurant/:id/offers', () => {
        it('should delete offer as first action', async () => {
            // First get current offers
            const getResponse = await request(app)
                .get('/api/restaurant/r1');

            const offersCount = getResponse.body.data.activeOffers?.length || 0;

            if (offersCount > 0) {
                const response = await request(app)
                    .patch('/api/restaurant/r1/offers')
                    .set('Authorization', `Bearer ${authToken}`)
                    .send({
                        action: 'DELETE',
                        payload: 0
                    });

                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
            }
        });

        it('should add new offer', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'ADD',
                    payload: 'New Special Offer 50% Off'
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.activeOffers).toContain('New Special Offer 50% Off');
        });

        it('should delete offer by index', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'DELETE',
                    payload: 0
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body).toHaveProperty('message', 'Offers updated successfully');
        });

        it('should reject invalid action with 400 error', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'INVALID',
                    payload: 'test'
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Invalid action');
        });

        it('should reject missing payload for ADD with 400 error', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'ADD'
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('must be a string');
        });

        it('should reject non-string payload for ADD with 400 error', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'ADD',
                    payload: 123
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('must be a string');
        });

        it('should reject non-number payload for DELETE with 400 error', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'DELETE',
                    payload: 'not-a-number'
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('must be a number');
        });

        it('should handle ADD when offers array is empty', async () => {
            // First clear offers by updating restaurant
            await request(app)
                .put('/api/restaurant/r1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ activeOffers: null });

            const response = await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'ADD',
                    payload: 'First Offer'
                });

            expect(response.status).toBe(200);
            expect(response.body.data.activeOffers).toContain('First Offer');
        });

        it('should handle DELETE when offers array is empty', async () => {
            // First clear offers
            await request(app)
                .put('/api/restaurant/r1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ activeOffers: null });

            const response = await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'DELETE',
                    payload: 0
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        it('should return 403 when restaurantId does not match auth context', async () => {
            const response = await request(app)
                .patch('/api/restaurant/invalid-id/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'ADD', payload: 'New Offer' });

            expect(response.status).toBe(403);
            expect(response.body).toEqual({
                success: false,
                error: 'Forbidden'
            });
        });

        it('should handle database error during ADD', async () => {
            mockAddOffer.mockRejectedValue(new Error('DB Error'));

            const response = await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'ADD', payload: 'New Offer' });

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error'
            });
        });
    });

    describe('PATCH /api/restaurant/:id/specials', () => {
        it('should reject invalid action for specials with 400 error', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'INVALID',
                    payload: 'test'
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('Invalid action');
        });

        it('should add new chef special', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'ADD',
                    payload: 'Lobster Thermidor'
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.chefSpecials).toContain('Lobster Thermidor');
        });

        it('should delete chef special by index', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'DELETE',
                    payload: 0
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        it('should return updated restaurant data', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'ADD',
                    payload: 'Test Special'
                });

            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveProperty('chefSpecials');
        });

        it('should reject non-string payload for ADD special with 400 error', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'ADD',
                    payload: 456
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('must be a string');
        });

        it('should reject non-number payload for DELETE special with 400 error', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'DELETE',
                    payload: 'not-a-number'
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('must be a number');
        });

        it('should handle ADD when specials array is empty', async () => {
            // First clear specials
            await request(app)
                .put('/api/restaurant/r1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ chefSpecials: null });

            const response = await request(app)
                .patch('/api/restaurant/r1/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'ADD',
                    payload: 'First Special'
                });

            expect(response.status).toBe(200);
            expect(response.body.data.chefSpecials).toContain('First Special');
        });

        it('should handle DELETE when specials array is empty', async () => {
            // First clear specials
            await request(app)
                .put('/api/restaurant/r1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ chefSpecials: null });

            const response = await request(app)
                .patch('/api/restaurant/r1/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    action: 'DELETE',
                    payload: 0
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        it('should return 403 when restaurantId does not match auth context', async () => {
            const response = await request(app)
                .patch('/api/restaurant/invalid-id/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'ADD', payload: 'Special Dish' });

            expect(response.status).toBe(403);
            expect(response.body).toEqual({
                success: false,
                error: 'Forbidden'
            });
        });

        it('should handle database error during ADD', async () => {
            mockAddSpecial.mockRejectedValue(new Error('DB Error'));

            const response = await request(app)
                .patch('/api/restaurant/r1/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'ADD', payload: 'Special Dish' });

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error'
            });
        });
    });

    describe('PATCH /api/restaurant/:id/menu', () => {
        it('should update menu timestamp', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/menu')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.menuLastUpdated).toBeDefined();
            expect(response.body).toHaveProperty('message', 'Menu updated successfully');
        });

        it('should set current date as menu update date', async () => {
            const response = await request(app)
                .patch('/api/restaurant/r1/menu')
                .set('Authorization', `Bearer ${authToken}`);

            const today = new Date().toISOString().split('T')[0];
            expect(response.body.data.menuLastUpdated).toBe(today);
        });

        it('should return 403 when restaurantId does not match auth context', async () => {
            const response = await request(app)
                .patch('/api/restaurant/invalid-id/menu')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(403);
            expect(response.body).toEqual({
                success: false,
                error: 'Forbidden'
            });
        });

        it('should handle database error', async () => {
            mockUpdateMenuTimestamp.mockRejectedValue(new Error('DB Error'));

            const response = await request(app)
                .patch('/api/restaurant/r1/menu')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error'
            });
        });
    });

    describe('DB Helpers - Instagram Functions', () => {
        test('findRestaurantsWithInstagram should return restaurants with credentials', async () => {
            // Add Instagram credentials to r1
            const col = getRestaurantsCollection();
            await col.updateOne(
                { _id: 'r1' as any },
                {
                    $set: {
                        instagramCredentials: {
                            accessToken: 'encrypted_token',
                            userId: 'ig_user_123',
                            username: '@testrestaurant',
                            pageId: 'page_123',
                            instagramBusinessAccountId: 'ig_123',
                            scopes: ['instagram_basic', 'pages_read_engagement'],
                            connectedAt: new Date(),
                            tokenExpiresAt: new Date(Date.now() + 60 * 86400000)
                        }
                    }
                }
            );

            const result = await actualDb.findRestaurantsWithInstagram();

            expect(result).toBeInstanceOf(Array);
            expect(result.length).toBeGreaterThan(0);
            // toApiFormat transforms instagramCredentials to instagramConnection
            expect(result[0]).toHaveProperty('instagramConnection');
            expect(result[0].instagramConnection.username).toBe('@testrestaurant');
            expect(result[0].instagramConnection.connected).toBe(true);
        });

        test('findRestaurantsWithInstagram should not return restaurants without credentials', async () => {
            const col = getRestaurantsCollection();
            await col.updateOne(
                { _id: 'r1' as any },
                { $unset: { instagramCredentials: '' } }
            );

            const result = await actualDb.findRestaurantsWithInstagram();

            expect(result).toBeInstanceOf(Array);
            expect(result.length).toBe(0);
        });

        test('updateInstagramCredentials should set credentials', async () => {
            const credentials = {
                accessToken: 'encrypted_new_token',
                userId: 'ig_user_456',
                username: '@newrestaurant',
                pageId: 'page_456',
                instagramBusinessAccountId: 'ig_456',
                scopes: ['instagram_basic', 'instagram_content_publish'],
                connectedAt: new Date(),
                tokenExpiresAt: new Date(Date.now() + 60 * 86400000)
            };

            const result = await actualDb.updateInstagramCredentials('r1', credentials);

            expect(result).toBeTruthy();
            // toApiFormat transforms instagramCredentials to instagramConnection
            expect(result!.instagramConnection).toBeDefined();
            expect(result!.instagramConnection.username).toBe('@newrestaurant');
            expect(result!.integrations.instagram).toBe(true);
        });

        test('updateInstagramCredentials should return null for non-existent restaurant', async () => {
            const credentials = {
                accessToken: 'token',
                userId: 'user',
                username: '@test',
                pageId: 'page',
                instagramBusinessAccountId: 'ig',
                scopes: [],
                connectedAt: new Date(),
                tokenExpiresAt: new Date()
            };

            const result = await actualDb.updateInstagramCredentials('nonexistent', credentials);

            expect(result).toBeNull();
        });

        test('removeInstagramCredentials should unset credentials', async () => {
            // First add credentials
            const col = getRestaurantsCollection();
            await col.updateOne(
                { _id: 'r1' as any },
                {
                    $set: {
                        instagramCredentials: {
                            accessToken: 'encrypted_token',
                            userId: 'ig_user',
                            username: '@test',
                            pageId: 'page',
                            instagramBusinessAccountId: 'ig',
                            scopes: [],
                            connectedAt: new Date(),
                            tokenExpiresAt: new Date()
                        },
                        'integrations.instagram': true
                    }
                }
            );

            const result = await actualDb.removeInstagramCredentials('r1');

            expect(result).toBeTruthy();
            // toApiFormat removes instagramCredentials entirely when it doesn't exist
            expect(result!.instagramConnection).toBeUndefined();
            expect(result!.integrations.instagram).toBe(false);
        });

        test('removeInstagramCredentials should return null for non-existent restaurant', async () => {
            const result = await actualDb.removeInstagramCredentials('nonexistent');

            expect(result).toBeNull();
        });
    });

    describe('POST /api/restaurant (Onboarding)', () => {
        const newUserToken = (() => {
            const tokens = generateTokens('u-new', '+919000000000', '', 'OWNER');
            return tokens.accessToken;
        })();

        beforeEach(async () => {
            // Create a new user without a restaurant. emailVerified=true so the
            // onboarding endpoint accepts the request (B6: POST /restaurant now
            // requires the user to have verified their email first).
            const usersCol = getUsersCollection();
            await usersCol.updateOne(
                { _id: 'u-new' as any },
                {
                    $set: {
                        name: 'New User',
                        email: 'new@test.com',
                        emailVerified: true,
                        phone: '+919000000000',
                        role: 'OWNER',
                        restaurantId: '',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                },
                { upsert: true }
            );
        });

        it('should create restaurant with valid data', async () => {
            const response = await request(app)
                .post('/api/restaurant')
                .set('Authorization', `Bearer ${newUserToken}`)
                .send({
                    name: 'Test Restaurant',
                    cuisine: 'Italian',
                    userName: 'John Doe',
                    location: {
                        address: '1 Main St, Bangalore',
                        lat: 12.97,
                        lng: 77.59,
                        mapUrl: 'https://maps.google.com/test',
                    },
                    accountManager: {
                        name: 'Manager One',
                        phone: '+91 11111 22222',
                        email: 'mgr@test.com',
                        avatar: 'https://example.com/avatar.jpg',
                    },
                });

            expect(response.status).toBe(201);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toHaveProperty('restaurant');
            expect(response.body.data).toHaveProperty('token');
            expect(response.body.data).toHaveProperty('refreshToken');
            expect(response.body.data.restaurant.name).toBe('Test Restaurant');
            expect(response.body.data.restaurant.cuisine).toBe('Italian');
        });

        it('should create restaurant without embedded subscription (subscription is a separate collection)', async () => {
            const response = await request(app)
                .post('/api/restaurant')
                .set('Authorization', `Bearer ${newUserToken}`)
                .send({ name: 'Sub Test', cuisine: 'Thai' });

            expect(response.status).toBe(201);
            // Subscription is no longer embedded on the restaurant document
            expect(response.body.data.restaurant).not.toHaveProperty('subscription');
        });

        it('should set integrations.instagram to false by default', async () => {
            const response = await request(app)
                .post('/api/restaurant')
                .set('Authorization', `Bearer ${newUserToken}`)
                .send({ name: 'Integ Test', cuisine: 'Chinese' });

            expect(response.status).toBe(201);
            expect(response.body.data.restaurant.integrations.instagram).toBe(false);
        });

        it('should update userName when provided', async () => {
            await request(app)
                .post('/api/restaurant')
                .set('Authorization', `Bearer ${newUserToken}`)
                .send({ name: 'Name Test', cuisine: 'Indian', userName: 'Updated Name' });

            // Verify user was updated
            const usersCol = getUsersCollection();
            const user = await usersCol.findOne({ _id: 'u-new' as any });
            expect(user!.name).toBe('Updated Name');
        });

        it('should link restaurant to user', async () => {
            const response = await request(app)
                .post('/api/restaurant')
                .set('Authorization', `Bearer ${newUserToken}`)
                .send({ name: 'Link Test', cuisine: 'Japanese' });

            expect(response.status).toBe(201);
            const restaurantId = response.body.data.restaurant.id;

            const usersCol = getUsersCollection();
            const user = await usersCol.findOne({ _id: 'u-new' as any });
            expect(user!.restaurantId).toBe(restaurantId);
        });

        it('should use default location and accountManager when not provided', async () => {
            const response = await request(app)
                .post('/api/restaurant')
                .set('Authorization', `Bearer ${newUserToken}`)
                .send({ name: 'Minimal', cuisine: 'Mexican' });

            expect(response.status).toBe(201);
            expect(response.body.data.restaurant.location).toEqual({
                address: '', lat: 0, lng: 0, mapUrl: '',
            });
            expect(response.body.data.restaurant.accountManager).toEqual({
                name: '', phone: '', email: '', avatar: '',
            });
        });

        it('should return 400 when name is missing', async () => {
            const response = await request(app)
                .post('/api/restaurant')
                .set('Authorization', `Bearer ${newUserToken}`)
                .send({ cuisine: 'Italian' });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('name and cuisine are required');
        });

        it('should return 400 when cuisine is missing', async () => {
            const response = await request(app)
                .post('/api/restaurant')
                .set('Authorization', `Bearer ${newUserToken}`)
                .send({ name: 'Test' });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('name and cuisine are required');
        });

        it('should return 400 when user already has a restaurant', async () => {
            // Use the default auth token which has restaurantId 'r1'
            const response = await request(app)
                .post('/api/restaurant')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ name: 'Duplicate', cuisine: 'French' });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('already has a restaurant');
        });

        it('should return 404 when user is not found', async () => {
            mockFindUserById.mockResolvedValueOnce(null);

            const response = await request(app)
                .post('/api/restaurant')
                .set('Authorization', `Bearer ${newUserToken}`)
                .send({ name: 'Ghost', cuisine: 'Korean' });

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('User not found');
        });

        it('should return 401 without auth token', async () => {
            const response = await request(app)
                .post('/api/restaurant')
                .send({ name: 'No Auth', cuisine: 'Spanish' });

            expect(response.status).toBe(401);
        });

        it('should handle database error during creation', async () => {
            mockCreateRestaurant.mockRejectedValueOnce(new Error('DB write error'));

            const response = await request(app)
                .post('/api/restaurant')
                .set('Authorization', `Bearer ${newUserToken}`)
                .send({ name: 'Error Test', cuisine: 'Greek' });

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error',
            });
        });
    });

    describe('PUT /api/restaurant/:id - 404 path', () => {
        it('should return 404 when updateRestaurant returns null (restaurant not found)', async () => {
            mockUpdateRestaurant.mockResolvedValueOnce(null);

            const response = await request(app)
                .put('/api/restaurant/r1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ name: 'Ghost Restaurant' });

            expect(response.status).toBe(404);
            expect(response.body).toEqual({ success: false, error: 'Restaurant not found' });
        });
    });

    describe('PATCH /api/restaurant/:id/offers - 404 path', () => {
        it('should return 404 when removeOffer returns null (restaurant not found)', async () => {
            mockRemoveOffer.mockResolvedValueOnce(null);

            const response = await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'DELETE', payload: 0 });

            expect(response.status).toBe(404);
            expect(response.body).toEqual({ success: false, error: 'Restaurant not found' });
        });

        it('should return 404 when addOffer returns null (restaurant not found)', async () => {
            mockAddOffer.mockResolvedValueOnce(null);

            const response = await request(app)
                .patch('/api/restaurant/r1/offers')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'ADD', payload: 'Some Offer' });

            expect(response.status).toBe(404);
            expect(response.body).toEqual({ success: false, error: 'Restaurant not found' });
        });
    });

    describe('PATCH /api/restaurant/:id/specials - 404 path', () => {
        it('should return 404 when removeSpecial returns null (restaurant not found)', async () => {
            mockRemoveSpecial.mockResolvedValueOnce(null);

            const response = await request(app)
                .patch('/api/restaurant/r1/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'DELETE', payload: 0 });

            expect(response.status).toBe(404);
            expect(response.body).toEqual({ success: false, error: 'Restaurant not found' });
        });

        it('should return 404 when addSpecial returns null (restaurant not found)', async () => {
            mockAddSpecial.mockResolvedValueOnce(null);

            const response = await request(app)
                .patch('/api/restaurant/r1/specials')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ action: 'ADD', payload: 'Some Special' });

            expect(response.status).toBe(404);
            expect(response.body).toEqual({ success: false, error: 'Restaurant not found' });
        });
    });

    describe('PATCH /api/restaurant/:id/menu - 404 path', () => {
        it('should return 404 when updateMenuTimestamp returns null (restaurant not found)', async () => {
            mockUpdateMenuTimestamp.mockResolvedValueOnce(null);

            const response = await request(app)
                .patch('/api/restaurant/r1/menu')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(404);
            expect(response.body).toEqual({ success: false, error: 'Restaurant not found' });
        });
    });

    describe('GET /api/restaurant/account-managers', () => {
        beforeEach(async () => {
            const col = getAccountManagersCollection();
            await col.deleteMany({});
            await col.insertMany([
                {
                    _id: 'am1' as any,
                    name: 'Manager Alpha',
                    phone: '+91 11111 11111',
                    email: 'alpha@test.com',
                    avatar: 'https://example.com/a.jpg',
                    city: 'Bangalore',
                    zone: 'Indiranagar',
                },
                {
                    _id: 'am2' as any,
                    name: 'Manager Beta',
                    phone: '+91 22222 22222',
                    email: 'beta@test.com',
                    avatar: 'https://example.com/b.jpg',
                    city: 'Bangalore',
                    zone: 'Koramangala',
                },
                {
                    _id: 'am3' as any,
                    name: 'Manager Gamma',
                    phone: '+91 33333 33333',
                    email: 'gamma@test.com',
                    avatar: 'https://example.com/g.jpg',
                    city: 'Mumbai',
                    zone: 'Andheri',
                },
            ] as any);
        });

        it('should return managers filtered by city', async () => {
            const response = await request(app)
                .get('/api/restaurant/account-managers?city=Bangalore')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toHaveLength(2);
            expect(response.body.data.every((m: any) => m.city === 'Bangalore')).toBe(true);
        });

        it('should filter by city and zone', async () => {
            const response = await request(app)
                .get('/api/restaurant/account-managers?city=Bangalore&zone=Indiranagar')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveLength(1);
            expect(response.body.data[0].name).toBe('Manager Alpha');
        });

        it('should return empty array for unknown city', async () => {
            const response = await request(app)
                .get('/api/restaurant/account-managers?city=UnknownCity')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toHaveLength(0);
        });

        it('should be case-insensitive for city match', async () => {
            const response = await request(app)
                .get('/api/restaurant/account-managers?city=bangalore')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveLength(2);
        });

        it('should return 400 when city parameter is missing', async () => {
            const response = await request(app)
                .get('/api/restaurant/account-managers')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.error).toContain('City query parameter is required');
        });

        it('should return 401 without auth token', async () => {
            const response = await request(app)
                .get('/api/restaurant/account-managers?city=Bangalore');

            expect(response.status).toBe(401);
        });

        it('should return manager data with correct shape', async () => {
            const response = await request(app)
                .get('/api/restaurant/account-managers?city=Mumbai')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveLength(1);
            const manager = response.body.data[0];
            expect(manager).toHaveProperty('id');
            expect(manager).toHaveProperty('name', 'Manager Gamma');
            expect(manager).toHaveProperty('phone');
            expect(manager).toHaveProperty('email');
            expect(manager).toHaveProperty('avatar');
            expect(manager).toHaveProperty('city', 'Mumbai');
            expect(manager).toHaveProperty('zone', 'Andheri');
        });

        it('should handle database error', async () => {
            mockGetAccountManagersByCityAndZone.mockRejectedValueOnce(new Error('DB Error'));

            const response = await request(app)
                .get('/api/restaurant/account-managers?city=Bangalore')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: 'Internal server error',
            });
        });
    });
});
