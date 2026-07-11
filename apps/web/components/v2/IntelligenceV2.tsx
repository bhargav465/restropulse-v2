import React, { useEffect, useMemo, useState } from 'react';
import type { IntelligenceReport, IntelligenceSelfMetrics, PillarScore, Restaurant } from '@restropulse/shared';
import { intelligenceAPI } from '../../api';
import { SubNav, SubNavTab } from './primitives';
import { ScoreDial, PillarBar, CheckRow, type Grade, PILLAR_LABELS, gradeTextClass } from './intelligence/primitives';
import { ProvenanceChip, ProvenanceLegend } from './intelligence/provenance';
import { resolveActionHref, type DeepLinkTarget } from './intelligence/deep-links';
import ScanFlow from './intelligence/ScanFlow';
import Overview from './intelligence/Overview';
import Competitors from './intelligence/Competitors';
import Reviews from './intelligence/Reviews';
import SearchSEO from './intelligence/SearchSEO';
import YourMetrics from './intelligence/YourMetrics';

/**
 * Restaurant Intelligence bucket (DESIGN.md). Replaces the placeholder with a
 * sub-tab router: RestroScore header band (§3) + 5 sub-tabs (§4), plus the
 * empty state / scan stepper (§2). Renders entirely from the [SAMPLE] fixture
 * in demo mode with zero backend (intelligenceAPI → demo twin).
 */

type IntelTab = 'OVERVIEW' | 'COMPETITORS' | 'REVIEWS' | 'SEARCH' | 'METRICS';

interface IntelligenceV2Props {
    restaurantData: Restaurant;
    /** Deep-link navigation into other buckets (wired by ShellV2). */
    onNavigate?: (target: DeepLinkTarget) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function relativeDays(from: Date): string {
    const diff = Date.now() - from.getTime();
    const d = Math.floor(diff / DAY_MS);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    return `${d}d ago`;
}

// ---- RestroScore header band (DESIGN §3) ----
const HeaderBand: React.FC<{
    report: IntelligenceReport;
    selectedPillar: PillarScore['key'] | null;
    onSelectPillar: (key: PillarScore['key']) => void;
    onRescan: () => void;
    onNavigate: (t: DeepLinkTarget) => void;
}> = ({ report, selectedPillar, onSelectPillar, onRescan, onNavigate }) => {
    const grade: Grade = restroGrade(report.restroScore);
    const scannedAt = new Date(report.generatedAt);
    const withinWindow = Date.now() - scannedAt.getTime() < DAY_MS;

    return (
        <div className="bg-surface rounded-2xl p-6 border border-line">
            <div className="grid gap-6 lg:grid-cols-[auto_1fr_auto] lg:items-center">
                {/* Dial */}
                <div className="flex justify-center lg:justify-start">
                    <ScoreDial score={report.restroScore} grade={grade} delta={report.deltas?.restroScoreDelta} />
                </div>

                {/* Pillars */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                    {report.pillars.map((p) => (
                        <PillarBar key={p.key} pillar={p} onSelect={onSelectPillar} />
                    ))}
                </div>

                {/* Rank + re-scan */}
                <div className="flex flex-col items-start lg:items-end gap-2">
                    <p className="text-sm text-ink font-semibold">
                        Rank #{report.ranking.rank} <span className="text-muted font-normal">of {report.ranking.total} nearby</span>
                    </p>
                    <p className="text-xs text-muted">Scanned {relativeDays(scannedAt)}</p>
                    <button
                        type="button"
                        onClick={onRescan}
                        disabled={withinWindow}
                        title={withinWindow ? 'You can re-scan once every 24 hours' : 'Run a fresh scan'}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-line text-primary-strong hover:bg-primary-soft transition-colors disabled:opacity-50 disabled:hover:bg-surface"
                    >
                        Re-scan
                    </button>
                </div>
            </div>

            {/* Provenance legend */}
            <div className="mt-5 pt-4 border-t border-line">
                <ProvenanceLegend />
            </div>

            {/* Selected pillar checks (scrolls into view via the panel below the band) */}
            {selectedPillar && <PillarChecks report={report} pillarKey={selectedPillar} onNavigate={onNavigate} />}
        </div>
    );
};

const PillarChecks: React.FC<{
    report: IntelligenceReport;
    pillarKey: PillarScore['key'];
    onNavigate?: (t: DeepLinkTarget) => void;
}> = ({ report, pillarKey, onNavigate }) => {
    const pillar = report.pillars.find((p) => p.key === pillarKey);
    if (!pillar) return null;
    return (
        <div className="mt-4 rounded-xl bg-canvas p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
                <h4 className="text-sm font-semibold text-ink">
                    {PILLAR_LABELS[pillar.key]} · <span className={gradeTextClass(pillar.grade)}>grade {pillar.grade}</span>
                </h4>
                <ProvenanceChip provenance={pillar.provenance} source={pillar.provenance === 'measured' ? 'Google' : undefined} />
            </div>
            <div>
                {pillar.checks.map((chk) => {
                    const target = resolveActionHref(chk.actionHref);
                    return (
                        <CheckRow
                            key={chk.id}
                            label={chk.label}
                            pass={chk.pass}
                            note={chk.note}
                            action={!chk.pass && target && onNavigate ? { label: target.cta, href: target.href, onClick: () => onNavigate(target) } : undefined}
                        />
                    );
                })}
            </div>
        </div>
    );
};

function restroGrade(score: number): Grade {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

const IntelligenceV2: React.FC<IntelligenceV2Props> = ({ restaurantData, onNavigate }) => {
    const [report, setReport] = useState<IntelligenceReport | null | undefined>(undefined);
    const [selfMetrics, setSelfMetrics] = useState<IntelligenceSelfMetrics | null>(null);
    const [tab, setTab] = useState<IntelTab>('OVERVIEW');
    const [selectedPillar, setSelectedPillar] = useState<PillarScore['key'] | null>(null);
    const [rescanning, setRescanning] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const latest = await intelligenceAPI.getLatestReport();
                if (!cancelled) setReport(latest);
            } catch {
                if (!cancelled) setReport(null);
            }
            try {
                const metrics = await intelligenceAPI.getSelfMetrics();
                if (!cancelled) setSelfMetrics(metrics);
            } catch {
                /* self-metrics optional */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [restaurantData.id]);

    const nav = onNavigate ?? (() => {});
    const scanDefaults = useMemo(
        () => ({ name: restaurantData.name, city: restaurantData.sourceCity ?? '' }),
        [restaurantData.name, restaurantData.sourceCity],
    );

    const tabs: Array<SubNavTab<IntelTab>> = [
        { id: 'OVERVIEW', label: 'Overview' },
        { id: 'COMPETITORS', label: 'Competitors' },
        { id: 'REVIEWS', label: 'Reviews & Sentiment' },
        { id: 'SEARCH', label: 'Search & SEO' },
        { id: 'METRICS', label: 'Your Metrics' },
    ];

    // Loading
    if (report === undefined) {
        return <div className="text-sm text-muted">Loading your intelligence…</div>;
    }

    // Re-scan in progress (report exists, running a fresh scan)
    if (rescanning) {
        return (
            <ScanFlow
                variant="rescan"
                force
                defaults={scanDefaults}
                api={intelligenceAPI}
                onReport={(r) => {
                    setReport(r);
                    setRescanning(false);
                }}
                onCancel={() => setRescanning(false)}
            />
        );
    }

    // Empty state (no report yet)
    if (report === null) {
        return <ScanFlow variant="first-run" defaults={scanDefaults} api={intelligenceAPI} onReport={setReport} />;
    }

    return (
        <div className="space-y-6">
            <HeaderBand
                report={report}
                selectedPillar={selectedPillar}
                onSelectPillar={(k) => setSelectedPillar((cur) => (cur === k ? null : k))}
                onRescan={() => setRescanning(true)}
                onNavigate={nav}
            />

            <SubNav tabs={tabs} active={tab} onChange={setTab} label="Intelligence sections" />

            {tab === 'OVERVIEW' && <Overview report={report} onNavigate={nav} />}
            {tab === 'COMPETITORS' && <Competitors report={report} />}
            {tab === 'REVIEWS' && <Reviews report={report} onNavigate={nav} />}
            {tab === 'SEARCH' && <SearchSEO report={report} onNavigate={nav} />}
            {tab === 'METRICS' &&
                (selfMetrics ? (
                    <YourMetrics metrics={selfMetrics} onNavigate={nav} />
                ) : (
                    <div className="text-sm text-muted">Loading your metrics…</div>
                ))}
        </div>
    );
};

export default IntelligenceV2;
