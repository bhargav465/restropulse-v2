import React, { useEffect, useMemo, useState } from 'react';
import type { IntelligenceReport, IntelligenceSelfMetrics, PillarScore, Restaurant } from '@restropulse/shared';
import { intelligenceAPI, restaurantAPI } from '../../api';
import { SubNav, SubNavTab } from './primitives';
import { ScoreDial, PillarBar, CheckRow, type Grade, PILLAR_LABELS, gradeTextClass } from './intelligence/primitives';
import { ProvenanceChip, ProvenanceLegend } from './intelligence/provenance';
import { resolveActionHref, type DeepLinkTarget } from './intelligence/deep-links';
import ScanFlow from './intelligence/ScanFlow';
import { BucketSwitch } from './intelligence/BucketSwitch';
import { PeriodFilter } from './intelligence/PeriodFilter';
import {
    type BucketId,
    type MineSelection,
    type CompetitionSelection,
    defaultMineSelection,
    defaultCompetitionSelection,
    mineQuery,
    competitionQuery,
} from './intelligence/period';
// My Restaurant bucket (v1 Overview + Search re-homed; Trends + Feedback new).
import MyOverview from './intelligence/my-restaurant/Overview';
import DailyTrends from './intelligence/my-restaurant/DailyTrends';
import FeedbackChanges from './intelligence/my-restaurant/FeedbackChanges';
import ReviewHighlights from './intelligence/my-restaurant/ReviewHighlights';
import SearchSEO from './intelligence/my-restaurant/SearchSEO';
// Competition bucket (Competitors + Reviews re-homed/rebuilt here).
import TopThreats from './intelligence/competition/TopThreats';
import Watchlist from './intelligence/competition/Watchlist';
import Compare from './intelligence/competition/Compare';
import WhereTheyBeatYou from './intelligence/competition/WhereTheyBeatYou';
import NewOpenings from './intelligence/competition/NewOpenings';

/**
 * Restaurant Intelligence bucket — two-bucket dashboard (Brief 09). RestroScore
 * header band (unchanged) → BucketSwitch (My Restaurant | Competition) →
 * bucket-scoped PeriodFilter → bucket content. Every v1 sub-tab's content
 * survives, re-homed under a bucket (nothing deleted). Renders entirely from the
 * [SAMPLE] fixtures in demo mode with zero backend (intelligenceAPI → demo twin).
 */

type MineTab = 'OVERVIEW' | 'COMMENTS' | 'TRENDS' | 'FEEDBACK' | 'SEARCH';
type CompTab = 'THREATS' | 'WATCHLIST' | 'COMPARE' | 'BEAT' | 'OPENINGS';

function initialBucket(): BucketId {
    if (typeof window !== 'undefined') {
        const param = new URLSearchParams(window.location.search).get('bucket');
        if (param === 'competition') return 'COMPETITION';
        if (param === 'mine') return 'MINE';
        const saved = window.sessionStorage?.getItem('intel_bucket');
        if (saved === 'COMPETITION' || saved === 'MINE') return saved;
    }
    return 'MINE';
}

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
    onPickRestaurant: () => void;
    onNavigate: (t: DeepLinkTarget) => void;
}> = ({ report, selectedPillar, onSelectPillar, onRescan, onPickRestaurant, onNavigate }) => {
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
                    <button
                        type="button"
                        onClick={onPickRestaurant}
                        title="Search Google for your restaurant and scan it"
                        className="text-xs font-semibold text-primary-strong hover:underline"
                    >
                        Scan a different restaurant
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
    const [selectedPillar, setSelectedPillar] = useState<PillarScore['key'] | null>(null);
    const [rescanning, setRescanning] = useState(false);
    const [picking, setPicking] = useState(false);

    // Two-bucket state (persisted per session + ?bucket= param).
    const [bucket, setBucket] = useState<BucketId>(initialBucket);
    const [mineTab, setMineTab] = useState<MineTab>('OVERVIEW');
    const [compTab, setCompTab] = useState<CompTab>('THREATS');
    const [mineSel, setMineSel] = useState<MineSelection>(() => defaultMineSelection());
    const [compSel, setCompSel] = useState<CompetitionSelection>(() => defaultCompetitionSelection());

    useEffect(() => {
        if (typeof window !== 'undefined') window.sessionStorage?.setItem('intel_bucket', bucket);
    }, [bucket]);

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

    // Plain-language tabs — restaurant owners, not analysts.
    const mineTabs: Array<SubNavTab<MineTab>> = [
        { id: 'OVERVIEW', label: 'Summary' },
        { id: 'COMMENTS', label: 'Top Comments' },
        { id: 'TRENDS', label: 'Ratings & Reviews' },
        { id: 'FEEDBACK', label: 'New Reviews' },
        { id: 'SEARCH', label: 'Google Visibility' },
    ];
    const compTabs: Array<SubNavTab<CompTab>> = [
        { id: 'THREATS', label: 'Competitors' },
        { id: 'WATCHLIST', label: 'Tracked Rivals' },
        { id: 'COMPARE', label: 'Compare' },
        { id: 'BEAT', label: 'Gaps to Fix' },
        { id: 'OPENINGS', label: 'New Openings' },
    ];

    const minePeriod = mineQuery(mineSel);
    const compPeriod = competitionQuery(compSel);

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
        return (
            <ScanFlow
                variant="first-run"
                defaults={scanDefaults}
                api={intelligenceAPI}
                onReport={setReport}
                onPlaceConfirmed={(sel) => {
                    // Persist the confirmed placeId so future scans skip text search.
                    void restaurantAPI.updateProfile({ googlePlaceId: sel.placeId }).catch(() => {});
                }}
            />
        );
    }

    // Add / change restaurant via the Google picker (reachable even once a
    // report exists — otherwise the picker is stranded behind the empty state).
    if (picking) {
        return (
            <ScanFlow
                variant="first-run"
                defaults={scanDefaults}
                api={intelligenceAPI}
                onReport={(r) => {
                    setReport(r);
                    setPicking(false);
                }}
                onCancel={() => setPicking(false)}
                onPlaceConfirmed={(sel) => {
                    void restaurantAPI.updateProfile({ googlePlaceId: sel.placeId }).catch(() => {});
                }}
            />
        );
    }

    return (
        <div className="space-y-6">
            <HeaderBand
                report={report}
                selectedPillar={selectedPillar}
                onSelectPillar={(k) => setSelectedPillar((cur) => (cur === k ? null : k))}
                onRescan={() => setRescanning(true)}
                onPickRestaurant={() => setPicking(true)}
                onNavigate={nav}
            />

            {/* Bucket switch + bucket-scoped period filter */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <BucketSwitch value={bucket} onChange={setBucket} />
                {bucket === 'MINE' ? (
                    <PeriodFilter bucket="MINE" selection={mineSel} onChange={setMineSel} />
                ) : (
                    <PeriodFilter bucket="COMPETITION" selection={compSel} onChange={setCompSel} />
                )}
            </div>

            {/* Plain-language explainer: what's tracked and where the history lives. */}
            <p className="text-xs text-muted leading-relaxed">
                Your Google rating, review count and new comments are saved automatically every day.
                Use the period switch above — <span className="font-semibold">Month to date</span> for
                this month, <span className="font-semibold">Overall</span> for all time — and open{' '}
                <span className="font-semibold">Ratings &amp; Reviews</span> to see the trend.
            </p>

            {bucket === 'MINE' ? (
                <>
                    <SubNav tabs={mineTabs} active={mineTab} onChange={setMineTab} label="My Restaurant sections" />
                    {mineTab === 'OVERVIEW' && <MyOverview report={report} metrics={selfMetrics} onNavigate={nav} />}
                    {mineTab === 'COMMENTS' && <ReviewHighlights report={report} />}
                    {mineTab === 'TRENDS' && <DailyTrends query={minePeriod} />}
                    {mineTab === 'FEEDBACK' && <FeedbackChanges query={minePeriod} onNavigate={nav} />}
                    {mineTab === 'SEARCH' && <SearchSEO report={report} onNavigate={nav} />}
                </>
            ) : (
                <>
                    <SubNav tabs={compTabs} active={compTab} onChange={setCompTab} label="Competition sections" />
                    {compTab === 'THREATS' && <TopThreats buckets={report.buckets} />}
                    {compTab === 'WATCHLIST' && <Watchlist />}
                    {compTab === 'COMPARE' && <Compare query={compPeriod} />}
                    {compTab === 'BEAT' && <WhereTheyBeatYou query={compPeriod} report={report} onNavigate={nav} />}
                    {compTab === 'OPENINGS' && <NewOpenings onNavigate={nav} />}
                </>
            )}
        </div>
    );
};

export default IntelligenceV2;
