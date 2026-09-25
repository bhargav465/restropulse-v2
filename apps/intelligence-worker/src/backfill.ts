/**
 * Backfill on boot (Brief 08 §1 "Backfill"). For each active tenant, find the
 * calendar days in the last 7 (the restaurant's local window) that have NO self
 * snapshot yet and run the daily job for each, flagged `backfilled: true`.
 * Gaps older than 7 days stay gaps — charts render them honestly (Brief 09).
 *
 * "A day exists" is judged by the presence of ANY self snapshot for that date
 * (google or zomato), which is exactly what the daily job writes first.
 */

import { getIntelligenceSnapshotsCollection, findRestaurantById } from '@restropulse/db';
import type { DailySnapshot, Restaurant } from '@restropulse/shared';
import { createLogger } from '@restropulse/telemetry/server';
import { runDailySnapshotJob, getActiveDailyRestaurantIds, isDailyEnabled, type DailyDeps } from './daily.js';
import { DEFAULT_TIMEZONE, localDateString, recentDates, BACKFILL_WINDOW_DAYS } from './tz.js';

const log = createLogger('intelligence-backfill');

export interface BackfillStats {
    enabled: boolean;
    restaurants: number;
    daysFilled: number;
}

/** Self-snapshot dates already present for a tenant within `[from … to]`. */
async function existingSelfDates(restaurantId: string, from: string, to: string): Promise<Set<string>> {
    const docs = (await getIntelligenceSnapshotsCollection()
        .find({ restaurantId, isSelf: true, date: { $gte: from, $lte: to } })
        .project({ date: 1 })
        .toArray()) as unknown as Array<Pick<DailySnapshot, 'date'>>;
    return new Set(docs.map((d) => d.date));
}

/**
 * Fill missing days in the last 7 for every active tenant. Shares the daily
 * deps (measure / tagThemes / searchNearby / clock) so backfilled rows are
 * captured exactly like live ones — only with `backfilled: true`.
 */
export async function runBackfill(deps: DailyDeps = {}): Promise<BackfillStats> {
    if (!isDailyEnabled()) {
        log.info('Backfill disabled (INTELLIGENCE_DAILY_ENABLED=false) — skipping');
        return { enabled: false, restaurants: 0, daysFilled: 0 };
    }

    const now = deps.now?.() ?? new Date();
    const timezoneOf = deps.timezoneOf ?? (() => DEFAULT_TIMEZONE);

    const ids = deps.restaurantId ? [deps.restaurantId] : await getActiveDailyRestaurantIds();
    let daysFilled = 0;

    for (const restaurantId of ids) {
        try {
            const restaurant: Restaurant | null = await findRestaurantById(restaurantId);
            if (!restaurant) continue;

            const today = localDateString(now, timezoneOf(restaurant));
            const window = recentDates(today, BACKFILL_WINDOW_DAYS);
            const have = await existingSelfDates(restaurantId, window[0], today);

            for (const date of window) {
                if (have.has(date)) continue;
                await runDailySnapshotJob({ ...deps, restaurantId, date, backfilled: true, now: () => now });
                daysFilled += 1;
            }
        } catch (error) {
            log.error({ restaurantId, error: String(error) }, 'Backfill failed for restaurant');
        }
    }

    log.info({ restaurants: ids.length, daysFilled }, 'Backfill on boot completed');
    return { enabled: true, restaurants: ids.length, daysFilled };
}
