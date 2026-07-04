import { describe, it, expect, vi } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { buildCurrentAffairsProvider } = await import(
  '../../../../../../src/services/content-generator/backends/ai/current-affairs/index.js'
);
const { RestaurantSpecialization } = await import(
  '../../../../../../src/services/content-generator/backends/ai/specialization/index.js'
);

function fakeCache() {
  return { get: vi.fn(async () => null), set: vi.fn(async () => {}), cleanup: vi.fn(async () => 0) };
}
function fakeCalendarClient() { return { listHolidays: vi.fn(async () => []) }; }
function fakeSonarClient() { return { query: vi.fn(async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0 }, modelId: 'sonar-pro' })) }; }

describe('buildCurrentAffairsProvider', () => {
  const baseDeps = () => ({
    cache: fakeCache() as any,
    calendarClient: fakeCalendarClient() as any,
    sonarClient: fakeSonarClient() as any,
    specialization: new RestaurantSpecialization(),
  });

  it('returns a NoopCurrentAffairsProvider when both flags are false', () => {
    const p = buildCurrentAffairsProvider({ v1Enabled: false, v2Enabled: false }, baseDeps());
    expect(p.name).toBe('noop');
  });

  it('returns CalendarOnlyProvider when only V1 is enabled', () => {
    const p = buildCurrentAffairsProvider({ v1Enabled: true, v2Enabled: false }, baseDeps());
    expect(p.name).toBe('calendar-only');
  });

  it('returns SonarAugmentedProvider when both V1 and V2 are enabled', () => {
    const p = buildCurrentAffairsProvider({ v1Enabled: true, v2Enabled: true }, baseDeps());
    expect(p.name).toBe('sonar-augmented');
  });

  it('returns SonarAugmentedProvider over Noop when V2 is enabled but V1 is not (edge case)', () => {
    const p = buildCurrentAffairsProvider({ v1Enabled: false, v2Enabled: true }, baseDeps());
    // V2 must run on top of *something*; falls back to noop upstream.
    expect(p.name).toBe('sonar-augmented');
  });
});
