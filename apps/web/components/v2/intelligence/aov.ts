/**
 * AOV band display helper (Brief 10, client mirror). Keep IN SYNC with the server
 * source of truth `apps/api/src/services/intelligence/buckets.ts` (AOV_BANDS +
 * aovBandLabel) — same Google price-level → band mapping. Presentation-only.
 */

/** Google price levels 0–4 collapse to four display bands (null → Value default). */
const AOV_BANDS = ['Budget', 'Budget', 'Value', 'Premium', 'Luxury'] as const;
const DEFAULT_PRICE_LEVEL = 2;

export function aovBandLabel(priceLevel: number | null | undefined): string {
    const lvl = priceLevel === null || priceLevel === undefined ? DEFAULT_PRICE_LEVEL : priceLevel;
    return AOV_BANDS[Math.max(0, Math.min(4, Math.round(lvl)))] ?? 'Value';
}
