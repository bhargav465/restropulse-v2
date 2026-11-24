import { describe, it, expect, vi, beforeEach } from 'vitest';

const findPromotableOffers = vi.fn();
vi.mock('@restropulse/db', () => ({ findPromotableOffers }));
vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { resolveContentOffers } = await import('../../src/services/processors/content-offers.js');

const now = new Date('2026-11-24T10:00:00Z');
const lunch = {
  id: 'o1', restaurantId: 'r1', title: 'Lunch', reward: { kind: 'percent_off', percent: 15 }, scope: { kind: 'all' },
  schedule: { startsAt: '2026-11-01T00:00:00.000Z' }, showOnSite: true, promoteInContent: true, status: 'active',
};

describe('resolveContentOffers', () => {
  beforeEach(() => { findPromotableOffers.mockReset(); });

  it('keeps free-text offers first and adds live CMS offers', async () => {
    findPromotableOffers.mockResolvedValue([lunch]);
    expect(await resolveContentOffers({ id: 'r1', activeOffers: ['Free dessert on Sundays'] }, now))
      .toEqual(['Free dessert on Sundays', 'Lunch: 15% off']);
    expect(findPromotableOffers).toHaveBeenCalledWith('r1');
  });

  it('returns the free-text offers untouched when there are no CMS offers', async () => {
    findPromotableOffers.mockResolvedValue([]);
    expect(await resolveContentOffers({ id: 'r1' }, now)).toBeUndefined();
  });

  it('falls back to free-text offers when the lookup fails', async () => {
    findPromotableOffers.mockRejectedValue(new Error('down'));
    expect(await resolveContentOffers({ id: 'r1', activeOffers: ['A'] }, now)).toEqual(['A']);
  });
});
