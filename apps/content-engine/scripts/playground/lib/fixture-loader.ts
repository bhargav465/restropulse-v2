import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getRestaurantsCollection,
  getContentStrategiesCollection,
  getStrategyCyclesCollection,
  getSubscriptionsCollection,
} from '@restropulse/db';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../../../fixtures');

function loadJson(filename: string): unknown[] {
  return JSON.parse(readFileSync(resolve(FIXTURES, filename), 'utf8'));
}

export async function loadAllFixtures(): Promise<{ restaurants: number; subscriptions: number; strategies: number; cycles: number }> {
  const restaurants   = loadJson('restaurants.json') as any[];
  const subscriptions = loadJson('subscriptions.json') as any[];
  const strategies    = loadJson('strategies.json') as any[];
  const cycles        = loadJson('cycles.json') as any[];

  async function upsertAll(collection: any, docs: any[]): Promise<number> {
    let count = 0;
    for (const doc of docs) {
      await collection.replaceOne({ _id: doc._id }, { ...doc, loadedAt: new Date() }, { upsert: true });
      count++;
    }
    return count;
  }

  const [r, s, cs, cy] = await Promise.all([
    upsertAll(await getRestaurantsCollection(),          restaurants),
    upsertAll(await getSubscriptionsCollection(),        subscriptions),
    upsertAll(await getContentStrategiesCollection(),    strategies),
    upsertAll(await getStrategyCyclesCollection(),       cycles),
  ]);

  return { restaurants: r, subscriptions: s, strategies: cs, cycles: cy };
}
