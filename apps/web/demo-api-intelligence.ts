/**
 * demo-api-intelligence.ts — DEMO twin for the Restaurant Intelligence client.
 *
 * Serves the entire Intelligence UI (both buckets, scan stepper, watchlist
 * edits, Zomato-manual, capture) from in-memory SAMPLE fixtures with zero
 * backend. Ported from the source workspace demo-api.ts intelligence section.
 * P1 wires api.ts -> this twin directly; P2 adds the real fetch-backed client
 * and an isDemoMode() swap.
 */
import type {
    IntelligenceScan,
    ScanStatus,
    PlaceCandidate,
    IntelligenceNotificationsResponse,
    IntelligenceReport,
    IntelligenceReportSummary,
    IntelligenceSelfMetrics,
    CompareRow,
    DailySnapshot,
    WatchlistEntry,
    NearbyPlaceSighting,
} from '@restropulse/shared';
import { WATCHLIST_MAX } from '@restropulse/shared';
import type {
    SnapshotQuery,
    SnapshotSeriesResponse,
    WatchlistResponse,
    WatchlistDigestResponse,
    WatchlistInput,
    CompareQuery,
    FeedbackDay,
    NewOpening,
    ZomatoManualInput,
} from './api';
import { notifyDemoBackendAction } from './lib/demo';

// --- local helpers (kept standalone so this module needs no backend) ---
const delay = (ms = 180): Promise<void> => new Promise((r) => setTimeout(r, ms));
const randomSuffix = (): string => Math.random().toString(36).slice(2, 8);
const clone = <T>(v: T): T =>
    typeof structuredClone !== 'undefined' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
const DEMO_RESTAURANT = { id: 'demo-r1', name: '[SAMPLE] Demo Kitchen' };

// Fake a 3-poll scan completion so the pipeline stepper is exercised.
const intelScanPolls = new Map<string, number>();
let demoNotificationsSeenAt: Date | null = null;
const demoActionProgress = new Map<string, number[]>([['demo-intel-report-0', [1, 2, 4]]]);
const intelFixtures = () => import('./lib/demo-fixtures-intelligence');

export const intelligenceAPI = {
    draftReply: async (review: { text: string; rating: number; author?: string }): Promise<{ reply: string; stance: 'apology' | 'thanks' | 'clarify' }> => {
        await delay(700);
        notifyDemoBackendAction();
        if (review.rating <= 2) {
            return { stance: 'apology', reply: `[SAMPLE] Thank you for telling us — a late Friday delivery is not the experience we want anyone to have. We have added a rider for Friday evenings and are tightening our prep times. Please give us another chance; ask for me when you order. — The owner` };
        }
        return { stance: 'thanks', reply: `[SAMPLE] Thank you so much — we are glad the ${review.text.toLowerCase().includes('naan') ? 'naan' : 'food'} hit the spot. Our team will be delighted to hear this. See you again soon. — The owner` };
    },
    getActionProgress: async (reportId: string): Promise<{ reportId: string; done: number[] }> => {
        await delay(60);
        return { reportId, done: demoActionProgress.get(reportId) ?? [] };
    },
    putActionProgress: async (reportId: string, done: number[]): Promise<{ reportId: string; done: number[] }> => {
        await delay(60);
        notifyDemoBackendAction();
        const cleaned = [...new Set(done)].sort((a, b) => a - b);
        demoActionProgress.set(reportId, cleaned);
        return { reportId, done: cleaned };
    },
    getWatchlistDigest: async (): Promise<WatchlistDigestResponse> => {
        await delay();
        const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
        return {
            hasData: true,
            rivals: [
                {
                    placeId: 'sample-comp-meghana', name: '[SAMPLE] Meghana Foods',
                    latest: { date: day(1), rating: 4.4, reviewCount: 5432 },
                    yesterday: { date: day(1), total: 9, positive: 7, negative: 1 },
                    week: { total: 54, positive: 41, negative: 6 },
                    positiveComments: [
                        { rating: 5, text: '[SAMPLE] Boneless biryani was outstanding, service quick even on a Sunday.', date: day(1) },
                        { rating: 4, text: '[SAMPLE] Consistently good — the raita and salan never miss.', date: day(2) },
                    ],
                    negativeComments: [
                        { rating: 1, text: '[SAMPLE] 45 minutes for a table and the AC was not working.', date: day(3) },
                    ],
                    aheadOnRating: false,
                },
                {
                    placeId: 'sample-comp-empire', name: '[SAMPLE] Empire Restaurant',
                    latest: { date: day(1), rating: 4.1, reviewCount: 8912 },
                    yesterday: { date: day(1), total: 3, positive: 1, negative: 2 },
                    week: { total: 21, positive: 11, negative: 7 },
                    positiveComments: [
                        { rating: 4, text: '[SAMPLE] Great value thali at lunch.', date: day(2) },
                    ],
                    negativeComments: [
                        { rating: 2, text: '[SAMPLE] Delivery order arrived cold twice this month.', date: day(1) },
                        { rating: 1, text: '[SAMPLE] Billing mistake and rude response when we pointed it out.', date: day(4) },
                    ],
                    aheadOnRating: false,
                },
            ],
        };
    },
    getNotifications: async (): Promise<IntelligenceNotificationsResponse> => {
        await delay();
        const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
        const seen = demoNotificationsSeenAt;
        const items = [
            { id: 'reviews:t-1', kind: 'negative_review' as const, severity: 'warning' as const, title: '3 new Google reviews yesterday', body: '2 positive · 1 negative. “[SAMPLE] Delivery took longer than promised on a Friday.” — reply today.', at: day(1), link: { view: 'INTELLIGENCE' as const, bucket: 'MINE' as const, tab: 'FEEDBACK' } },
            { id: 'week:demo', kind: 'new_reviews' as const, severity: 'info' as const, title: 'This week: 11 new reviews — 8 positive, 2 negative', body: '+3 vs last week · negatives 1 → 2.', at: day(1), link: { view: 'INTELLIGENCE' as const, bucket: 'MINE' as const, tab: 'FEEDBACK' } },
            { id: 'report:demo', kind: 'report_ready' as const, severity: 'info' as const, title: 'Your new weekly report is ready', body: 'Score 68/100 (+3) · rank #4 of 38 nearby.', at: day(2), link: { view: 'INTELLIGENCE' as const, bucket: 'MINE' as const, tab: 'OVERVIEW' } },
            { id: 'alert:surge', kind: 'competitor_surge' as const, severity: 'warning' as const, title: '[SAMPLE] Meghana Foods is gaining reviews fast', body: '[SAMPLE] Meghana Foods gained 380 reviews since your last scan.', at: day(2), link: { view: 'INTELLIGENCE' as const, bucket: 'COMPETITION' as const, tab: 'THREATS' } },
            { id: 'alert:new', kind: 'new_competitor' as const, severity: 'info' as const, title: '[SAMPLE] Biryani Blues Express opened near you', body: '[SAMPLE] Biryani Blues Express opened 0.9 km away and is rising fast.', at: day(2), link: { view: 'INTELLIGENCE' as const, bucket: 'COMPETITION' as const, tab: 'OPENINGS' } },
        ].map((n) => ({ ...n, unread: !seen || new Date(n.at) > seen }));
        return { items, unread: items.filter((i) => i.unread).length, seenAt: seen ? seen.toISOString() : null };
    },
    markNotificationsSeen: async (): Promise<{ seenAt: string }> => {
        await delay(60);
        demoNotificationsSeenAt = new Date();
        return { seenAt: demoNotificationsSeenAt.toISOString() };
    },
    searchPlaces: async (query: { name?: string; city?: string } = {}): Promise<PlaceCandidate[]> => {
        await delay();
        const q = (query.name ?? '').trim().toLowerCase();
        // Three plausible matches so the "Is this you?" step has something to choose
        // between; a free-text search that mentions "kitchen" keeps them, anything
        // else returns a single generic match so "search again" visibly does something.
        const all: PlaceCandidate[] = [
            { placeId: 'sample-place-demo-kitchen', name: '[SAMPLE] RestroPulse Demo Kitchen', address: '100 Feet Rd, Indiranagar, Bengaluru', rating: 4.6, totalRatings: 820 },
            { placeId: 'sample-place-demo-kitchen-koramangala', name: '[SAMPLE] RestroPulse Demo Kitchen — Koramangala', address: '5th Block, Koramangala, Bengaluru', rating: 4.3, totalRatings: 212 },
            { placeId: 'sample-place-demo-kitchen-cloud', name: '[SAMPLE] Demo Kitchen Cloud (delivery only)', address: 'CMH Rd, Indiranagar, Bengaluru', rating: 3.9, totalRatings: 64 },
        ];
        if (!q || q.includes('kitchen') || q.includes('demo')) return all;
        return [{ placeId: `sample-place-${q.replace(/\W+/g, '-')}`, name: `[SAMPLE] ${query.name}`, address: `${query.city ?? 'Bengaluru'}`, rating: 4.1, totalRatings: 138 }];
    },
    startScan: async (_body: { name?: string; city?: string; force?: boolean; placeId?: string }): Promise<{ scanId: string }> => {
        await delay();
        notifyDemoBackendAction();
        const scanId = `demo-scan-${randomSuffix()}`;
        intelScanPolls.set(scanId, 0);
        return { scanId };
    },

    getScan: async (scanId: string): Promise<IntelligenceScan> => {
        await delay();
        const n = (intelScanPolls.get(scanId) ?? 0) + 1;
        intelScanPolls.set(scanId, n);
        const { DEMO_INTELLIGENCE_REPORT_ID, DEMO_INTELLIGENCE_RESTAURANT_ID } = await intelFixtures();
        const status: ScanStatus = n >= 3 ? 'COMPLETED' : n === 1 ? 'FETCHING_PLACES' : 'ANALYZING';
        return {
            _id: scanId,
            restaurantId: DEMO_INTELLIGENCE_RESTAURANT_ID,
            query: { name: DEMO_RESTAURANT.name, city: 'Bengaluru' },
            status,
            reportId: status === 'COMPLETED' ? DEMO_INTELLIGENCE_REPORT_ID : undefined,
            requestedBy: 'demo-owner-u1',
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    },

    getActiveScan: async (): Promise<IntelligenceScan | null> => {
        await delay();
        return null;
    },

    getReports: async (): Promise<IntelligenceReportSummary[]> => {
        await delay();
        const { DEMO_INTELLIGENCE_REPORT_SUMMARIES } = await intelFixtures();
        return clone(DEMO_INTELLIGENCE_REPORT_SUMMARIES);
    },

    getReport: async (_reportId: string): Promise<IntelligenceReport> => {
        await delay();
        const { DEMO_INTELLIGENCE_REPORT } = await intelFixtures();
        return clone(DEMO_INTELLIGENCE_REPORT);
    },

    getLatestReport: async (): Promise<IntelligenceReport | null> => {
        await delay();
        const { DEMO_INTELLIGENCE_REPORT } = await intelFixtures();
        return clone(DEMO_INTELLIGENCE_REPORT);
    },

    getSelfMetrics: async (): Promise<IntelligenceSelfMetrics> => {
        await delay();
        const { DEMO_INTELLIGENCE_SELF_METRICS } = await intelFixtures();
        return clone(DEMO_INTELLIGENCE_SELF_METRICS);
    },

    // ----- Intelligence: two-bucket dashboard (fixtures-backed, in-memory mutations) -----

    getWatchlist: async (): Promise<WatchlistResponse> => {
        await delay();
        const { state } = await intelDashboardState();
        return { entries: clone(state.watchlist), max: WATCHLIST_MAX };
    },

    putWatchlist: async (entries: WatchlistInput[]): Promise<WatchlistResponse> => {
        await delay();
        const { state } = await intelDashboardState();
        if (entries.length > WATCHLIST_MAX) {
            throw new Error(`Watchlist exceeds the maximum of ${WATCHLIST_MAX} competitors.`);
        }
        const seen = new Set<string>();
        for (const e of entries) {
            if (!e.placeId) throw new Error('each entry needs a placeId');
            if (seen.has(e.placeId)) throw new Error('watchlist contains duplicate placeIds');
            seen.add(e.placeId);
        }
        const byPlace = new Map(state.watchlist.map((w) => [w.placeId, w.addedAt]));
        state.watchlist = entries.map((e) => ({
            placeId: e.placeId,
            name: e.name?.trim() || e.placeId,
            addedAt: byPlace.get(e.placeId) ?? new Date(),
            ...(e.zomatoUrl?.trim() ? { zomatoUrl: e.zomatoUrl.trim() } : {}),
        }));
        notifyDemoBackendAction();
        return { entries: clone(state.watchlist), max: WATCHLIST_MAX };
    },

    getSnapshots: async (query: SnapshotQuery): Promise<SnapshotSeriesResponse> => {
        await delay();
        const { m, state } = await intelDashboardState();
        const target = query.target ?? 'self';
        const targetPlaceId = target === 'self' ? m.DEMO_SELF_PLACE_ID : target;
        const source = query.source ?? 'both';
        const points = m.deriveSeries(state.snapshots, {
            targetPlaceId,
            source,
            from: query.from,
            to: query.to,
            granularity: query.granularity,
        });
        return { target, source, granularity: query.granularity, points: clone(points) };
    },

    getFeedbackChanges: async (query: { from?: string; to?: string } = {}): Promise<{ days: FeedbackDay[] }> => {
        await delay();
        const { m, state } = await intelDashboardState();
        const to = query.to ?? state.anchor;
        const from = query.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
        return clone(m.deriveFeedbackDays(state.snapshots, from, to));
    },

    getCompare: async (query: CompareQuery): Promise<CompareRow[]> => {
        await delay();
        const { m, state } = await intelDashboardState();
        const value = query.granularity === 'month' ? (query.month ?? state.anchor.slice(0, 7)) : (query.date ?? state.anchor);
        return clone(m.deriveCompareRows(state.snapshots, state.watchlist, DEMO_RESTAURANT.name, query.granularity, value));
    },

    getNewOpenings: async (query: { sinceDays?: 30 | 60 | 90; radiusKm?: number } = {}): Promise<NewOpening[]> => {
        await delay();
        const { m, state } = await intelDashboardState();
        const now = Date.parse(`${state.anchor}T00:00:00.000Z`);
        return clone(m.deriveNewOpenings(state.sightings, query.radiusKm ?? 5, query.sinceDays ?? 30, now));
    },

    postZomatoManual: async (body: ZomatoManualInput): Promise<{ snapshotWritten: boolean }> => {
        await delay();
        const { m, state } = await intelDashboardState();
        const targetPlaceId = !body.target || body.target === 'self' ? m.DEMO_SELF_PLACE_ID : body.target;
        const date = state.anchor;
        state.snapshots = state.snapshots.filter(
            (s) => !(s.targetPlaceId === targetPlaceId && s.source === 'zomato' && s.date === date),
        );
        const snap: DailySnapshot = {
            _id: `snap-${targetPlaceId}-zomato-${date}`,
            restaurantId: DEMO_RESTAURANT.id,
            targetPlaceId,
            isSelf: targetPlaceId === m.DEMO_SELF_PLACE_ID,
            source: 'zomato',
            date,
            rating: body.rating,
            reviewCount: body.reviewCount,
            photoCount: body.photoCount,
            newReviews: [],
            capturedAt: new Date(),
        };
        state.snapshots.push(snap);
        notifyDemoBackendAction();
        return { snapshotWritten: true };
    },

    captureNow: async (): Promise<{ captured: number }> => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const { state } = await intelDashboardState();
        notifyDemoBackendAction();
        return { captured: 2 + state.watchlist.length };
    },
};

// ----- In-memory intelligence dashboard state (lazy; built once per session) -----
type IntelDashboardModule = typeof import('./lib/demo-fixtures-intelligence-dashboard');
interface IntelDashboardState {
    anchor: string;
    snapshots: DailySnapshot[];
    watchlist: WatchlistEntry[];
    sightings: NearbyPlaceSighting[];
}
let intelDashboard: IntelDashboardState | null = null;

async function intelDashboardState(): Promise<{ m: IntelDashboardModule; state: IntelDashboardState }> {
    const m = (await import('./lib/demo-fixtures-intelligence-dashboard')) as IntelDashboardModule;
    if (!intelDashboard) {
        const anchor = m.todayStr();
        intelDashboard = {
            anchor,
            snapshots: m.buildSnapshots(anchor),
            watchlist: m.buildWatchlist(anchor),
            sightings: m.buildSightings(anchor),
        };
    }
    return { m, state: intelDashboard };
}
