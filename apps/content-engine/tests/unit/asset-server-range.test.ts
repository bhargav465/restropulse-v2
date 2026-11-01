import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('@restropulse/telemetry/server', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() })),
}));

const { startAssetServer } = await import('../../src/services/asset-server.js');

let server: http.Server;
let port: number;
let assetsDir: string;

// assets/ is downloaded by scripts/download-assets.mjs and not committed, so the
// test serves its own fixture: 64 distinct bytes make range slices checkable.
const FIXTURE = Buffer.from(Array.from({ length: 64 }, (_, i) => i));

function request(path: string, headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });
}

beforeAll(async () => {
  assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-server-range-'));
  fs.mkdirSync(path.join(assetsDir, 'images'));
  fs.writeFileSync(path.join(assetsDir, 'images', 'food-01.jpg'), FIXTURE);
  server = startAssetServer(0, assetsDir);
  await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  port = addr.port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  fs.rmSync(assetsDir, { recursive: true, force: true });
});

/** Browsers refuse to play <video> without HTTP 206 + Content-Range support. */
describe('asset-server Range requests', () => {
  it('serves the whole file with Accept-Ranges when no Range header is sent', async () => {
    const res = await request('/images/food-01.jpg');
    expect(res.status).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.body.length).toBe(Number(res.headers['content-length']));
    expect(res.body.equals(FIXTURE)).toBe(true);
  });

  it('serves an explicit byte range as 206 Partial Content', async () => {
    const whole = await request('/images/food-01.jpg');
    const res = await request('/images/food-01.jpg', { Range: 'bytes=0-9' });

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-9/${whole.body.length}`);
    expect(res.headers['content-length']).toBe('10');
    expect(res.body.equals(whole.body.subarray(0, 10))).toBe(true);
  });

  it('treats an open-ended range as "to the end of the file"', async () => {
    const whole = await request('/images/food-01.jpg');
    const size = whole.body.length;
    const res = await request('/images/food-01.jpg', { Range: 'bytes=5-' });

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 5-${size - 1}/${size}`);
    expect(res.body.equals(whole.body.subarray(5))).toBe(true);
  });

  it('answers 404 for a path that is a directory, not a file', async () => {
    const res = await request('/images');
    expect(res.status).toBe(404);
  });
});
