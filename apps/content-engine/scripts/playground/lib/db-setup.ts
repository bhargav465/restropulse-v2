import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { setDB } from '@restropulse/db';
import { loadAllFixtures } from './fixture-loader.js';

let mongod: MongoMemoryServer;
let client: MongoClient;

export async function bootPlaygroundDB(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('restropulse-playground'));

  const counts = await loadAllFixtures();
  console.log(
    `\nPlayground ready — ${counts.restaurants} restaurants, ${counts.subscriptions} subscriptions, ` +
    `${counts.strategies} strategies, ${counts.cycles} cycles loaded (in-memory)\n`,
  );

  // SIGTERM / SIGINT: await async teardown then exit.
  // Cannot use process.on('exit') for this — async callbacks are silently ignored there.
  async function gracefulShutdown() {
    await client?.close().catch(() => {});
    await mongod?.stop({ doCleanup: true }).catch(() => {});
    process.exit(0);
  }
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

export async function getRestaurantsFromDB(): Promise<any[]> {
  return client.db('restropulse-playground').collection('restaurants').find({}).toArray();
}
