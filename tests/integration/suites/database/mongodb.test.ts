import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { requireSecrets } from '../../helpers/secrets.js';

const secrets = requireSecrets('mongodb', ['MONGODB_URI', 'MONGODB_DB_NAME']);

describe('MongoDB Atlas connection', () => {
  let client: MongoClient;

  beforeAll(async () => {
    client = new MongoClient(secrets.MONGODB_URI);
    await client.connect();
  });

  afterAll(async () => { await client?.close(); });

  it('pings the database', async () => {
    const result = await client.db('admin').command({ ping: 1 });
    expect(result.ok).toBe(1);
  });

  it('lists core collections', async () => {
    const names = (await client.db(secrets.MONGODB_DB_NAME).listCollections().toArray()).map(c => c.name);
    expect(names).toContain('users');
    expect(names).toContain('restaurants');
    expect(names).toContain('posts');
  });

  it('round-trips a document write and read', async () => {
    const col = client.db(secrets.MONGODB_DB_NAME).collection('_integration_test_probe');
    const id = `probe-${Date.now()}`;
    await col.insertOne({ _id: id as any, ts: new Date() });
    const found = await col.findOne({ _id: id as any });
    expect(found).not.toBeNull();
    await col.deleteOne({ _id: id as any });
  });
});
