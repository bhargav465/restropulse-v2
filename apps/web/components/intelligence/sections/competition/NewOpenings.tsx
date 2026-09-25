import React, { useEffect, useState } from 'react';
import { intelligenceAPI, type NewOpening } from '../../../../api';
import { resolveDeepLink, type DeepLinkTarget } from '../deep-links';
import type { IntelligenceReport } from '@restropulse/shared';

/**
 * NewOpenings (Brief 09 §3) — the 5 km new-openings radar. `sinceDays` chip
 * filter (30/60/90), radius fixed at 5 km. Cards show name, cuisine chip,
 * distance, first-seen date and review ramp; `fastStarter` is flagged
 * `text-warning`. Actions: add-to-watchlist (disabled at 5/5 with a tooltip) and
 * "Draft a response post" → Content Engine. Friendly empty state.
 */

const SINCE_OPTIONS: Array<30 | 60 | 90> = [30, 60, 90];

export const NewOpeningsView: React.FC<{
    /** True when there is no previous report/sightings to diff against. */
    firstScan?: boolean;
    openings: NewOpening[];
    sinceDays: 30 | 60 | 90;
    onSinceDaysChange: (d: 30 | 60 | 90) => void;
    atCapacity: boolean;
    trackedPlaceIds: Set<string>;
    onAdd: (o: NewOpening) => void;
    onNavigate: (t: DeepLinkTarget) => void;
}> = ({ firstScan, openings, sinceDays, onSinceDaysChange, atCapacity, trackedPlaceIds, onAdd, onNavigate }) => (
    <div className="space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-base font-semibold text-ink">Opened recently within 7 km</h3>
            <div className="inline-flex items-center gap-1 rounded-xl bg-primary-soft p-1">
                {SINCE_OPTIONS.map((d) => (
                    <button
                        key={d}
                        type="button"
                        aria-pressed={sinceDays === d}
                        onClick={() => onSinceDaysChange(d)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            sinceDays === d ? 'bg-primary text-white' : 'text-primary-strong hover:bg-surface/60'
                        }`}
                    >
                        {d}d
                    </button>
                ))}
            </div>
        </div>

        {openings.length === 0 ? (
            <div className="bg-surface rounded-2xl p-4 sm:p-6 border border-line" data-testid="openings-empty">
                {firstScan ? (
                    <>
                        <p className="text-sm font-semibold text-ink">No likely newcomers within 7 km</p>
                        <p className="text-sm text-muted mt-1 leading-relaxed">
                            Nothing near you looks freshly opened (every rival already has a substantial review history). From
                            your next scan onward, anyone who newly appears near you shows up here automatically.
                        </p>
                    </>
                ) : (
                    <p className="text-sm text-muted">
                        No new openings within 7 km in the last {sinceDays} days — quiet streets are good news.
                    </p>
                )}
            </div>
        ) : (
            <div className="grid sm:grid-cols-2 gap-4">
                {openings.map((o) => {
                    const tracked = trackedPlaceIds.has(o.placeId);
                    return (
                        <div key={o.placeId} className="rounded-xl border border-line bg-surface p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-ink truncate">{o.name}</p>
                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                        {o.cuisine && <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary-soft text-primary-strong">{o.cuisine}</span>}
                                        <span className="text-xs text-muted">{o.distanceKm.toFixed(1)} km</span>
                                    </div>
                                </div>
                                {o.fastStarter && <span className="text-xs font-semibold text-warning shrink-0">Growing fast</span>}
                            </div>
                            {o.daysSinceFirstSeen === 0 && o.reviewsSinceFirstSeen === 0 ? (
                                <p className="text-xs text-muted mt-2">
                                    Only {o.currentReviewCount.toLocaleString('en-IN')} review{o.currentReviewCount === 1 ? '' : 's'} on Google — usually a recent opening <span className="italic">(our estimate)</span>
                                </p>
                            ) : (
                                <p className="text-xs text-muted mt-2">
                                    First seen {new Date(o.firstSeenAt).toISOString().slice(0, 10)} · +{o.reviewsSinceFirstSeen} reviews in {o.daysSinceFirstSeen}d
                                </p>
                            )}
                            <div className="flex items-center gap-3 mt-3">
                                <button
                                    type="button"
                                    onClick={() => onAdd(o)}
                                    disabled={atCapacity || tracked}
                                    title={tracked ? 'You already track this restaurant' : atCapacity ? 'You’re tracking the maximum (5) — remove one to add another' : 'Track this restaurant'}
                                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary-strong text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {tracked ? 'Tracked' : 'Track this restaurant'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onNavigate(resolveDeepLink({ bucket: 'content', params: { brief: 'new-competitor-response' } }))}
                                    title="/admin/content"
                                    className="text-xs font-semibold text-primary-strong hover:underline"
                                >
                                    Draft a response post →
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        )}
    </div>
);

/**
 * Day-0/day-N fallback: the sightings sweep only has data once the worker has
 * run twice. Until then, the report's `deltas.newCompetitors` (names of rivals
 * that appeared since the previous scan) is the honest source of "new near you".
 */
/** Review count at or below which we treat a place as "likely opened recently". */
export const LIKELY_NEW_MAX_REVIEWS = 100;
const LIKELY_NEW_RADIUS_KM = 7;
const LIKELY_NEW_MAX = 10;

export function seedFromReport(report?: IntelligenceReport | null): NewOpening[] {
    if (!report) return [];
    const generated = new Date(report.generatedAt).toISOString();
    const toOpening = (c: (typeof report.competitors)[number]): NewOpening => ({
        placeId: c.placeId,
        name: c.name,
        cuisine: c.cuisine,
        distanceKm: c.distanceKm,
        firstSeenAt: generated,
        ratingAtFirstSeen: c.rating,
        reviewsAtFirstSeen: c.totalRatings,
        currentReviewCount: c.totalRatings,
        reviewsSinceFirstSeen: 0,
        daysSinceFirstSeen: 0,
        fastStarter: false,
    });

    // 1. Real newcomers: appeared since the previous scan (needs two scans).
    const names = new Set(report.deltas?.newCompetitors ?? []);
    const confirmed = (report.competitors ?? []).filter((c) => names.has(c.name)).map(toOpening);
    const seen = new Set(confirmed.map((o) => o.placeId));

    // 2. Likely-new heuristic: Google has no "opened on" date, but a restaurant
    //    with only a handful of reviews is almost always a recent opening. Within
    //    7 km, fewest reviews first, honestly labelled as an estimate in the UI.
    const likely = (report.competitors ?? [])
        .filter((c) => c.distanceKm <= LIKELY_NEW_RADIUS_KM && c.totalRatings > 0 && c.totalRatings <= LIKELY_NEW_MAX_REVIEWS && !seen.has(c.placeId))
        .sort((a, b) => a.totalRatings - b.totalRatings)
        .slice(0, LIKELY_NEW_MAX)
        .map(toOpening);

    return [...confirmed, ...likely];
}

/** Container: fetches openings for the current sinceDays + wires add-to-watchlist. */
const NewOpenings: React.FC<{ report?: IntelligenceReport | null; onNavigate: (t: DeepLinkTarget) => void }> = ({ report, onNavigate }) => {
    const [sinceDays, setSinceDays] = useState<30 | 60 | 90>(90);
    const [openings, setOpenings] = useState<NewOpening[] | null>(null);
    const [tracked, setTracked] = useState<Set<string>>(new Set());
    const [max, setMax] = useState(5);
    const [count, setCount] = useState(0);

    const loadWatchlist = async () => {
        const wl = await intelligenceAPI.getWatchlist();
        setTracked(new Set(wl.entries.map((e) => e.placeId)));
        setMax(wl.max);
        setCount(wl.entries.length);
    };

    useEffect(() => {
        loadWatchlist().catch(() => {});
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setOpenings(null);
            try {
                const res = await intelligenceAPI.getNewOpenings({ sinceDays, radiusKm: 7 });
                if (cancelled) return;
                if (res.length > 0) {
                    setOpenings(res);
                    return;
                }
                // Sightings sweep has nothing yet: seed from the report's own diff —
                // competitors that appeared since the PREVIOUS report.
                setOpenings(seedFromReport(report));
            } catch {
                if (!cancelled) setOpenings(seedFromReport(report));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [sinceDays]);

    const onAdd = async (o: NewOpening) => {
        if (count >= max) return;
        const wl = await intelligenceAPI.getWatchlist();
        try {
            await intelligenceAPI.putWatchlist([
                ...wl.entries.map((e) => ({ placeId: e.placeId, name: e.name, zomatoUrl: e.zomatoUrl })),
                { placeId: o.placeId, name: o.name },
            ]);
            await loadWatchlist();
        } catch {
            /* cap enforced server-side; ignore */
        }
    };

    if (openings === null) return <p className="text-sm text-muted">Scanning nearby streets…</p>;

    return (
        <NewOpeningsView
            firstScan={!report?.deltas}
            openings={openings}
            sinceDays={sinceDays}
            onSinceDaysChange={setSinceDays}
            atCapacity={count >= max}
            trackedPlaceIds={tracked}
            onAdd={onAdd}
            onNavigate={onNavigate}
        />
    );
};

export default NewOpenings;
