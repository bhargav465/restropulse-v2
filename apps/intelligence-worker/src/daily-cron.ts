/**
 * Daily snapshot cron wiring (Brief 08). Kept separate from `daily.ts` so the
 * job logic imports no `node-cron` and stays trivially unit-testable.
 *
 * Schedule: `0 2 * * *` (02:00), timezone Asia/Kolkata — the default restaurant
 * timezone. Per-tenant local-day resolution happens inside the job; the cron
 * timezone only picks the wall-clock moment the pass fires.
 */

import cron from 'node-cron';
import { createLogger, tracedCronJob } from '@restropulse/telemetry/server';
import { runDailySnapshotJob } from './daily.js';
import { DEFAULT_TIMEZONE } from './tz.js';

const log = createLogger('intelligence-daily-cron');

/** Daily at 02:00 IST by default. Override with CRON_INTELLIGENCE_DAILY. */
const CRON_SCHEDULE = process.env.CRON_INTELLIGENCE_DAILY ?? '0 2 * * *';

/** Start the daily snapshot cron. Mirrors `startIntelligenceRefreshCron`. */
export function startDailySnapshotCron(): void {
    cron.schedule(
        CRON_SCHEDULE,
        async () => {
            await tracedCronJob('intelligence-daily-snapshot', () => runDailySnapshotJob());
        },
        { timezone: DEFAULT_TIMEZONE },
    );

    log.info({ schedule: CRON_SCHEDULE }, 'Cron job scheduled: intelligence daily snapshot loop');
}
