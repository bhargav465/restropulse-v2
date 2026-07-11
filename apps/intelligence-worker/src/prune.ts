/**
 * Trend-history retention: keep only the last MAX_REPORTS_PER_RESTAURANT (12)
 * intelligence reports per restaurant, newest-first by `generatedAt`
 * (ARCHITECTURE §2 "keep last 12 per restaurant, prune in worker").
 *
 * Report bodies are ~100–200 KB, so the 12-report cap keeps a tenant under
 * ~2.5 MB. Deleting excess reports is idempotent and safe to run every cycle.
 */

import { getIntelligenceReportsCollection, MAX_REPORTS_PER_RESTAURANT } from '@restropulse/db';

/**
 * Prune a single restaurant's reports down to the newest
 * `MAX_REPORTS_PER_RESTAURANT`. Returns the number of reports deleted.
 */
export async function pruneReports(
    restaurantId: string,
    max: number = MAX_REPORTS_PER_RESTAURANT,
): Promise<number> {
    const col = getIntelligenceReportsCollection();

    // Ids to keep: the `max` newest by generatedAt.
    const keep = await col
        .find({ restaurantId })
        .project({ _id: 1 })
        .sort({ generatedAt: -1 })
        .limit(max)
        .toArray();

    if (keep.length < max) return 0; // nothing to prune

    const keepIds = keep.map((r) => r._id);
    const result = await col.deleteMany({
        restaurantId,
        _id: { $nin: keepIds },
    });

    return result.deletedCount ?? 0;
}
