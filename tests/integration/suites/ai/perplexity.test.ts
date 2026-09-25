import { describe, it, expect } from 'vitest';
import { requireSecrets } from '../../helpers/secrets.js';

const secrets = requireSecrets('perplexity', ['PERPLEXITY_API_KEY']);

describe('Perplexity Sonar Pro API', () => {
  it('returns a grounded response for a restaurant-trend query', async () => {
    const { SonarClient } = await import('../../../../apps/content-engine/src/services/content-generator/backends/ai/current-affairs/clients/sonar-client.js');
    const client = new SonarClient({ apiKey: secrets.PERPLEXITY_API_KEY });
    const result = await client.query(
      'What are the top 2 food trends in Bengaluru restaurants this week? Reply in 2 sentences.',
    );
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(20);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.modelId).toContain('sonar');
  }, 30000);
});
