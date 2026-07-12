/**
 * Public asset serving (Brief 04 / DESIGN-04) — mounted at /api/assets.
 *
 * GET /api/assets/:id streams a GridFS-stored image. Public (no auth): logos and
 * covers render on the public storefront. Asset ids are write-once (a
 * replacement gets a new id), so responses are immutably cacheable. Talks only
 * to the `AssetStore` seam, never GridFS directly.
 */

import express, { Request, Response } from 'express';
import { assetStore } from '../services/assets.js';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('assets');

const router = express.Router();

// One year, immutable — asset ids never change content.
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

router.get('/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const etag = `"${id}"`;

    // Cheap 304 before touching storage — the id IS the content fingerprint.
    if (req.headers['if-none-match'] === etag) {
        res.status(304)
            .set('ETag', etag)
            .set('Cache-Control', CACHE_CONTROL)
            .end();
        return;
    }

    let download;
    try {
        download = await assetStore.openDownload(id);
    } catch (err) {
        log.warn({ err, id }, 'Asset download lookup failed');
        res.status(404).json({ success: false, error: 'Asset not found' });
        return;
    }

    if (!download) {
        res.status(404).json({ success: false, error: 'Asset not found' });
        return;
    }

    res.status(200)
        .set('Content-Type', download.contentType)
        .set('Content-Length', String(download.length))
        .set('Cache-Control', CACHE_CONTROL)
        .set('ETag', etag)
        .set('X-Content-Type-Options', 'nosniff');

    download.stream.on('error', (err) => {
        log.warn({ err, id }, 'Asset stream error');
        if (!res.headersSent) {
            res.status(404).json({ success: false, error: 'Asset not found' });
        } else {
            res.destroy();
        }
    });

    download.stream.pipe(res);
});

export default router;
