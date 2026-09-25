import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from './utils/test-utils';
import type { CompetitorProfile, IntelligenceSelfMetrics, Restaurant } from '@restropulse/shared';

/**
 * Regression cover for the Intelligence P0s (RP-001, RP-003, RP-006, RP-011).
 * Each block names the ticket it locks down; the point of every assertion here
 * is that the bug was invisible to the compiler and to the eye.
 */

vi.mock('../api', () => ({
    intelligenceAPI: {
        getLatestReport: vi.fn(),
        getActiveScan: vi.fn().mockResolvedValue(null),
        getSelfMetrics: vi.fn(),
        getWatchlist: vi.fn(),
        putWatchlist: vi.fn(),
        getSnapshots: vi.fn(),
        getCompare: vi.fn(),
        getFeedbackChanges: vi.fn(),
        getNewOpenings: vi.fn(),
        searchPlaces: vi.fn(),
        getNotifications: vi.fn().mockResolvedValue({ items: [], unread: 0, seenAt: null }),
        markNotificationsSeen: vi.fn().mockResolvedValue({ seenAt: new Date().toISOString() }),
        getActionProgress: vi.fn().mockResolvedValue({ done: [] }),
        putActionProgress: vi.fn().mockResolvedValue({ done: [] }),
        getReports: vi.fn().mockResolvedValue([]),
        draftReply: vi.fn(),
        getWatchlistDigest: vi.fn().mockResolvedValue({ rivals: [], hasData: false }),
    },
}));

import { intelligenceAPI } from '../api';
import Intelligence from '../components/Intelligence';
import MyOverview from '../components/intelligence/sections/my-restaurant/Overview';
import { DailyTrendsView } from '../components/intelligence/sections/my-restaurant/DailyTrends';
import { TopThreatsView } from '../components/intelligence/sections/competition/TopThreats';
import { TrendChart } from '../components/intelligence/sections/charts';
import { SHELL_BUCKET_TO_VIEW, shellBucketToView, resolveDeepLink, SHOW_ACTION_CTAS } from '../components/intelligence/sections/deep-links';
import { DEMO_INTELLIGENCE_REPORT, DEMO_INTELLIGENCE_SELF_METRICS } from '../lib/demo-fixtures-intelligence';
import ScanFlow from '../components/intelligence/sections/ScanFlow';
import PrintReport, { printDocumentTitle } from '../components/intelligence/PrintReport';
import { WhereTheyBeatYouView, rowsFromReport } from '../components/intelligence/sections/competition/WhereTheyBeatYou';
import { humanCity, whatChangedLine } from '../components/intelligence/sections/copy';
import type { IntelligenceNotification } from '@restropulse/shared';
import WhileYouWereAway from '../components/intelligence/sections/WhileYouWereAway';
import NotificationBell from '../components/NotificationBell';
import { YesterdayView } from '../components/intelligence/sections/my-restaurant/Yesterday';
import V1Overview from '../components/intelligence/sections/Overview';
import { ReviewCard } from '../components/intelligence/sections/my-restaurant/FeedbackChanges';
import { RivalDigestBlock } from '../components/intelligence/sections/competition/Watchlist';
import { beatsYouLine } from '../components/intelligence/sections/competition/TopThreats';
import type { RivalDigest } from '../api';

const restaurant = { id: 'r1', name: 'Test Kitchen', sourceCity: 'city-hyderabad' } as unknown as Restaurant;

beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
});

// ---------------------------------------------------------------- RP-001 ----

describe('RP-001 — action-plan CTAs are wired to the shell', () => {
    it('maps every shell bucket to a ViewState this shell owns, or to null', () => {
        expect(shellBucketToView('CONTENT')).toBe('STUDIO');
        expect(shellBucketToView('INTELLIGENCE')).toBe('INTELLIGENCE');
        expect(shellBucketToView('DASHBOARD')).toBe('DASHBOARD');
        // Buckets ported from restropulse-v2 that this app has no home for.
        expect(shellBucketToView('ORDERING')).toBeNull();
        expect(shellBucketToView('DESIGN')).toBeNull();
        // 'get-started' deep links no longer resolve to the dead GET_STARTED
        // bucket: profile/review actions land on What guests say (RP-002).
        const reviews = resolveDeepLink({ bucket: 'get-started', params: { task: 'review-replies' } });
        expect(reviews.bucket).toBe('INTELLIGENCE');
        expect(reviews.params).toMatchObject({ intelBucket: 'MINE', intelTab: 'FEEDBACK' });
        // No bucket may resolve to a view the shell cannot render.
        const renderable = ['DASHBOARD', 'STUDIO', 'INPUTS', 'STRATEGY', 'INTELLIGENCE'];
        for (const view of Object.values(SHELL_BUCKET_TO_VIEW)) {
            if (view !== null) expect(renderable).toContain(view);
        }
    });

    it('action CTAs follow the SHOW_ACTION_CTAS switch (off for launch)', async () => {
        vi.mocked(intelligenceAPI.getLatestReport).mockResolvedValue(DEMO_INTELLIGENCE_REPORT as never);
        vi.mocked(intelligenceAPI.getSelfMetrics).mockResolvedValue(DEMO_INTELLIGENCE_SELF_METRICS as never);

        render(<Intelligence restaurant={restaurant} onNavigate={() => {}} />);
        await screen.findByText('Your action plan');

        if (SHOW_ACTION_CTAS) {
            expect(screen.getByRole('button', { name: /Draft in Content Engine/i })).toBeInTheDocument();
        } else {
            // Bhargav, 20 Aug: actionables aren't configured — no CTA renders,
            // but the plumbing (deep links, tick-boxes) stays.
            expect(screen.queryByRole('button', { name: /Draft in Content Engine/i })).not.toBeInTheDocument();
            expect(screen.queryByText(/Act on this/)).not.toBeInTheDocument();
        }
    });
});

// ---------------------------------------------------------------- RP-003 ----

describe('RP-003 — empty series never render a blank oversized chart', () => {
    it('renders a real pixel height, not a viewBox unit', () => {
        const { container } = render(
            <TrendChart
                labels={['2026-08-01', '2026-08-02']}
                series={[{ key: 's', label: 'Rating', color: '#000', points: [4.4, 4.5] }]}
                height={120}
                ariaLabel="Rating trend"
            />,
        );
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg?.getAttribute('height')).toBe('120');
    });

    it('renders nothing when there is nothing to plot', () => {
        const { container } = render(
            <TrendChart labels={[]} series={[{ key: 's', label: 'Rating', color: '#000', points: [] }]} ariaLabel="Rating trend" />,
        );
        expect(container.querySelector('svg')).toBeNull();
    });

    it('shows an empty state instead of a chart when a range has no snapshots', () => {
        const { container } = render(<DailyTrendsView points={[]} mode="range" onAddZomato={() => {}} />);
        expect(screen.getByText(/No daily checks for this period yet/i)).toBeInTheDocument();
        expect(container.querySelector('svg')).toBeNull();
    });
});

// ---------------------------------------------------------------- RP-006 ----

describe('RP-006 — no green "Measured" chip over an all-zero dataset', () => {
    const zeroMetrics: IntelligenceSelfMetrics = {
        ...DEMO_INTELLIGENCE_SELF_METRICS,
        orderCount: 0,
        totalCustomers: 0,
        repeatCustomers: 0,
        repeatRatePct: 0,
        avgOrderValue: 0,
        revenue: { newCustomer: 0, returningCustomer: 0 },
    };

    it('hides the operations strip when there are no orders', () => {
        render(<MyOverview report={DEMO_INTELLIGENCE_REPORT} metrics={zeroMetrics} onNavigate={() => {}} />);
        expect(screen.queryByText('Your operations')).not.toBeInTheDocument();
    });

    it('still shows the operations strip when orders exist', () => {
        render(<MyOverview report={DEMO_INTELLIGENCE_REPORT} metrics={DEMO_INTELLIGENCE_SELF_METRICS} onNavigate={() => {}} />);
        expect(screen.getByText('Your operations')).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------- RP-011 ----

describe('RP-011 — the restaurant is never its own competitor', () => {
    const competitor = (placeId: string, name: string, threatScore: number): CompetitorProfile => ({
        placeId,
        name,
        address: 'Somewhere',
        rating: 4.5,
        totalRatings: 100,
        distanceKm: 1,
        lat: 0,
        lng: 0,
        priceLevel: 2,
        photoCount: 10,
        cuisine: 'Indian',
        threatScore,
        sameCuisineThreatScore: threatScore,
    });

    it('filters the merchant out of both buckets and the counts', () => {
        const rows = [competitor('self-1', 'Bawarchi Test Kitchen', 99), competitor('rival-1', 'Behrouz', 80)];
        render(
            <TopThreatsView
                buckets={{ directTop10: rows, overallTop10: rows, aovBand: { base: 2, label: 'Value' } }}
                watchlist={[]}
                max={5}
                error={null}
                onAdd={() => {}}
                selfPlaceId="self-1"
            />,
        );
        expect(screen.queryByText('Bawarchi Test Kitchen')).not.toBeInTheDocument();
        expect(screen.getByText('Behrouz')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Same food & price \(1\)/i })).toBeInTheDocument();
    });
});

// ------------------------------------------------------ ScanFlow ----

describe('ScanFlow — scan the restaurant profile listing', () => {
    it('first-run ScanFlow starts the scan immediately (no place picker)', async () => {
        const api = {
            startScan: vi.fn().mockResolvedValue({ scanId: 's1' }),
            getScan: vi.fn(),
            getReport: vi.fn(),
        };
        render(<ScanFlow variant="first-run" defaults={{ name: 'Bawarchi', city: 'Hyderabad' }} api={api} onReport={() => {}} />);
        expect(screen.getByRole('button', { name: /Run first scan/i })).toBeInTheDocument();
    });

    it('resumes an in-flight scan: shows the stepper (not the empty state), does not restart, and hands up the report', async () => {
        vi.useFakeTimers();
        try {
            const report = { ...DEMO_INTELLIGENCE_REPORT, _id: 'r1' };
            const api = {
                startScan: vi.fn(),
                getScan: vi.fn().mockResolvedValue({ _id: 's1', status: 'COMPLETED', reportId: 'r1' }),
                getReport: vi.fn().mockResolvedValue(report),
            };
            const onReport = vi.fn();
            const resumeScan = {
                _id: 's1',
                restaurantId: 'r',
                query: { name: 'Bawarchi', city: 'Hyderabad' },
                status: 'ANALYZING' as const,
                requestedBy: 'u',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            render(
                <ScanFlow variant="first-run" defaults={{ name: 'Bawarchi', city: 'Hyderabad' }} api={api} onReport={onReport} resumeScan={resumeScan} />,
            );
            expect(screen.queryByRole('button', { name: /Run first scan/i })).not.toBeInTheDocument();
            expect(api.startScan).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(3000);
            expect(api.getScan).toHaveBeenCalledWith('s1');
            expect(onReport).toHaveBeenCalledWith(report);
        } finally {
            vi.useRealTimers();
        }
    });
});

// ------------------------------------------------------ PrintReport ----

describe('PrintReport — Download PDF renders the whole report, independent of the open tab', () => {
    it('contains every section with no interaction and makes no API calls', () => {
        vi.clearAllMocks();
        render(<PrintReport report={DEMO_INTELLIGENCE_REPORT} />);
        const root = screen.getByTestId('print-report');
        const text = root.textContent ?? '';

        expect(text).toContain(DEMO_INTELLIGENCE_REPORT.base.name);
        expect(text).toContain(String(DEMO_INTELLIGENCE_REPORT.restroScore));
        for (const p of DEMO_INTELLIGENCE_REPORT.pillars) {
            for (const c of p.checks) expect(text).toContain(c.label);
        }
        // Narrative is always expanded (not behind the "Full report" disclosure).
        for (const f of DEMO_INTELLIGENCE_REPORT.narrative.keyFindings) expect(text).toContain(f);
        expect(text).toContain(DEMO_INTELLIGENCE_REPORT.narrative.verdict);
        // Every action, not just the first few.
        for (const a of DEMO_INTELLIGENCE_REPORT.narrative.actionPlan) expect(text).toContain(a.action);
        // Competition + search content.
        for (const c of DEMO_INTELLIGENCE_REPORT.topCompetitors) expect(text).toContain(c.name);
        for (const s of DEMO_INTELLIGENCE_REPORT.searchRankings) expect(text).toContain(s.query);

        for (const fn of Object.values(intelligenceAPI)) expect(fn).not.toHaveBeenCalled();
    });

    it('names the saved file after the restaurant and report date', () => {
        expect(printDocumentTitle(DEMO_INTELLIGENCE_REPORT)).toContain(DEMO_INTELLIGENCE_REPORT.base.name);
    });
});

// ---------------------------------------------------------------- RP-004 ----

describe('RP-004 — Where they beat you never contradicts the report', () => {
    it('seeds gap rows from the report when the daily layer is empty', () => {
        const rows = rowsFromReport(DEMO_INTELLIGENCE_REPORT);
        expect(rows.length).toBeGreaterThan(0);
        // Every row is a real competitor from the report, never the merchant.
        expect(rows.every((r) => !r.isSelf && r.placeId !== DEMO_INTELLIGENCE_REPORT.base.placeId)).toBe(true);
        // A rival with a higher rating produces a rating gap.
        const better = DEMO_INTELLIGENCE_REPORT.topCompetitors.find((c) => c.rating > DEMO_INTELLIGENCE_REPORT.base.rating);
        if (better) {
            const row = rows.find((r) => r.placeId === better.placeId);
            expect(row?.beatsYou.some((g) => g.metric === 'rating')).toBe(true);
        }
    });

    it('says "nothing recorded" when there is no data, and "nobody ahead" when there is', () => {
        const { rerender } = render(<WhereTheyBeatYouView rows={[]} profilesByName={{}} onNavigate={() => {}} />);
        expect(screen.getByTestId('wtby-no-data')).toBeInTheDocument();

        rerender(
            <WhereTheyBeatYouView
                rows={[{ placeId: 'x', name: 'Rival', isSelf: false, google: { rating: 4.0, reviewCount: 10, newReviews: 0, photoCount: 1 }, beatsYou: [] }]}
                profilesByName={{}}
                onNavigate={() => {}}
            />,
        );
        expect(screen.getByTestId('wtby-no-gaps')).toBeInTheDocument();
    });
});

// ------------------------------------------------------------ vocabulary ----

describe('owner-facing copy helpers', () => {
    it('turns a city id into a human city', () => {
        expect(humanCity('city-hyderabad')).toBe('Hyderabad');
        expect(humanCity('city-new-delhi')).toBe('New Delhi');
        expect(humanCity('Bengaluru')).toBe('Bengaluru');
        expect(humanCity(undefined)).toBe('');
    });

    it('writes a "since your last scan" sentence from the deltas', () => {
        const line = whatChangedLine(DEMO_INTELLIGENCE_REPORT);
        expect(line).toMatch(/^Since your last scan, /);
        expect(line).toMatch(/score is up 3 points/);
        expect(line).toMatch(/opened nearby/);
        expect(whatChangedLine({ ...DEMO_INTELLIGENCE_REPORT, deltas: undefined })).toBeNull();
    });
});

// ---------------------------------------------------------- nudges: feed ----

describe('notification feed — the reason to open the app today', () => {
    const feed: IntelligenceNotification[] = [
        { id: 'reviews:t-1', kind: 'negative_review', severity: 'warning', title: '3 new Google reviews yesterday', body: '2 positive · 1 negative.', at: new Date(Date.now() - 3600000).toISOString(), unread: true, link: { view: 'INTELLIGENCE', bucket: 'MINE', tab: 'FEEDBACK' } },
        { id: 'report:1', kind: 'report_ready', severity: 'info', title: 'Your new weekly report is ready', at: new Date(Date.now() - 2 * 86400000).toISOString(), unread: true, link: { view: 'INTELLIGENCE', bucket: 'MINE', tab: 'OVERVIEW' } },
        { id: 'alert:old', kind: 'competitor_surge', severity: 'warning', title: 'Meghana is gaining reviews fast', at: new Date(Date.now() - 5 * 86400000).toISOString(), unread: false, link: { view: 'INTELLIGENCE', bucket: 'COMPETITION', tab: 'THREATS' } },
    ];

    it('"While you were away" shows only unread items and dismisses', () => {
        const onDismiss = vi.fn();
        const onOpen = vi.fn();
        render(<WhileYouWereAway items={feed} onOpen={onOpen} onDismiss={onDismiss} />);
        expect(screen.getByText(/2 things changed/)).toBeInTheDocument();
        expect(screen.getByText('3 new Google reviews yesterday')).toBeInTheDocument();
        expect(screen.queryByText('Meghana is gaining reviews fast')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('3 new Google reviews yesterday'));
        expect(onOpen).toHaveBeenCalledWith(feed[0]);
        fireEvent.click(screen.getByRole('button', { name: /Got it/i }));
        expect(onDismiss).toHaveBeenCalled();
    });

    it('"While you were away" renders nothing when there is nothing unread', () => {
        const { container } = render(<WhileYouWereAway items={feed.map((n) => ({ ...n, unread: false }))} onOpen={() => {}} onDismiss={() => {}} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('the bell shows a count, marks seen on open, and navigates on click', () => {
        const onOpen = vi.fn();
        const onItemClick = vi.fn();
        render(<NotificationBell items={feed} unread={2} pendingPosts={1} onOpen={onOpen} onItemClick={onItemClick} />);
        expect(screen.getByTestId('notification-badge')).toHaveTextContent('3');
        fireEvent.click(screen.getByTestId('notification-bell'));
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/1 post waiting for your approval/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('Your new weekly report is ready'));
        expect(onItemClick).toHaveBeenCalledWith(feed[1]);
    });
});

// -------------------------------------------------- nudges: yesterday ----

describe('"Yesterday" strip — overnight numbers', () => {
    it('shows the four tiles with deltas and the positive / negative split', () => {
        render(
            <YesterdayView
                last={{ date: '2026-08-18', source: 'google', rating: 4.5, reviewCount: 905, newReviews: 3, photoCount: 41 }}
                prev={{ date: '2026-08-17', source: 'google', rating: 4.6, reviewCount: 902, newReviews: 1, photoCount: 40 }}
                reviews={{ date: '2026-08-18', ratingBefore: 4.6, ratingAfter: 4.5, themesTrending: [], newReviews: [
                    { rating: 5, text: 'Great', time: 't', source: 'google' },
                    { rating: 4, text: 'Good', time: 't', source: 'google' },
                    { rating: 1, text: 'Cold', time: 't', source: 'google' },
                ] }}
            />,
        );
        expect(screen.getByTestId('yesterday')).toBeInTheDocument();
        expect(screen.getByText('2 positive · 1 negative')).toBeInTheDocument();
        expect(screen.getByText('-0.1 vs day before')).toBeInTheDocument();
        expect(screen.getByText('+3 vs day before')).toBeInTheDocument();
    });

    it('says so when nothing changed, and when there is no check yet', () => {
        const same = { date: '2026-08-18', source: 'google' as const, rating: 4.5, reviewCount: 905, newReviews: 0, photoCount: 41 };
        const { rerender } = render(<YesterdayView last={same} prev={{ ...same, date: '2026-08-17' }} reviews={null} />);
        expect(screen.getByText(/Nothing changed overnight/)).toBeInTheDocument();
        rerender(<YesterdayView last={null} prev={null} reviews={null} />);
        expect(screen.getByTestId('yesterday-empty')).toBeInTheDocument();
    });
});

// ---------------------------------------------- nudges: action progress ----

describe('action-plan progress — the commitment loop', () => {
    it('ticks an action, updates "N of 5 done", and persists', async () => {
        vi.mocked(intelligenceAPI.getActionProgress).mockResolvedValue({ reportId: DEMO_INTELLIGENCE_REPORT._id, done: [2] });
        render(<V1Overview report={DEMO_INTELLIGENCE_REPORT} onNavigate={() => {}} />);
        await waitFor(() => expect(screen.getByTestId('action-progress')).toHaveTextContent('1 of 5 done'));

        fireEvent.click(screen.getByLabelText(/^Done: \[SAMPLE\] Publish a custom-domain ordering website/));
        expect(screen.getByTestId('action-progress')).toHaveTextContent('2 of 5 done');
        await waitFor(() => expect(intelligenceAPI.putActionProgress).toHaveBeenCalledWith(DEMO_INTELLIGENCE_REPORT._id, [1, 2]));
    });
});

// ------------------------------------------------- reply drafting ----

describe('"Draft a reply" — the follow-through for a review', () => {
    it('drafts, shows an editable AI-labelled reply, and copies it', async () => {
        vi.mocked(intelligenceAPI.draftReply).mockResolvedValue({ reply: 'So sorry about the wait — we have added a Friday rider. Please give us another chance. — The owner', stance: 'apology' });
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        render(<ReviewCard review={{ rating: 1, text: 'Delivery took forever on Friday', time: 't', source: 'google' }} />);
        fireEvent.click(screen.getByRole('button', { name: /Draft a reply/i }));
        expect(await screen.findByTestId('reply-draft')).toBeInTheDocument();
        expect(intelligenceAPI.draftReply).toHaveBeenCalledWith({ text: 'Delivery took forever on Friday', rating: 1 });
        expect(screen.getByText(/Suggested reply · apology/)).toBeInTheDocument();
        expect(screen.getByText('AI estimate')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Copy reply/i }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Friday rider')));
    });

    it('offers a thank-you for a positive review and surfaces errors', async () => {
        vi.mocked(intelligenceAPI.draftReply).mockRejectedValue(new Error('AI service is rate-limited right now'));
        render(<ReviewCard review={{ rating: 5, text: 'Loved the biryani', time: 't', source: 'google' }} />);
        fireEvent.click(screen.getByRole('button', { name: /Draft a thank-you/i }));
        expect(await screen.findByText(/rate-limited/)).toBeInTheDocument();
    });
});

// -------------------------------------------------- overview declutter ----

describe('Overview — one headline, the plan, and a "Full report" disclosure', () => {
    it('keeps findings, threats and the 90-day verdict behind Full report', async () => {
        render(<V1Overview report={DEMO_INTELLIGENCE_REPORT} onNavigate={() => {}} />);
        expect(screen.getByText('The headline')).toBeInTheDocument();
        expect(screen.queryByTestId('full-report')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('full-report-toggle'));
        expect(screen.getByTestId('full-report')).toBeInTheDocument();
        expect(screen.getByText('Watch out for')).toBeInTheDocument();
        expect(screen.getByText('The next 90 days')).toBeInTheDocument();
    });
});

// ------------------------------------------- rivals-you-track digest ----

describe('rivals you track — the week at their tables', () => {
    const digest: RivalDigest = {
        placeId: 'p-m', name: 'Meghana',
        latest: { date: '2026-08-18', rating: 4.4, reviewCount: 5432 },
        yesterday: { date: '2026-08-18', total: 3, positive: 2, negative: 1 },
        week: { total: 12, positive: 9, negative: 2 },
        positiveComments: [{ rating: 5, text: 'Outstanding biryani', date: '2026-08-18' }],
        negativeComments: [{ rating: 1, text: 'AC broken, 45 min wait', date: '2026-08-17' }],
        aheadOnRating: true,
    };

    it('shows day/week splits and the actual comments, negatives first', () => {
        render(<RivalDigestBlock d={digest} />);
        expect(screen.getByText(/Yesterday:/)).toBeInTheDocument();
        expect(screen.getByText(/This week:/)).toBeInTheDocument();
        // Negative tab opens by default when negatives exist.
        expect(screen.getByText(/AC broken, 45 min wait/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /What their guests loved/ }));
        expect(screen.getByText(/Outstanding biryani/)).toBeInTheDocument();
    });

    it('is honest before the first nightly check', () => {
        render(<RivalDigestBlock d={{ ...digest, latest: undefined, yesterday: { date: null, total: 0, positive: 0, negative: 0 }, week: { total: 0, positive: 0, negative: 0 }, positiveComments: [], negativeComments: [] }} />);
        expect(screen.getByTestId('digest-empty-p-m')).toHaveTextContent(/tonight/);
    });
});

// ------------------------------------------- biggest rivals: beats-you line ----

describe('biggest rivals — the one-sentence verdict per row', () => {
    const base = { rating: 4.1, totalRatings: 85722, photoCount: 10 };
    const rival = (over: object) => ({
        placeId: 'x', name: 'X', address: '', rating: 4.0, totalRatings: 100, distanceKm: 1, lat: 0, lng: 0,
        priceLevel: 2, photoCount: 0, cuisine: 'Indian', threatScore: 50, sameCuisineThreatScore: 50, ...over,
    });

    it('names exactly what the rival wins on', () => {
        expect(beatsYouLine(rival({ rating: 4.3, photoCount: 200 }), base)).toBe('Beats you on rating (4.3 vs 4.1) · 190 more photos');
        expect(beatsYouLine(rival({}), base)).toBe('You lead on rating, reviews and photos');
        expect(beatsYouLine(rival({}), undefined)).toBeNull();
    });
});
