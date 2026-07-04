import { describe, it, expect, vi } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const {
  createCurrentAffairsRefreshProcessor,
} = await import('../../../src/services/processors/current-affairs-refresh/index.js');

describe('createCurrentAffairsRefreshProcessor', () => {
  it('returns an IProcessor with name "current-affairs-refresh" and the supplied cron', () => {
    const provider = { name: 'mock', fetchHints: vi.fn(), refresh: vi.fn() };
    const p = createCurrentAffairsRefreshProcessor('0 6 * * *', provider as any);
    expect(p.name).toBe('current-affairs-refresh');
    expect(p.cron).toBe('0 6 * * *');
  });

  it('processor.run() invokes provider.refresh()', async () => {
    const refresh = vi.fn(async () => {});
    const provider = { name: 'mock', fetchHints: vi.fn(), refresh };
    const p = createCurrentAffairsRefreshProcessor('* * * * *', provider as any);
    await p.run();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
