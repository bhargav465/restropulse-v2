import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { setDB } from '@restropulse/db';

vi.mock('@restropulse/telemetry/server', () => {
  const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    createLogger: vi.fn(() => noopLogger),
    initServerTelemetry: vi.fn(),
    shutdownServerTelemetry: vi.fn(),
    trackAIUsage: vi.fn(),
  };
});

const { AIContentGenerator } = await import(
  '../../src/services/content-generator/backends/ai/ai-content-generator.js'
);
const { RestaurantSpecialization } = await import(
  '../../src/services/content-generator/backends/ai/specialization/index.js'
);
const {
  buildCurrentAffairsProvider,
  MongoCurrentAffairsCache,
} = await import('../../src/services/content-generator/backends/ai/current-affairs/index.js');

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  setDB(client.db('current-affairs-e2e-test'));
}, 60000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
}, 20000);

beforeEach(async () => {
  await client.db('current-affairs-e2e-test').collection('currentAffairsCache').deleteMany({});
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-13T00:00:00Z'));
});

describe('AIContentGenerator with current-affairs auto-enrichment (V1+V2)', () => {
  it('refresh -> generatePost: holiday + daily-Sonar lines surface in the LLM prompt', async () => {
    const calendarClient = { listHolidays: vi.fn(async () => [{ name: 'Eid al-Fitr', date: '2026-05-15' }]) };
    const sonarClient = { query: vi.fn(async () => ({ text: 'IPL Final tonight in Chennai', usage: { inputTokens: 60, outputTokens: 80 }, modelId: 'sonar-pro' })) };

    const cache = new MongoCurrentAffairsCache();
    const specialization = new RestaurantSpecialization();
    const provider = buildCurrentAffairsProvider(
      { v1Enabled: true, v2Enabled: true },
      { cache, calendarClient: calendarClient as any, sonarClient: sonarClient as any, specialization },
    );

    // Refresh once so V2's daily cache entry is populated
    await provider.refresh();
    expect(sonarClient.query).toHaveBeenCalledTimes(1); // daily refresh fired

    // Now build the AI gen and run generatePost
    const generateObject = vi.fn().mockResolvedValue({
      object: { caption: 'Plate of biryani for the match', suggestedHashtags: ['#biryani'] },
      usage: { inputTokens: 120, outputTokens: 60 },
      modelId: 'claude-haiku-4-5-20251001',
    });
    const generateImage = vi.fn().mockResolvedValue({
      jobId: 'j', status: 'COMPLETED',
      mediaUrl: 'http://x', thumbnail: 'http://x',
      metadata: { widthPx: 1080, heightPx: 1080 },
    });

    const gen = new AIContentGenerator({
      specialization,
      llm: { name: 'mock-llm', generateObject },
      media: { name: 'mock-media', generateImage, generateVideo: vi.fn(), pollJob: vi.fn() },
      currentAffairs: provider,
    });

    await gen.generatePost(
      { concept: 'cricket match-day biryani special', type: 'IMAGE', platforms: ['INSTAGRAM'] },
      { restaurantId: 'r1', restaurantName: 'Spice Route', locale: 'en-IN' },
    );

    // The per-post Sonar call also fired (concept matches 'cricket' / 'match')
    expect(sonarClient.query).toHaveBeenCalledTimes(2);

    const prompt = (generateObject.mock.calls[0][0] as any).prompt;
    expect(prompt).toContain('Eid al-Fitr');
    expect(prompt).toContain('IPL Final tonight in Chennai');
  });
});
