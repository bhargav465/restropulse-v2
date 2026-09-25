import { describe, it, expect } from 'vitest';
import { requireSecrets } from '../../helpers/secrets.js';

const secrets = requireSecrets('replicate-image', ['REPLICATE_API_TOKEN']);

describe('Replicate API', () => {
  it('creates a Flux dev prediction and resolves to an image URL', async () => {
    const { ReplicateClient } = await import('../../../../apps/content-engine/src/services/content-generator/backends/ai/media/replicate/replicate-client.js');
    const client = new ReplicateClient({ apiKey: secrets.REPLICATE_API_TOKEN });

    const prediction = await client.createPrediction('black-forest-labs/flux-dev', {
      prompt: 'a plate of biryani, studio lighting, food photography',
      aspect_ratio: '1:1',
      num_outputs: 1,
      output_format: 'webp',
    });
    expect(prediction.id).toBeTruthy();

    let final = prediction;
    for (let i = 0; i < 30 && final.status !== 'succeeded' && final.status !== 'failed'; i++) {
      await new Promise(r => setTimeout(r, 2000));
      final = await client.getPrediction(prediction.id);
    }

    expect(final.status).toBe('succeeded');
    const url = Array.isArray(final.output) ? final.output[0] : final.output;
    expect(typeof url).toBe('string');
    expect(url).toMatch(/^https?:\/\//);
  }, 120000);
});
