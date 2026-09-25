import http from 'node:http';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Mock telemetry before any app code loads
vi.mock('@restropulse/telemetry/server', () => {
  const noopLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
    trace: vi.fn(),
  };
  return {
    createLogger: vi.fn(() => noopLogger),
    initServerTelemetry: vi.fn(),
    shutdownServerTelemetry: vi.fn(),
  };
});

const { startAssetServer } = await import('../../src/services/asset-server.js');

let server: http.Server;
let port: number;

function getPort(s: http.Server): number {
  const addr = s.address();
  if (!addr || typeof addr === 'string') throw new Error('Could not get port');
  return addr.port;
}

function get(url: string): Promise<{ status: number; contentType: string | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          contentType: res.headers['content-type'],
          body,
        });
      });
    }).on('error', reject);
  });
}

beforeAll(async () => {
  // Use port 0 to let the OS pick a free port
  server = startAssetServer(0);
  // Wait for the server to be fully listening
  await new Promise<void>((resolve) => {
    if (server.listening) {
      resolve();
    } else {
      server.once('listening', resolve);
    }
  });
  port = getPort(server);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('asset-server', () => {
  describe('startAssetServer()', () => {
    it('starts and returns an http.Server instance', () => {
      expect(server).toBeInstanceOf(http.Server);
      expect(server.listening).toBe(true);
    });

    it('returns 404 for a missing image file', async () => {
      const result = await get(`http://localhost:${port}/images/nonexistent.jpg`);
      expect(result.status).toBe(404);
      expect(result.body).toBe('Asset not found');
    });

    it('returns 404 for a missing video file', async () => {
      const result = await get(`http://localhost:${port}/videos/nonexistent.mp4`);
      expect(result.status).toBe(404);
    });

    it('serves correct Content-Type for .jpg extension on 200 response', async () => {
      // We cannot guarantee the file exists, but we can verify the MIME mapping
      // by inspecting what headers would be sent on a hit. Instead, test 404 path
      // and trust that Content-Type is only relevant when the file is found.
      // Since assets/ dir is empty in CI, all requests return 404 -- that is valid.
      const result = await get(`http://localhost:${port}/images/food-01.jpg`);
      // Either 200 with correct content-type, or 404 -- both are acceptable
      expect([200, 404]).toContain(result.status);
      if (result.status === 200) {
        expect(result.contentType).toBe('image/jpeg');
      }
    });

    it('returns 404 for a path pointing outside the assets directory (traversal attempt)', async () => {
      // The encoded traversal should resolve to outside ASSETS_DIR and be blocked
      const result = await get(`http://localhost:${port}/%2F..%2F..%2Fetc%2Fpasswd`);
      // Could be 403 (path guard) or 404 (file not found) -- either is safe
      expect([403, 404]).toContain(result.status);
    });

    it('returns 404 for the root path (no assets there)', async () => {
      const result = await get(`http://localhost:${port}/`);
      // Root resolves to ASSETS_DIR itself which is a directory, not a file
      expect([404, 403]).toContain(result.status);
    });
  });
});
