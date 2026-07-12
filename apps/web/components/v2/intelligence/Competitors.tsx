import React, { useMemo, useState } from 'react';
import type { CompetitorProfile, IntelligenceReport } from '@restropulse/shared';
import { TOKENS, intensity } from '../theme';
import { ThreatBar } from './primitives';
import { ProvenanceChip } from './provenance';
import { ThreatRadar } from './ThreatRadar';

/**
 * Competitors sub-tab (DESIGN §4.2) — threat radar, a static lat/lng map
 * scatter, a sortable/filterable competitor table (rows expand to the Sonnet
 * qualitative layer), same-cuisine + rising-newcomer strips, and the cuisine
 * review-share breakdown.
 */

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-surface rounded-2xl p-6 border border-line ${className}`}>{children}</div>
);

type SortKey = 'threatScore' | 'distanceKm' | 'rating' | 'totalRatings';

// ---- Static map scatter from lat/lng (no Maps JS key in the client) ----
const MapScatter: React.FC<{ base: IntelligenceReport['base']; competitors: CompetitorProfile[] }> = ({ base, competitors }) => {
    const pts = [{ lat: base.location.lat, lng: base.location.lng }, ...competitors.map((c) => ({ lat: c.lat, lng: c.lng }))];
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const W = 320, H = 240, pad = 24;
    const x = (lng: number) => (maxLng === minLng ? W / 2 : pad + ((lng - minLng) / (maxLng - minLng)) * (W - 2 * pad));
    const y = (lat: number) => (maxLat === minLat ? H / 2 : H - pad - ((lat - minLat) / (maxLat - minLat)) * (H - 2 * pad));
    return (
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Competitor map" className="rounded-xl bg-canvas max-w-[360px]">
            {competitors.map((c) => (
                <circle key={c.placeId} cx={x(c.lng)} cy={y(c.lat)} r={5 + (c.threatScore / 100) * 7} fill={intensity(c.threatScore / 100)} fillOpacity={0.85}>
                    <title>{`${c.name} · threat ${c.threatScore}`}</title>
                </circle>
            ))}
            {/* Base — starred */}
            <g transform={`translate(${x(base.location.lng)}, ${y(base.location.lat)})`}>
                <circle r={7} fill={TOKENS.primaryStrong} />
                <path d="M0,-11 L2.6,-3.4 L10.5,-3.4 L4,1.3 L6.5,9 L0,4.3 L-6.5,9 L-4,1.3 L-10.5,-3.4 L-2.6,-3.4 Z" fill={TOKENS.primaryStrong} fillOpacity={0.35} />
                <title>{`${base.name} (you)`}</title>
            </g>
        </svg>
    );
};

const AiList: React.FC<{ title: string; items?: string[]; tone?: 'good' | 'bad' }> = ({ title, items, tone }) => {
    if (!items || !items.length) return null;
    return (
        <div>
            <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-muted'}`}>{title}</p>
            <ul className="space-y-1">
                {items.map((it, i) => (
                    <li key={i} className="text-xs text-muted leading-relaxed">• {it}</li>
                ))}
            </ul>
        </div>
    );
};

const CompetitorRow: React.FC<{ c: CompetitorProfile }> = ({ c }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="border-b border-line last:border-b-0">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="w-full text-left py-3 grid grid-cols-2 md:grid-cols-[2fr_1fr_0.8fr_0.8fr_1fr_auto] gap-2 md:gap-3 md:items-center hover:bg-canvas/60 transition-colors rounded-lg px-1"
            >
                <span className="text-sm font-medium text-ink truncate col-span-2 md:col-span-1">{c.name}</span>
                <span className="text-xs text-muted">{c.cuisine}</span>
                <span className="text-xs text-muted tabular-nums">{c.distanceKm.toFixed(1)} km</span>
                <span className="text-xs text-ink tabular-nums">★ {c.rating.toFixed(1)}</span>
                <span className="text-xs text-muted tabular-nums">{c.totalRatings.toLocaleString('en-IN')}</span>
                <span className="justify-self-start md:justify-self-end"><ThreatBar value={c.threatScore} /></span>
            </button>
            {open && (
                <div className="pb-4 px-1">
                    <div className="grid sm:grid-cols-2 gap-4 rounded-xl bg-canvas p-4">
                        <AiList title="Strengths" items={c.strengths} tone="bad" />
                        <AiList title="Weaknesses" items={c.weaknesses} tone="good" />
                        <AiList title="Where you win" items={c.whereYouWin} tone="good" />
                        <AiList title="What they do better" items={c.whatTheyDoBetter} tone="bad" />
                    </div>
                    {(c.pricingInsight || c.marketingEdge) && (
                        <div className="mt-3 space-y-2">
                            {c.pricingInsight && (
                                <p className="text-xs text-muted flex items-start gap-2 flex-wrap">
                                    <ProvenanceChip provenance="ai-inferred" /> <span className="leading-relaxed">{c.pricingInsight}</span>
                                </p>
                            )}
                            {c.marketingEdge && (
                                <p className="text-xs text-muted flex items-start gap-2 flex-wrap">
                                    <ProvenanceChip provenance="ai-inferred" /> <span className="leading-relaxed">{c.marketingEdge}</span>
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const CuisineBreakdown: React.FC<{ report: IntelligenceReport }> = ({ report }) => {
    const [expanded, setExpanded] = useState<string | null>(null);
    const buckets = report.cuisineBreakdown;
    return (
        <Card>
            <h3 className="text-base font-semibold text-ink">Market by cuisine</h3>
            <p className="text-xs text-muted mt-1">Share of nearby review volume.</p>
            <div className="mt-4 flex h-4 rounded-full overflow-hidden border border-line" role="img" aria-label="Cuisine review share">
                {buckets.map((b, i) => (
                    <div key={b.cuisine} style={{ width: `${b.reviewShare * 100}%`, background: intensity(1 - i / Math.max(1, buckets.length)) }} title={`${b.cuisine} ${(b.reviewShare * 100).toFixed(0)}%`} />
                ))}
            </div>
            <div className="mt-4 space-y-1">
                {buckets.map((b) => (
                    <div key={b.cuisine} className="border-b border-line last:border-b-0">
                        <button type="button" onClick={() => setExpanded((e) => (e === b.cuisine ? null : b.cuisine))} className="w-full flex items-center justify-between py-2 text-left">
                            <span className="text-sm text-ink">{b.cuisine}</span>
                            <span className="text-xs text-muted tabular-nums">{(b.reviewShare * 100).toFixed(0)}% · ★ {b.avgRating.toFixed(1)}</span>
                        </button>
                        {expanded === b.cuisine && (
                            <p className="text-xs text-muted pb-2 leading-relaxed">{b.restaurants.join(' · ')}</p>
                        )}
                    </div>
                ))}
            </div>
        </Card>
    );
};

const MiniCompetitorCard: React.FC<{ c: CompetitorProfile }> = ({ c }) => (
    <div className="shrink-0 w-56 rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-semibold text-ink truncate">{c.name}</p>
        <p className="text-xs text-muted mt-0.5">{c.cuisine} · {c.distanceKm.toFixed(1)} km</p>
        <div className="flex items-center justify-between mt-3 text-xs">
            <span className="text-ink font-semibold">★ {c.rating.toFixed(1)}</span>
            <span className="text-muted tabular-nums">{c.totalRatings.toLocaleString('en-IN')} reviews</span>
        </div>
        <div className="mt-2"><ThreatBar value={c.threatScore} /></div>
    </div>
);

const Competitors: React.FC<{ report: IntelligenceReport }> = ({ report }) => {
    const [sort, setSort] = useState<SortKey>('threatScore');
    const [cuisine, setCuisine] = useState<string>('all');

    const cuisines = useMemo(() => ['all', ...Array.from(new Set(report.competitors.map((c) => c.cuisine)))], [report.competitors]);

    const rows = useMemo(() => {
        const filtered = cuisine === 'all' ? report.competitors : report.competitors.filter((c) => c.cuisine === cuisine);
        return [...filtered].sort((a, b) => (sort === 'distanceKm' ? a[sort] - b[sort] : b[sort] - a[sort]));
    }, [report.competitors, cuisine, sort]);

    // Rising newcomers: strong early rating, still thin review base.
    const newcomers = useMemo(
        () => report.competitors.filter((c) => c.rating >= 4.1 && c.totalRatings <= 1000).sort((a, b) => b.rating - a.rating),
        [report.competitors],
    );

    return (
        <div className="space-y-6">
            {/* Radar + map */}
            <div className="grid md:grid-cols-2 gap-4">
                <Card className="flex flex-col items-center">
                    <h3 className="text-base font-semibold text-ink self-start">Threat radar</h3>
                    <p className="text-xs text-muted self-start mb-2">Closer to the centre = a bigger threat to you.</p>
                    <ThreatRadar base={{ lat: report.base.location.lat, lng: report.base.location.lng, name: report.base.name }} competitors={report.topCompetitors} />
                </Card>
                <Card className="flex flex-col items-center">
                    <h3 className="text-base font-semibold text-ink self-start">Nearby map</h3>
                    <p className="text-xs text-muted self-start mb-2">Bubble size &amp; shade scale with threat. ★ is you.</p>
                    <MapScatter base={report.base} competitors={report.competitors} />
                </Card>
            </div>

            {/* Table */}
            <Card>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <h3 className="text-base font-semibold text-ink">All competitors ({report.competitors.length})</h3>
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-muted">
                            Cuisine
                            <select value={cuisine} onChange={(e) => setCuisine(e.target.value)} className="ml-1.5 text-xs border border-line rounded-lg px-2 py-1 bg-surface text-ink">
                                {cuisines.map((c) => (
                                    <option key={c} value={c}>{c === 'all' ? 'All' : c}</option>
                                ))}
                            </select>
                        </label>
                        <label className="text-xs text-muted">
                            Sort
                            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="ml-1.5 text-xs border border-line rounded-lg px-2 py-1 bg-surface text-ink">
                                <option value="threatScore">Threat</option>
                                <option value="distanceKm">Distance</option>
                                <option value="rating">Rating</option>
                                <option value="totalRatings">Reviews</option>
                            </select>
                        </label>
                    </div>
                </div>
                {/* Column header — desktop only */}
                <div className="hidden md:grid grid-cols-[2fr_1fr_0.8fr_0.8fr_1fr_auto] gap-3 px-1 pb-2 text-[11px] font-semibold text-muted uppercase tracking-wider border-b border-line">
                    <span>Name</span><span>Cuisine</span><span>Distance</span><span>Rating</span><span>Reviews</span><span className="md:justify-self-end">Threat</span>
                </div>
                <div>
                    {rows.map((c) => (
                        <CompetitorRow key={c.placeId} c={c} />
                    ))}
                </div>
            </Card>

            {/* Strips */}
            {report.sameCuisineNearby.length > 0 && (
                <div>
                    <h3 className="text-base font-semibold text-ink mb-3">Same-cuisine rivals</h3>
                    <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
                        {report.sameCuisineNearby.slice(0, 8).map((c) => (
                            <MiniCompetitorCard key={c.placeId} c={c} />
                        ))}
                    </div>
                </div>
            )}
            {newcomers.length > 0 && (
                <div>
                    <h3 className="text-base font-semibold text-ink mb-3">Rising newcomers</h3>
                    <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
                        {newcomers.map((c) => (
                            <MiniCompetitorCard key={c.placeId} c={c} />
                        ))}
                    </div>
                </div>
            )}

            <CuisineBreakdown report={report} />
        </div>
    );
};

export default Competitors;
