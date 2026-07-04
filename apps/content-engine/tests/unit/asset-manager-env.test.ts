/**
 * Tests that asset-manager.ts derives BASE_URL from ASSET_SERVER_PORT.
 * Content-engine always generates localhost URLs so Studio can display
 * thumbnails without a running ngrok tunnel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const DEFAULT_PORT = 3002;
const CUSTOM_PORT = 4567;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  delete process.env.ASSET_SERVER_PORT;
  vi.resetModules();
});

describe('asset-manager BASE_URL — always localhost', () => {
  it('uses http://localhost:3002 when ASSET_SERVER_PORT is not set', async () => {
    delete process.env.ASSET_SERVER_PORT;
    const { getRandomImage } = await import('../../src/services/asset-manager.js');
    expect(getRandomImage().url).toMatch(new RegExp(`^http://localhost:${DEFAULT_PORT}/`));
  });

  it('uses ASSET_SERVER_PORT when set', async () => {
    process.env.ASSET_SERVER_PORT = String(CUSTOM_PORT);
    const { getRandomImage } = await import('../../src/services/asset-manager.js');
    expect(getRandomImage().url).toMatch(new RegExp(`^http://localhost:${CUSTOM_PORT}/`));
  });

  it('always generates a localhost URL (never a remote URL)', async () => {
    const { getRandomImage } = await import('../../src/services/asset-manager.js');
    const url = getRandomImage().url;
    expect(url).toMatch(/^http:\/\/localhost:\d+\//);
    expect(url).not.toContain('ngrok');
    expect(url).not.toContain('https://');
  });

  it('custom port applies to carousel urls', async () => {
    process.env.ASSET_SERVER_PORT = String(CUSTOM_PORT);
    const { getRandomCarousel } = await import('../../src/services/asset-manager.js');
    for (const url of getRandomCarousel().urls) {
      expect(url).toMatch(new RegExp(`^http://localhost:${CUSTOM_PORT}/`));
    }
  });

  it('custom port applies to video and thumbnail urls', async () => {
    process.env.ASSET_SERVER_PORT = String(CUSTOM_PORT);
    const { getRandomVideo } = await import('../../src/services/asset-manager.js');
    const { videoUrl, thumbnail } = getRandomVideo();
    expect(videoUrl).toMatch(new RegExp(`^http://localhost:${CUSTOM_PORT}/`));
    expect(thumbnail).toMatch(new RegExp(`^http://localhost:${CUSTOM_PORT}/`));
  });
});
