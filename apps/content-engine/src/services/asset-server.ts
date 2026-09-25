/**
 * Local Asset HTTP Server
 *
 * Serves the locally downloaded placeholder images and videos over HTTP
 * so that the publishing service (and any other consumer) can access them
 * by URL. Uses only Node.js built-in modules — no extra dependencies.
 *
 * Assets are served from the assets/ directory at the project root:
 *   GET /images/<filename>  → assets/images/<filename>
 *   GET /videos/<filename>  → assets/videos/<filename>
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@restropulse/telemetry/server';

const logger = createLogger('content-engine:asset-server');

// Resolve assets/ relative to this file so it works for both
// `tsx` (src/services/) and compiled output (dist/services/).
const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../assets');

const MIME_TYPES: Record<string, string> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
};

export function startAssetServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    // Sanitize path to prevent directory traversal
    const safePath = path.normalize(req.url ?? '/').replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ASSETS_DIR, safePath);

    // Ensure the resolved path stays within ASSETS_DIR
    if (!filePath.startsWith(ASSETS_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

    // Use streaming with Range request support so browsers can play videos.
    // Without HTTP 206 / Content-Range, Chrome refuses to play <video> src.
    fs.stat(filePath, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        res.writeHead(404);
        res.end('Asset not found');
        return;
      }

      const fileSize = stat.size;
      const rangeHeader = req.headers.range;

      if (rangeHeader) {
        // Partial content — required for video seek and metadata preload
        const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Accept-Ranges': 'bytes',
          'Content-Type': contentType,
        });
        fs.createReadStream(filePath).pipe(res);
      }
    });
  });

  server.listen(port, () => {
    logger.info({ port, url: `http://localhost:${port}` }, 'Serving local assets');
  });

  return server;
}
