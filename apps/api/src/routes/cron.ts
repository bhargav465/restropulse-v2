/**
 * Vercel Cron endpoints — mounted at /api/cron.
 *
 * Schedules are defined in the API deployment's vercel.json (see
 * scripts/build-vercel-api.mjs). Auth: when CRON_SECRET is set (project env),
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` with each invocation and
 * we require it; without a secret we accept only requests carrying Vercel's
 * `x-vercel-cron` header. Never callable anonymously from the public internet
 * once CRON_SECRET is configured.
 */
import express, { Request, Response } from 'express';
import { getRestaurantsCollection } from '@restropulse/db';
import { handle } from '../middleware/async-handler.js';
import { runDailySnapshotJob } from '../services/intelligence/snapshots.js';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('cron');
const router = express.Router();

function authorized(req: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (secret) return req.headers.authorization === `Bearer ${secret}`;
    return req.headers['x-vercel-cron'] !== undefined;
}

function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Daily intelligence snapshots for every restaurant that has completed a scan
 * (identified by a stored googlePlaceId). This is what makes month-to-date and
 * yearly rating/review tracking accumulate without anyone pressing refresh.
 */
router.get('/daily-snapshots', handle(async (req: Request, res: Response) => {
    if (!authorized(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const restaurants = await getRestaurantsCollection()
        .find({ suspended: { $ne: true }, googlePlaceId: { $exists: true, $nin: [null, ''] } })
        .project({ _id: 1, name: 1 })
        .limit(200)
        .toArray();

    const date = todayStr();
    let captured = 0;
    const failures: string[] = [];

    for (const r of restaurants) {
        const rid = String(r._id);
        try {
            const written = await runDailySnapshotJob(rid, date);
            captured += written.length;
        } catch (err) {
            failures.push(rid);
            log.warn({ restaurantId: rid, err: err instanceof Error ? err.message : String(err) }, 'cron: snapshot failed');
        }
    }

    log.info({ restaurants: restaurants.length, captured, failures: failures.length, date }, 'cron: daily snapshots done');
    res.json({ success: true, data: { date, restaurants: restaurants.length, snapshotsWritten: captured, failed: failures.length } });
}));

export default router;
