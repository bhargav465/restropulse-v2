import { findPromotableOffers } from '@restropulse/db';
import { mergeActiveOffers } from '@restropulse/shared';
import { createLogger } from '@restropulse/telemetry/server';

const logger = createLogger('content-offers');

/**
 * The offers the content engine should talk about for one restaurant: the
 * merchant's free-text "active offers" first (unchanged), then any CMS offer
 * that is active, promoted in content and inside its date range today.
 *
 * Best-effort: if the CMS lookup fails, generation carries on with the
 * free-text offers alone rather than failing the post.
 */
export async function resolveContentOffers(
    restaurant: { id: string; activeOffers?: string[] },
    now: Date = new Date(),
): Promise<string[] | undefined> {
    try {
        const offers = await findPromotableOffers(restaurant.id);
        if (offers.length === 0) return restaurant.activeOffers;
        return mergeActiveOffers(restaurant.activeOffers, offers, now);
    } catch (err) {
        logger.warn(
            { restaurantId: restaurant.id, error: err instanceof Error ? err.message : String(err) },
            'CMS offer lookup failed; using free-text offers only',
        );
        return restaurant.activeOffers;
    }
}
