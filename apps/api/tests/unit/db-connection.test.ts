import { describe, it, expect, afterEach } from 'vitest';
import {
    getConfig,
    getUsersCollection,
    getRestaurantsCollection,
    getPostsCollection,
    getStrategyCyclesCollection,
    getContentStrategiesCollection,
    getSessionsCollection,
    toApiFormat,
    toObjectId
} from '@restropulse/db';
import { ObjectId } from 'mongodb';

/**
 * DB Connection Tests
 * 
 * NOTE: These tests run against mongodb-memory-server (real MongoDB instance).
 * The connection is established in tests/setup.ts before all tests run.
 * We test the utility functions and collection accessors here.
 */
describe('DB Connection', () => {
    const ORIGINAL_ENV = process.env;

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    describe('getConfig', () => {
        it('should throw if URI not set', () => {
            const originalUri = process.env.MONGODB_URI;
            delete process.env.MONGODB_URI;

            expect(() => getConfig()).toThrow('MONGODB_URI environment variable is not set');

            process.env.MONGODB_URI = originalUri;
        });

        it('should return config with URI and database', () => {
            const config = getConfig();
            expect(config.uri).toBeDefined();
            expect(config.database).toBeDefined();
            expect(typeof config.uri).toBe('string');
            expect(typeof config.database).toBe('string');
        });
    });

    describe('Collection Getters', () => {
        it('getUsersCollection should return collection', () => {
            const col = getUsersCollection();
            expect(col).toBeDefined();
            expect(col.collectionName).toBe('users');
        });

        it('getRestaurantsCollection should return collection', () => {
            const col = getRestaurantsCollection();
            expect(col).toBeDefined();
            expect(col.collectionName).toBe('restaurants');
        });

        it('getPostsCollection should return collection', () => {
            const col = getPostsCollection();
            expect(col).toBeDefined();
            expect(col.collectionName).toBe('posts');
        });

        it('getStrategyCyclesCollection should return collection', () => {
            const col = getStrategyCyclesCollection();
            expect(col).toBeDefined();
            expect(col.collectionName).toBe('strategyCycles');
        });

        it('getContentStrategiesCollection should return collection', () => {
            const col = getContentStrategiesCollection();
            expect(col).toBeDefined();
            expect(col.collectionName).toBe('contentStrategies');
        });

        it('getSessionsCollection should return collection', () => {
            const col = getSessionsCollection();
            expect(col).toBeDefined();
            expect(col.collectionName).toBe('sessions');
        });
    });

    describe('toApiFormat Helper', () => {
        it('should handle null', () => {
            expect(toApiFormat(null)).toBeNull();
        });

        it('should handle undefined', () => {
            expect(toApiFormat(undefined as any)).toBeNull();
        });

        it('should convert _id to id', () => {
            const input = { _id: 'some-id', name: 'test' };
            const output = toApiFormat(input);
            expect(output).toEqual({ id: 'some-id', name: 'test' });
            expect(output).not.toHaveProperty('_id');
        });

        it('should convert ObjectId _id to string id', () => {
            const objectId = new ObjectId();
            const input = { _id: objectId, name: 'test' };
            const output = toApiFormat(input);
            expect(output).not.toBeNull();
            expect(output!.id).toBe(objectId.toString());
            expect((output as any).name).toBe('test');
            expect(output).not.toHaveProperty('_id');
        });

        it('should transform instagramCredentials with valid token', () => {
            const futureDate = new Date(Date.now() + 30 * 86400000); // 30 days in future
            const input = {
                _id: 'r1',
                name: 'Restaurant',
                instagramCredentials: {
                    accessToken: 'token123',
                    tokenExpiresAt: futureDate,
                    username: 'testuser',
                    userId: 'ig-123',
                    pageName: 'Test Page',
                    connectedAt: new Date()
                }
            };
            const output: any = toApiFormat(input);
            expect(output).not.toBeNull();
            expect(output.instagramConnection).toBeDefined();
            expect(output.instagramConnection.connected).toBe(true);
            expect(output.instagramConnection.tokenStatus).toBe('valid');
            expect(output).not.toHaveProperty('instagramCredentials');
        });

        it('should transform instagramCredentials with expired token', () => {
            const pastDate = new Date(Date.now() - 86400000);
            const input = {
                _id: 'r1',
                name: 'Restaurant',
                instagramCredentials: {
                    accessToken: 'token123',
                    tokenExpiresAt: pastDate,
                    username: 'testuser',
                    userId: 'ig-123',
                    pageName: 'Test Page',
                    connectedAt: new Date()
                }
            };
            const output: any = toApiFormat(input);
            expect(output).not.toBeNull();
            expect(output.instagramConnection).toBeDefined();
            expect(output.instagramConnection.connected).toBe(true); // Still connected, just expired
            expect(output.instagramConnection.tokenStatus).toBe('expired');
            expect(output.instagramConnection.needsReauthorization).toBe(true);
        });
    });

    describe('toObjectId Helper', () => {
        it('should create ObjectId from valid 24 hex chars', () => {
            const validId = '507f1f77bcf86cd799439011';
            const result = toObjectId(validId);
            expect(result).toBeInstanceOf(ObjectId);
            expect(result.toString()).toBe(validId);
        });

        it('should return original string for non-ObjectId strings', () => {
            const customId = 'r1';
            const result = toObjectId(customId);
            expect(result).toBe(customId);
        });

        it('should return ObjectId unchanged', () => {
            const objectId = new ObjectId();
            const result = toObjectId(objectId as any);
            expect(result).toBe(objectId);
        });

        it('should handle null', () => {
            const result = toObjectId(null as any);
            expect(result).toBeNull();
        });

        it('should handle undefined', () => {
            const result = toObjectId(undefined as any);
            expect(result).toBeUndefined();
        });
    });
});
