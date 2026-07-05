import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  trackAIUsage: vi.fn(),
}));

const ORIGINAL_KEYS = {
  anthropic: process.env['ANTHROPIC_API_KEY'],
  cal: process.env['GOOGLE_CALENDAR_API_KEY'],
  fal: process.env['FAL_API_KEY'],
  pplx: process.env['PERPLEXITY_API_KEY'],
  v1: process.env['CURRENT_AFFAIRS_V1_ENABLED'],
  v2: process.env['CURRENT_AFFAIRS_V2_ENABLED'],
  media: process.env['MEDIA_BACKEND'],
};

beforeAll(() => {
  process.env['ASSET_SERVER_BASE_URL'] = 'http://localhost:3002';
  process.env['ASSET_SERVER_PORT'] = '3002';
});

afterAll(() => {
  // Restore originals to avoid leaking into other test files in the same run.
  for (const [name, value] of Object.entries({
    ANTHROPIC_API_KEY: ORIGINAL_KEYS.anthropic,
    GOOGLE_CALENDAR_API_KEY: ORIGINAL_KEYS.cal,
    FAL_API_KEY: ORIGINAL_KEYS.fal,
    PERPLEXITY_API_KEY: ORIGINAL_KEYS.pplx,
    CURRENT_AFFAIRS_V1_ENABLED: ORIGINAL_KEYS.v1,
    CURRENT_AFFAIRS_V2_ENABLED: ORIGINAL_KEYS.v2,
    MEDIA_BACKEND: ORIGINAL_KEYS.media,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

beforeEach(() => {
  // Each test starts from a clean slate. Tests that need keys / flags set them explicitly.
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['GOOGLE_CALENDAR_API_KEY'];
  delete process.env['FAL_API_KEY'];
  delete process.env['PERPLEXITY_API_KEY'];
  delete process.env['CURRENT_AFFAIRS_V1_ENABLED'];
  delete process.env['CURRENT_AFFAIRS_V2_ENABLED'];
  delete process.env['MEDIA_BACKEND'];
});

const { createContentGenerator } = await import('../../../src/services/content-generator/factory.js');

/** Helper: set the four required AI-mode keys to test fixtures. */
function setAllAiKeys() {
  process.env['ANTHROPIC_API_KEY'] = 'sk-test';
  process.env['GOOGLE_CALENDAR_API_KEY'] = 'cal-test';
  process.env['FAL_API_KEY'] = 'fal-test';
  process.env['PERPLEXITY_API_KEY'] = 'pplx-test';
}

describe('createContentGenerator', () => {
  it('returns the placeholder backend by default', async () => {
    const g = await createContentGenerator('placeholder');
    expect(g.name).toBe('placeholder');
  });

  it('returns the AI backend when "ai" and all four required keys are present (uber-flag mode)', async () => {
    setAllAiKeys();
    const g = await createContentGenerator('ai');
    expect(g.name).toBe('ai');
  }, 15000);

  it('throws on an unknown backend string', async () => {
    await expect(createContentGenerator('chatgpt' as any)).rejects.toThrow(/unknown content generator backend/i);
  });

  it('throws a single combined error listing every missing key when AI mode is enabled', async () => {
    // No keys set at all -- should surface all 4 in one error message
    await expect(createContentGenerator('ai')).rejects.toMatchObject({
      message: expect.stringContaining('ANTHROPIC_API_KEY'),
    });
    let caught: Error | undefined;
    try {
      await createContentGenerator('ai');
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    const msg = caught!.message;
    expect(msg).toContain('FAL_API_KEY');
    expect(msg).toContain('GOOGLE_CALENDAR_API_KEY');
    expect(msg).toContain('PERPLEXITY_API_KEY');
    expect(msg).toMatch(/MEDIA_BACKEND=placeholder|CURRENT_AFFAIRS_V[12]_ENABLED=false/);
    expect(msg).toContain('docs/SECRETS.md');
  });
});

describe('createContentGenerator -- AI uber-flag default-on behavior', () => {
  it('with backend=ai and all four keys, V1 + V2 + fal-ai are all engaged by default', async () => {
    setAllAiKeys();
    await expect(createContentGenerator('ai')).resolves.toBeDefined();
  }, 15000);

  it('does not require FAL_API_KEY when MEDIA_BACKEND=placeholder override is set', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['GOOGLE_CALENDAR_API_KEY'] = 'cal-test';
    process.env['PERPLEXITY_API_KEY'] = 'pplx-test';
    process.env['MEDIA_BACKEND'] = 'placeholder';
    await expect(createContentGenerator('ai')).resolves.toBeDefined();
  });

  it('does not require GOOGLE_CALENDAR_API_KEY when V1 override is set to false', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['FAL_API_KEY'] = 'fal-test';
    process.env['PERPLEXITY_API_KEY'] = 'pplx-test';
    process.env['CURRENT_AFFAIRS_V1_ENABLED'] = 'false';
    await expect(createContentGenerator('ai')).resolves.toBeDefined();
  });

  it('does not require PERPLEXITY_API_KEY when V2 override is set to false', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['FAL_API_KEY'] = 'fal-test';
    process.env['GOOGLE_CALENDAR_API_KEY'] = 'cal-test';
    process.env['CURRENT_AFFAIRS_V2_ENABLED'] = 'false';
    await expect(createContentGenerator('ai')).resolves.toBeDefined();
  });

  it('runs with only ANTHROPIC_API_KEY when all sub-flags are overridden off (degraded debug mode)', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['MEDIA_BACKEND'] = 'placeholder';
    process.env['CURRENT_AFFAIRS_V1_ENABLED'] = 'false';
    process.env['CURRENT_AFFAIRS_V2_ENABLED'] = 'false';
    const g = await createContentGenerator('ai');
    expect(g.name).toBe('ai');
  });

  it('throws on an unknown MEDIA_BACKEND value with a helpful message', async () => {
    setAllAiKeys();
    process.env['MEDIA_BACKEND'] = 'midjourney';
    await expect(createContentGenerator('ai')).rejects.toThrow(/MEDIA_BACKEND/i);
  });
});
