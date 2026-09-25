import React, { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import type { IntelligenceReport, IntelligenceScan, IntelligenceSelfMetrics, PillarScore, Restaurant } from '@restropulse/shared';
import { intelligenceAPI } from '../../api';
import { SubNav, SubNavTab } from './primitives';
import { ScoreDial, PillarBar, CheckRow, type Grade, PILLAR_LABELS, gradeTextClass } from './sections/primitives';
import { ProvenanceChip, ProvenanceLegend } from './sections/provenance';
import { resolveActionHref, SHOW_ACTION_CTAS, type DeepLinkTarget } from './sections/deep-links';
import { humanCity, whatChangedLine } from './sections/copy';
import WhileYouWereAway from './sections/WhileYouWereAway';
import { announceNotificationsSeen, INTEL_NAV_EVENT, INTEL_NOTIFICATIONS_SEEN_EVENT, type IntelNavDetail } from './sections/notifications';
import type { IntelligenceNotification } from '@restropulse/shared';
import { track } from './sections/track';
import ScanFlow from './sections/ScanFlow';
import PrintReport, { printDocumentTitle } from './PrintReport';
import { BucketSwitch } from './sections/BucketSwitch';
import { PeriodFilter } from './sections/PeriodFilter';
import {
    type BucketId,
    type MineSelection,
    type CompetitionSelection,
    defaultMineSelection,
    defaultCompetitionSelection,
    mineQuery,
    competitionQuery,
} from './sections/period';
// My Restaurant bucket (Overview + Search re-homed; Trends + Feedback new).
import MyOverview from './sections/my-restaurant/Overview';
import DailyTrends from './sections/my-restaurant/DailyTrends';
import FeedbackChanges from './sections/my-restaurant/FeedbackChanges';
import SearchSEO from './sections/my-restaurant/SearchSEO';
// Competition bucket (Competitors + Reviews re-homed/rebuilt here).
import TopThreats from './sections/competition/TopThreats';
import Watchlist from './sections/competition/Watchlist';
import Compare from './sections/competition/Compare';
import WhereTheyBeatYou from './sections/competition/WhereTheyBeatYou';
import NewOpenings from './sections/competition/NewOpenings';

/**
 * Restaurant Intelligence bucket — two-bucket dashboard (Brief 09). RestroScore
 * header band (unchanged) → BucketSwitch (My Restaurant | Competition) →
 * bucket-scoped PeriodFilter → bucket content. Every sub-tab's content
 * survives, re-homed under a bucket (nothing deleted). Renders entirely from the
 * [SAMPLE] fixtures in demo mode with zero backend (intelligenceAPI → demo twin).
 */

type MineTab = 'OVERVIEW' | 'TRENDS' | 'FEEDBACK' | 'SEARCH';
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

interface IntelligenceDashboardProps {
    restaurantData: Restaurant;
    /**
     * Deep-link navigation into other buckets (wired by the shell). Required:
     * see RP-001 — the previous `onNavigate?` + `?? (() => {})` default meant a
     * shell that forgot to pass it got silently dead CTAs, with no type error.
     */
    onNavigate: (target: DeepLinkTarget) => void;
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
    /** "Not your restaurant?" — reopen the Google-listing picker and rescan. */
    onChangeRestaurant: () => void;
    onNavigate: (t: DeepLinkTarget) => void;
}> = ({ report, selectedPillar, onSelectPillar, onRescan, onChangeRestaurant, onNavigate }) => {
    const grade: Grade = restroGrade(report.restroScore);
    const scannedAt = new Date(report.generatedAt);
    const withinWindow = Date.now() - scannedAt.getTime() < DAY_MS;
    const changed = whatChangedLine(report);
    const where = report.base.zone || report.base.city;

    return (
        <div className="bg-surface rounded-2xl p-4 sm:p-6 border border-line">
            {/* Which listing this report is about — the owner must be able to see, at a
                glance, that we scored the right restaurant, and fix it if we didn't. */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-4">
                <p className="text-sm text-ink" data-testid="report-identity">
                    Report for <span className="font-semibold">{report.base.name}</span>
                    {where ? <span className="text-muted"> · {where}</span> : null}
                    {' '}
                    <button type="button" onClick={onChangeRestaurant} className="text-xs font-semibold text-primary-strong hover:underline">
                        Not your restaurant?
                    </button>
                </p>
                {changed ? (
                    <p className="text-sm text-muted" data-testid="what-changed">{changed}</p>
                ) : (
                    <p className="text-sm text-muted">This is your first report — changes will show here from the next scan.</p>
                )}
            </div>
            <div className="grid gap-6 md:grid-cols-[auto_1fr_auto] md:items-center">
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
                    <p className="text-xs text-muted">Report from {relativeDays(scannedAt)}</p>
                    <div className="flex items-center gap-2 no-print">
                        <button
                            type="button"
                            onClick={onRescan}
                            disabled={withinWindow}
                            title={withinWindow ? 'You can refresh once every 24 hours' : 'Run a fresh scan'}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-line text-primary-strong hover:bg-primary-soft transition-colors disabled:opacity-50 disabled:hover:bg-surface"
                        >
                            Refresh report
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                track.tabOpened({ bucket: 'MINE', tab: 'PDF' });
                                window.print();
                            }}
                            title="Save the full report as a PDF (choose 'Save as PDF' in the print dialog)"
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-line text-primary-strong hover:bg-primary-soft transition-colors"
                        >
                            Download PDF
                        </button>
                    </div>
                </div>
            </div>

            {/* Provenance legend -- educational "how we know" row; hidden on mobile to reduce density. */}
            <div className="mt-5 pt-4 border-t border-line hidden sm:block">
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
    onNavigate: (t: DeepLinkTarget) => void;
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
                            action={SHOW_ACTION_CTAS && !chk.pass && target ? { label: target.cta, href: target.href, onClick: () => onNavigate(target) } : undefined}
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

const IntelligenceDashboard: React.FC<IntelligenceDashboardProps> = ({ restaurantData, onNavigate }) => {
    const [report, setReport] = useState<IntelligenceReport | null | undefined>(undefined);
    const [selfMetrics, setSelfMetrics] = useState<IntelligenceSelfMetrics | null>(null);
    const [selectedPillar, setSelectedPillar] = useState<PillarScore['key'] | null>(null);
    // Rescan state: `pick` reopens the "Is this you?" step ("Not your restaurant?").
    const [rescan, setRescan] = useState<{ active: boolean; pick: boolean }>({ active: false, pick: false });
    // A scan still running server-side (found on mount) -- resume its stepper instead
    // of showing the empty state / report while it works.
    const [activeScan, setActiveScan] = useState<IntelligenceScan | null>(null);

    // Full-report PDF: the print-only report is mounted only while the browser is
    // printing (covers the button and Ctrl+P). flushSync so the DOM is ready before
    // the print snapshot; the document title becomes the saved PDF's file name.
    const [printing, setPrinting] = useState(false);
    useEffect(() => {
        if (!report) return;
        const originalTitle = document.title;
        const onBefore = () => {
            document.title = printDocumentTitle(report);
            flushSync(() => setPrinting(true));
        };
        const onAfter = () => {
            document.title = originalTitle;
            setPrinting(false);
        };
        window.addEventListener('beforeprint', onBefore);
        window.addEventListener('afterprint', onAfter);
        return () => {
            window.removeEventListener('beforeprint', onBefore);
            window.removeEventListener('afterprint', onAfter);
            document.title = originalTitle;
        };
    }, [report]);

    // Two-bucket state (persisted per session + ?bucket= param).
    const [bucket, setBucket] = useState<BucketId>(initialBucket);
    const [mineTab, setMineTab] = useState<MineTab>('OVERVIEW');
    const [compTab, setCompTab] = useState<CompTab>('THREATS');
    const [mineSel, setMineSel] = useState<MineSelection>(() => defaultMineSelection());
    const [compSel, setCompSel] = useState<CompetitionSelection>(() => defaultCompetitionSelection());

    useEffect(() => {
        if (typeof window !== 'undefined') window.sessionStorage?.setItem('intel_bucket', bucket);
    }, [bucket]);

    // Bell / landing-card navigation: jump to a bucket + tab.
    const goTo = (link: IntelNavDetail) => {
        if (link.bucket) setBucket(link.bucket);
        if (link.bucket === 'MINE' && link.tab) setMineTab(link.tab as MineTab);
        if (link.bucket === 'COMPETITION' && link.tab) setCompTab(link.tab as CompTab);
    };
    useEffect(() => {
        const onNav = (e: Event) => goTo((e as CustomEvent<IntelNavDetail>).detail);
        window.addEventListener(INTEL_NAV_EVENT, onNav);
        return () => window.removeEventListener(INTEL_NAV_EVENT, onNav);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Notification feed for the "While you were away" card. Loaded here (not
    // passed down) so the card also works in demo mode and after a rescan.
    const [feed, setFeed] = useState<IntelligenceNotification[]>([]);
    const loadFeed = async () => {
        try {
            const res = await intelligenceAPI.getNotifications();
            setFeed(res.items);
        } catch {
            /* nudge only */
        }
    };
    useEffect(() => {
        void loadFeed();
        const onSeen = () => void loadFeed();
        window.addEventListener(INTEL_NOTIFICATIONS_SEEN_EVENT, onSeen);
        return () => window.removeEventListener(INTEL_NOTIFICATIONS_SEEN_EVENT, onSeen);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [restaurantData.id, report?._id]);
    // report_viewed — once per report id per mount.
    useEffect(() => {
        if (report) track.reportViewed({ reportId: report._id, score: report.restroScore, first: !report.deltas });
    }, [report?._id]); // eslint-disable-line react-hooks/exhaustive-deps

    const dismissFeed = () => {
        setFeed((items) => items.map((n) => ({ ...n, unread: false })));
        intelligenceAPI.markNotificationsSeen().then(announceNotificationsSeen).catch(() => undefined);
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const running = await intelligenceAPI.getActiveScan();
                if (!cancelled) setActiveScan(running);
            } catch {
                /* best effort: fall back to the normal report/empty views */
            }
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

    const scanDefaults = useMemo(
        () => ({
            name: restaurantData.name,
            city: humanCity(restaurantData.sourceCity),
            ...(restaurantData.googlePlaceId ? { placeId: restaurantData.googlePlaceId } : {}),
        }),
        [restaurantData.name, restaurantData.sourceCity, restaurantData.googlePlaceId],
    );

    // Owner-facing labels (sections/copy.ts): plain words, no jargon.
    const mineTabs: Array<SubNavTab<MineTab>> = [
        { id: 'OVERVIEW', label: 'Overview' },
        { id: 'TRENDS', label: 'Day by day', shortLabel: 'Trends' },
        { id: 'FEEDBACK', label: 'What guests say', shortLabel: 'Guests' },
        { id: 'SEARCH', label: 'Google search', shortLabel: 'Search' },
    ];
    const compTabs: Array<SubNavTab<CompTab>> = [
        { id: 'THREATS', label: 'Biggest rivals', shortLabel: 'Rivals' },
        { id: 'WATCHLIST', label: 'Rivals you track', shortLabel: 'Tracked' },
        { id: 'COMPARE', label: 'Side by side', shortLabel: 'Compare' },
        { id: 'BEAT', label: 'Where they beat you', shortLabel: 'Gaps' },
        { id: 'OPENINGS', label: 'New nearby', shortLabel: 'New' },
    ];

    const minePeriod = mineQuery(mineSel);
    const compPeriod = competitionQuery(compSel);

    // Loading
    if (report === undefined) {
        return <div className="text-sm text-muted">Loading your intelligence…</div>;
    }

    // Re-scan in progress (report exists, running a fresh scan)
    if (rescan.active || (activeScan && report !== null)) {
        return (
            <ScanFlow
                variant="rescan"
                force
                defaults={scanDefaults}
                api={intelligenceAPI}
                {...(!rescan.active && activeScan ? { resumeScan: activeScan } : {})}
                onReport={(r) => {
                    setReport(r);
                    setActiveScan(null);
                    setRescan({ active: false, pick: false });
                }}
                onCancel={() => {
                    setActiveScan(null);
                    setRescan({ active: false, pick: false });
                }}
            />
        );
    }

    // Empty state (no report yet), or a first scan still running
    if (report === null) {
        return (
            <ScanFlow
                variant="first-run"
                defaults={scanDefaults}
                api={intelligenceAPI}
                {...(activeScan ? { resumeScan: activeScan } : {})}
                onReport={(r) => {
                    setReport(r);
                    setActiveScan(null);
                }}
            />
        );
    }

    return (
        <>
        {printing && <PrintReport report={report} />}
        <div className="space-y-4 sm:space-y-6 no-print">
            <WhileYouWereAway
                items={feed}
                onOpen={(n) => {
                    track.notificationClicked({ kind: n.kind, unread: n.unread, source: 'landing' });
                    goTo(n.link);
                    dismissFeed();
                }}
                onDismiss={dismissFeed}
            />
            <HeaderBand
                report={report}
                selectedPillar={selectedPillar}
                onSelectPillar={(k) => {
                    const p = report.pillars.find((x) => x.key === k);
                    if (selectedPillar !== k && p) track.pillarOpened({ pillar: k, grade: p.grade });
                    setSelectedPillar((cur) => (cur === k ? null : k));
                }}
                onRescan={() => {
                    track.rescanClicked({ reason: 'refresh' });
                    setRescan({ active: true, pick: false });
                }}
                onChangeRestaurant={() => {
                    track.rescanClicked({ reason: 'change_restaurant' });
                    setRescan({ active: true, pick: true });
                }}
                onNavigate={onNavigate}
            />

            {/* Bucket switch + bucket-scoped period filter. Stacks full-width on
                mobile so the two control groups don't wrap mid-row. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <BucketSwitch value={bucket} onChange={setBucket} />
                {bucket === 'MINE' ? (
                    <PeriodFilter bucket="MINE" selection={mineSel} onChange={setMineSel} />
                ) : compTab === 'COMPARE' ? (
                    <PeriodFilter bucket="COMPETITION" selection={compSel} onChange={setCompSel} />
                ) : null}
            </div>

            {bucket === 'MINE' ? (
                <>
                    <SubNav tabs={mineTabs} active={mineTab} onChange={(t) => { track.tabOpened({ bucket: 'MINE', tab: t }); setMineTab(t); }} label="My Restaurant sections" />
                    {mineTab === 'OVERVIEW' && <MyOverview report={report} metrics={selfMetrics} onNavigate={onNavigate} />}
                    {mineTab === 'TRENDS' && <DailyTrends query={minePeriod} />}
                    {mineTab === 'FEEDBACK' && <FeedbackChanges query={minePeriod} report={report} onNavigate={onNavigate} />}
                    {mineTab === 'SEARCH' && <SearchSEO report={report} onNavigate={onNavigate} />}
                </>
            ) : (
                <>
                    <SubNav tabs={compTabs} active={compTab} onChange={(t) => { track.tabOpened({ bucket: 'COMPETITION', tab: t }); setCompTab(t); }} label="Competition sections" />
                    {compTab === 'THREATS' && (
                        <TopThreats
                            buckets={report.buckets}
                            selfPlaceId={report.base.placeId}
                            base={{ rating: report.base.rating, totalRatings: report.base.totalRatings, photoCount: report.base.photoCount }}
                        />
                    )}
                    {compTab === 'WATCHLIST' && <Watchlist />}
                    {compTab === 'COMPARE' && <Compare query={compPeriod} report={report} />}
                    {compTab === 'BEAT' && <WhereTheyBeatYou report={report} onNavigate={onNavigate} />}
                    {compTab === 'OPENINGS' && <NewOpenings report={report} onNavigate={onNavigate} />}
                </>
            )}
        </div>
        </>
    );
};

export default IntelligenceDashboard;
