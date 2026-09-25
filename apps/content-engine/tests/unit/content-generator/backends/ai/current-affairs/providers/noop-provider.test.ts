import { describe, it, expect, vi } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { NoopCurrentAffairsProvider } = await import(
  '../../../../../../../src/services/content-generator/backends/ai/current-affairs/providers/noop-provider.js'
);

describe('NoopCurrentAffairsProvider', () => {
  it('exposes name "noop"', () => {
    expect(new NoopCurrentAffairsProvider().name).toBe('noop');
  });

  it('fetchHints returns []', async () => {
    const p = new NoopCurrentAffairsProvider();
    expect(await p.fetchHints({ operation: 'draftCycle', specializationContext: {} })).toEqual([]);
  });

  it('refresh resolves without doing anything', async () => {
    const p = new NoopCurrentAffairsProvider();
    await expect(p.refresh()).resolves.toBeUndefined();
  });
});
