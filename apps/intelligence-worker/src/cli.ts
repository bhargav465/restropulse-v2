/**
 * Intelligence worker CLI (Brief 08 §2). One-shot entry points for ops + dev:
 *
 *   tsx src/cli.ts snapshot [--date=YYYY-MM-DD] [--restaurant=<id>]
 *   tsx src/cli.ts sweep    [--restaurant=<id>]
 *   tsx src/cli.ts weekly   [--restaurant=<id>]
 *
 * `--date` is capped at 7 days back (matches the backfill policy); an older date
 * is rejected with a clear error. Each command connects, runs once, and exits.
 */

import './instrument.js';

import { connectDB, disconnectDB, findRestaurantById } from '@restropulse/db';
import { createLogger } from '@restropulse/telemetry/server';
import { runDailySnapshotJob, getActiveDailyRestaurantIds } from './daily.js';
import { runNearbySweep } from './sweep.js';
import { runIntelligenceRefresh } from './refresh.js';
import { localDateString, dayDiff, BACKFILL_WINDOW_DAYS } from './tz.js';

const log = createLogger('intelligence-cli');

interface Args {
    command: string;
    date?: string;
    restaurant?: string;
}

function parseArgs(argv: string[]): Args {
    const [command = '', ...rest] = argv;
    const args: Args = { command };
    for (const arg of rest) {
        const [key, value] = arg.replace(/^--/, '').split('=');
        if (key === 'date') args.date = value;
        else if (key === 'restaurant') args.restaurant = value;
    }
    return args;
}

/** Reject a `--date` older than the 7-day backfill horizon (or malformed/future). */
function validateDate(date: string | undefined, now: Date): string | undefined {
    if (!date) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`Invalid --date "${date}" — expected YYYY-MM-DD.`);
    }
    const today = localDateString(now);
    const back = dayDiff(today, date);
    if (back > BACKFILL_WINDOW_DAYS - 1) {
        throw new Error(
            `--date ${date} is ${back} days back; the maximum is ${BACKFILL_WINDOW_DAYS - 1} ` +
                `(matches the backfill window). Pick a more recent date.`,
        );
    }
    if (back < 0) {
        throw new Error(`--date ${date} is in the future; pick today or a recent past date.`);
    }
    return date;
}

async function run(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const now = new Date();

    await connectDB();
    try {
        switch (args.command) {
            case 'snapshot': {
                const date = validateDate(args.date, now);
                const stats = await runDailySnapshotJob({ date, restaurantId: args.restaurant });
                log.info(stats, 'snapshot:run complete');
                break;
            }
            case 'sweep': {
                const ids = args.restaurant ? [args.restaurant] : await getActiveDailyRestaurantIds();
                let inserted = 0;
                let alerts = 0;
                for (const restaurantId of ids) {
                    const restaurant = await findRestaurantById(restaurantId);
                    if (!restaurant) continue;
                    const s = await runNearbySweep({
                        restaurantId,
                        lat: restaurant.location.lat,
                        lng: restaurant.location.lng,
                    });
                    inserted += s.inserted;
                    alerts += s.alerts;
                }
                log.info({ restaurants: ids.length, inserted, alerts }, 'sweep:nearby complete');
                break;
            }
            case 'weekly': {
                // The weekly refresh loop processes every active tenant; a
                // --restaurant filter is accepted for parity but the loop reads
                // all tenants (kept identical to the shipped cron behavior).
                const stats = await runIntelligenceRefresh();
                log.info(stats, 'refresh:weekly complete');
                break;
            }
            default:
                throw new Error(
                    `Unknown command "${args.command}". Use: snapshot | sweep | weekly.`,
                );
        }
    } finally {
        await disconnectDB();
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        log.error({ err: error }, 'CLI command failed');
        // eslint-disable-next-line no-console
        console.error(String(error instanceof Error ? error.message : error));
        process.exit(1);
    });
