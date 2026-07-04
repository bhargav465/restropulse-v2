import { beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDB, disconnectDB } from '@restropulse/db';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENCRYPTION_KEY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    process.env.INSTAGRAM_APP_SECRET = 'test-app-secret';

    mongoServer = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongoServer.getUri();
    process.env.MONGODB_DB_NAME = 'restropulse-test';

    await connectDB();
}, 60000);

afterAll(async () => {
    await disconnectDB();
    if (mongoServer) await mongoServer.stop();
}, 10000);
