// @ts-nocheck -- Template file: copy into an app directory before use
/**
 * Integration Test Template -- Backend API Endpoints
 *
 * This template demonstrates testing Express routes end-to-end using
 * supertest and an in-memory MongoDB instance. The full middleware stack
 * (auth, validation, error handling) runs during these tests.
 *
 * Usage:
 *   1. Copy this file to apps/api/tests/integration/your-route.test.ts
 *   2. Replace placeholders with actual routes and payloads
 *   3. Run: npx vitest run tests/integration/your-route.test.ts
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
// import request from 'supertest';
// import { app } from '../../src/server.js'; // Export your Express app
// import { setDB } from '@restropulse/db';

// -- STEP 1: In-memory MongoDB lifecycle -------------------------------------

let mongod: MongoMemoryServer;
let client: MongoClient;
let _db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  client = await MongoClient.connect(uri);
  _db = client.db('test-integration');
  // setDB(db); // Inject test DB into the shared @restropulse/db package
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

// -- STEP 2: Seed and clean data between tests --------------------------------

beforeEach(async () => {
  // Seed test data
  // await db.collection('restaurants').insertOne({
  //   _id: 'r1',
  //   name: 'Test Restaurant',
  //   createdAt: new Date(),
  // });
});

afterEach(async () => {
  // Clean all collections
  const collections = await _db.listCollections().toArray();
  for (const col of collections) {
    await _db.collection(col.name).deleteMany({});
  }
});

// -- STEP 3: Mock auth middleware if needed -----------------------------------

// vi.mock('../../src/services/auth.js', () => ({
//   verifyToken: vi.fn().mockReturnValue({ userId: 'u1', role: 'OWNER' }),
// }));

// -- STEP 4: Write integration tests -----------------------------------------

describe('GET /api/your-resource', () => {
  it('should return 200 with data', async () => {
    // const response = await request(app)
    //   .get('/api/your-resource')
    //   .set('Authorization', 'Bearer test-token')
    //   .expect(200);

    // expect(response.body.success).toBe(true);
    // expect(response.body.data).toBeDefined();
    expect(true).toBe(true); // Placeholder
  });

  it('should return 401 without auth token', async () => {
    // const response = await request(app)
    //   .get('/api/your-resource')
    //   .expect(401);

    // expect(response.body.success).toBe(false);
    expect(true).toBe(true); // Placeholder
  });

  it('should return 404 for nonexistent resource', async () => {
    // const response = await request(app)
    //   .get('/api/your-resource/nonexistent')
    //   .set('Authorization', 'Bearer test-token')
    //   .expect(404);

    // expect(response.body.error).toMatch(/not found/i);
    expect(true).toBe(true); // Placeholder
  });
});

describe('POST /api/your-resource', () => {
  it('should create resource and return 201', async () => {
    // const payload = { name: 'New Item', type: 'IMAGE' };

    // const response = await request(app)
    //   .post('/api/your-resource')
    //   .set('Authorization', 'Bearer test-token')
    //   .send(payload)
    //   .expect(201);

    // expect(response.body.success).toBe(true);

    // // Verify it was actually saved
    // const saved = await db.collection('yourCollection').findOne({ name: 'New Item' });
    // expect(saved).toBeDefined();
    expect(true).toBe(true); // Placeholder
  });

  it('should return 400 for invalid payload', async () => {
    // const response = await request(app)
    //   .post('/api/your-resource')
    //   .set('Authorization', 'Bearer test-token')
    //   .send({}) // missing required fields
    //   .expect(400);

    // expect(response.body.success).toBe(false);
    expect(true).toBe(true); // Placeholder
  });
});
