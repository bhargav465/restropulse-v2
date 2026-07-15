import React, { useEffect, useMemo, useState } from 'react';
import type { CompareRow, MetricGap, CompetitorProfile, IntelligenceReport } from '@restropulse/shared';
import { intelligenceAPI } from '../../../../api';
import { compareParamsFor, type PeriodQuery } from '../period';
import { ThreatRadar } from '../ThreatRadar';
import { ProvenanceChip } from '../provenance';
import { resolveDeepLink, type DeepLinkTarget } from '../deep-links';

/**
 * WhereTheyBeatYou (Brief 09 §3) — one card per competitor with a non-empty
 * `beatsYou`. Deterministic `computed` gaps first (rating, review velocity,
 * response rate, photos), then the v1 `ai-inferred` whatTheyDoBetter/whereYouWin
 * lists. Cards are sorted by summed gap severity; each ends with a "Close this
 * gap →" deep link chosen by the top gap's type. ThreatRadar sits on top.
 */

/** Normalized per-gap severity so heterogeneous metrics sort sensibly. */
export function gapSeverity(gap: MetricGap): number {
    switch (gap.metric) {
        case 'rating':
            return gap.gap * 10;
        case 'reviewVelocity':
            return gap.gap * 2;
        case 'responseRate':
            return gap.gap * 0.2;
        case 'photoCount':
            return gap.gap * 0.05;
        default:
            return gap.gap;
    }
}

export function rowSeverity(row: CompareRow): number {
    return row.beatsYou.reduce((s, g) => s + gapSeverity(g), 0);
}

/** Deep-link bucket for the highest-severity gap type. */
function closeGapTarget(gaps: MetricGap[]): DeepLinkTarget {
    const top = [...gaps].sort((a, b) => gapSeverity(b) - gapSeverity(a))[0];
    switch (top?.metric) {
        case 'photoCount':
            return resolveDeepLink({ bucket: 'content', params: { brief: 'fresh-photos' } });
        case 'reviewVelocity':
            return resolveDeepLink({ bucket: 'campaigns', params: { goal: 'reviews' } });
        case 'rating':
        case 'responseRate':
        default:
            return resolveDeepLink({ bucket: 'get-started', params: { task: 'review-replies' } });
    }
}

const GAP_LABEL: Record<MetricGap['metric'], (g: MetricGap) => string> = {
    rating: (g) => `+${g.gap.toFixed(1)} rating (${g.source})`,
    reviewVelocity: (g) => `${(g.theirs / (g.yours || 1)).toFixed(1)}× review velocity (${g.source})`,
    responseRate: (g) => `responds ${g.theirs}% vs your ${g.yours}% (${g.source})`,
    photoCount: (g) => `+${g.gap} photos (${g.source})`,
};

const AiList: React.FC<{ title: string; items?: string[]; tone: 'good' | 'bad' }> = ({ title, items, tone }) => {
    if (!items || items.length === 0) return null;
    return (
        <div>
            <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${tone === 'good' ? 'text-success' : 'text-danger'}`}>{title}</p>
            <ul className="space-y-1">
                {items.map((it, i) => (
                    <li key={i} className="text-xs text-muted leading-relaxed">• {it}</li>
                ))}
            </ul>
        </div>
    );
};

export const WhereTheyBeatYouView: React.FC<{
    rows: CompareRow[];
    profilesByName: Record<string, CompetitorProfile>;
    radar?: { base: { lat: number; lng: number; name: string }; competitors: CompetitorProfile[] };
    onNavigate: (t: DeepLinkTarget) => void;
}> = ({ rows, profilesByName, radar, onNavigate }) => {
    const cards = rows
        .filter((r) => !r.isSelf && r.beatsYou.length > 0)
        .sort((a, b) => rowSeverity(b) - rowSeverity(a));

    if (cards.length === 0) {
        return <p className="text-sm text-muted">No competitor is beating you on any tracked metric right now. Keep it up.</p>;
    }

    return (
        <div className="space-y-6">
            {radar && (
                <div className="bg-surface rounded-2xl p-6 border border-line flex flex-col items-center">
                    <h3 className="text-base font-semibold text-ink self-start">Threat radar</h3>
                    <p className="text-xs text-muted self-start mb-2">Closer to the centre = a bigger threat to you.</p>
                    <ThreatRadar base={radar.base} competitors={radar.competitors} />
                </div>
            )}

            {cards.map((row) => {
                const profile = profilesByName[row.name];
                const target = closeGapTarget(row.beatsYou);
                return (
                    <div key={row.placeId} className="bg-surface rounded-2xl p-6 border border-line">
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <h3 className="text-base font-semibold text-ink">{row.name}</h3>
                            <ProvenanceChip provenance="computed" />
                        </div>
                        {/* Deterministic gaps */}
                        <div className="flex flex-wrap gap-2 mb-4">
                            {row.beatsYou.map((g, i) => (
                                <span key={i} className="inline-flex items-center px-3 py-1.5 rounded-lg border border-line bg-canvas text-xs font-medium text-ink">
                                    {GAP_LABEL[g.metric](g)}
                                </span>
                            ))}
                        </div>
                        {/* v1 ai-inferred lists */}
                        {profile && (profile.whatTheyDoBetter || profile.whereYouWin) && (
                            <div className="grid sm:grid-cols-2 gap-4 rounded-xl bg-canvas p-4 mb-4">
                                <AiList title="What they do better" items={profile.whatTheyDoBetter} tone="bad" />
                                <AiList title="Where you win" items={profile.whereYouWin} tone="good" />
                                <div className="sm:col-span-2">
                                    <ProvenanceChip provenance="ai-inferred" />
                                </div>
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => onNavigate(target)}
                            title={target.href}
                            className="text-xs font-semibold text-primary-strong hover:underline"
                        >
                            Close this gap →
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

/** Container: fetches compare rows for the period and joins the v1 report layer. */
const WhereTheyBeatYou: React.FC<{
    query: PeriodQuery;
    report: IntelligenceReport | null;
    onNavigate: (t: DeepLinkTarget) => void;
}> = ({ query, report, onNavigate }) => {
    const [rows, setRows] = useState<CompareRow[] | null>(null);
    const params = useMemo(() => compareParamsFor(query), [query.from, query.to, query.granularity]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setRows(null);
            try {
                const data = await intelligenceAPI.getCompare(params);
                if (!cancelled) setRows(data);
            } catch {
                if (!cancelled) setRows([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [params.granularity, (params as { date?: string }).date, (params as { month?: string }).month]);

    if (rows === null) return <p className="text-sm text-muted">Loading where they beat you…</p>;

    const profilesByName = report ? Object.fromEntries(report.competitors.map((c) => [c.name, c])) : {};
    const radar = report
        ? { base: { lat: report.base.location.lat, lng: report.base.location.lng, name: report.base.name }, competitors: report.topCompetitors }
        : undefined;
    return <WhereTheyBeatYouView rows={rows} profilesByName={profilesByName} radar={radar} onNavigate={onNavigate} />;
};

export default WhereTheyBeatYou;
