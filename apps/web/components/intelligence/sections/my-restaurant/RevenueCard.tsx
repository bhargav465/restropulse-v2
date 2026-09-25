import React, { useState } from 'react';
import type { IntelligenceReport } from '@restropulse/shared';
import { ProvenanceChip } from '../provenance';

/**
 * Revenue-growth card (Brief 10 §2, adopted from the sample report). Editable
 * guests/month (default `clamp(reviews × 2, 400, 8000)`) and avg spend (default
 * ₹400); a conservative 9% uplift → extra guests/mo, ₹/mo, ₹/yr. Everything is
 * `computed` with the assumptions visible — a projection, never a promise, and
 * with NO pill deltas. Tokens only (banner surface). Pure/presentational.
 */

export const UPLIFT_PCT = 0.09;
export const GUESTS_MIN = 400;
export const GUESTS_MAX = 8000;
export const DEFAULT_AVG_SPEND = 400;

export function defaultGuests(reviews: number): number {
    return Math.max(GUESTS_MIN, Math.min(GUESTS_MAX, Math.round(reviews * 2)));
}

function clampGuests(n: number): number {
    if (Number.isNaN(n)) return GUESTS_MIN;
    return Math.max(GUESTS_MIN, Math.min(GUESTS_MAX, Math.round(n)));
}

function clampSpend(n: number): number {
    if (Number.isNaN(n)) return 0;
    return Math.max(0, Math.round(n));
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div>
        <p className="text-[11px] uppercase tracking-wider text-sidebar-ink font-semibold">{label}</p>
        <p className="text-xl font-semibold text-white tabular-nums mt-0.5">{value}</p>
    </div>
);

const RevenueCard: React.FC<{ report: IntelligenceReport }> = ({ report }) => {
    const [guests, setGuests] = useState<number>(defaultGuests(report.base.totalRatings));
    const [avgSpend, setAvgSpend] = useState<number>(DEFAULT_AVG_SPEND);

    // RP-012: with 85k reviews the default hits the 8,000 cap and the projection
    // is really cap × 9% × ₹400 — a number about the cap, not the restaurant. Say
    // so and ask for the real figure instead of presenting the clamp as a fact.
    const capped = report.base.totalRatings * 2 > GUESTS_MAX && guests === GUESTS_MAX;
    const extraGuests = Math.round(guests * UPLIFT_PCT);
    const extraPerMonth = extraGuests * avgSpend;
    const extraPerYear = extraPerMonth * 12;

    const inputClass =
        'w-28 rounded-lg bg-white/95 text-ink text-sm px-3 py-2 focus:outline-none tabular-nums';

    return (
        <div className="bg-banner rounded-2xl p-6 text-white" data-testid="revenue-card">
            <div className="flex items-center gap-2 mb-1">
                <h3 className="text-base font-semibold text-white">What fixing this could be worth</h3>
                <ProvenanceChip provenance="computed" />
            </div>
            <p className="text-sidebar-ink text-sm max-w-2xl leading-relaxed">
                If fixing your profile, reviews and website brought in {Math.round(UPLIFT_PCT * 100)}% more guests a month —
                a modest lift restaurants commonly see — this is what it adds up to at your numbers below. An estimate,
                not a promise.
            </p>
            {capped && (
                <p className="mt-2 text-xs text-white/90 leading-relaxed" data-testid="revenue-capped-note">
                    We don’t know how many guests you serve, so we started at {GUESTS_MAX.toLocaleString('en-IN')} a month —
                    the highest we assume without being told. Enter your real monthly guests to make this yours.
                </p>
            )}

            <div className="mt-4 flex flex-wrap items-end gap-5">
                <label className="text-xs font-semibold text-sidebar-ink">
                    <span className="block mb-1 uppercase tracking-wider">Guests a month</span>
                    <input
                        type="number"
                        value={guests}
                        min={GUESTS_MIN}
                        max={GUESTS_MAX}
                        aria-label="Guests per month"
                        onChange={(e) => setGuests(clampGuests(Number(e.target.value)))}
                        className={inputClass}
                    />
                </label>
                <label className="text-xs font-semibold text-sidebar-ink">
                    <span className="block mb-1 uppercase tracking-wider">Spend per guest (₹)</span>
                    <input
                        type="number"
                        value={avgSpend}
                        min={0}
                        aria-label="Average spend"
                        onChange={(e) => setAvgSpend(clampSpend(Number(e.target.value)))}
                        className={inputClass}
                    />
                </label>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-white/15 pt-4">
                <Metric label="Extra guests a month" value={`+${extraGuests.toLocaleString('en-IN')}`} />
                <Metric label="Extra revenue a month" value={inr(extraPerMonth)} />
                <Metric label="Extra revenue a year" value={inr(extraPerYear)} />
            </div>

            <p className="text-[11px] text-sidebar-ink mt-3 leading-relaxed hidden sm:block">
                Assumes {guests.toLocaleString('en-IN')} guests a month × {Math.round(UPLIFT_PCT * 100)}% more guests ×{' '}
                {inr(avgSpend)} per guest. Our starting guess for guests is your Google review count × 2, kept between{' '}
                {GUESTS_MIN.toLocaleString('en-IN')} and {GUESTS_MAX.toLocaleString('en-IN')}. Edit the numbers to match your restaurant.
            </p>
        </div>
    );
};

export default RevenueCard;
