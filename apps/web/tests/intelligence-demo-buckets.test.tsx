/**
 * Demo-mode "both buckets render fully from fixtures, zero backend" (Brief 09 §6).
 * Drives the demo twin (../demo-api) directly — the same client the gh-pages
 * build swaps in — and renders each bucket's leaf views from the derived
 * fixtures, proving the flagship demo path works without any API.
 */
import { describe, test, expect } from 'vitest';
import { render, screen } from './utils/test-utils';
import { intelligenceAPI as demo } from '../demo-api';
import { DailyTrendsView } from '../components/v2/intelligence/my-restaurant/DailyTrends';
import { FeedbackChangesView } from '../components/v2/intelligence/my-restaurant/FeedbackChanges';
import { WatchlistView } from '../components/v2/intelligence/competition/Watchlist';
import { CompareView } from '../components/v2/intelligence/competition/Compare';
import { NewOpeningsView } from '../components/v2/intelligence/competition/NewOpenings';

const today = new Date().toISOString().slice(0, 10);

describe('demo fixtures — My Restaurant bucket', () => {
    test('getSnapshots returns a 60-day self series with gaps + backfilled points', async () => {
        const res = await demo.getSnapshots({ target: 'self', source: 'both', granularity: 'day' });
        const google = res.points.filter((p) => p.source === 'google');
        expect(google.length).toBeGreaterThan(40);
        // A gap exists (fewer google days than the calendar span).
        const first = Date.parse(`${google[0].date}T00:00:00Z`);
        const last = Date.parse(`${google[google.length - 1].date}T00:00:00Z`);
        const span = Math.round((last - first) / 86400000) + 1;
        expect(google.length).toBeLessThan(span);
        // Backfilled points are present.
        expect(google.some((p) => p.backfilled)).toBe(true);
        render(<DailyTrendsView points={res.points} mode="range" onAddZomato={() => {}} />);
        expect(screen.getByText('Rating trend')).toBeInTheDocument();
        // Self-zomato absent by default → the add-numbers card shows.
        expect(screen.getByRole('heading', { name: 'Add your Zomato numbers' })).toBeInTheDocument();
    });

    test('postZomatoManual makes the self Zomato series appear live', async () => {
        await demo.postZomatoManual({ rating: 4.3, reviewCount: 500, photoCount: 70 });
        const res = await demo.getSnapshots({ target: 'self', source: 'zomato', granularity: 'day' });
        expect(res.points.some((p) => p.source === 'zomato')).toBe(true);
    });

    test('getFeedbackChanges returns day-grouped self feedback', async () => {
        const res = await demo.getFeedbackChanges();
        expect(res.days.length).toBeGreaterThan(0);
        render(<FeedbackChangesView days={res.days} onNavigate={() => {}} />);
        expect(screen.getByText('Filter by theme')).toBeInTheDocument();
    });
});

describe('demo fixtures — Competition bucket', () => {
    test('getWatchlist seeds 3 competitors under the cap of 5', async () => {
        const wl = await demo.getWatchlist();
        expect(wl.max).toBe(5);
        expect(wl.entries.length).toBe(3);
        render(<WatchlistView cards={wl.entries.map((e) => ({ entry: e }))} candidates={[]} max={wl.max} error={null} onAdd={() => {}} onRemove={() => {}} />);
        expect(screen.getByTestId('watchlist-counter')).toHaveTextContent('3/5');
    });

    test('putWatchlist enforces the 5-cap locally', async () => {
        const six = Array.from({ length: 6 }, (_, i) => ({ placeId: `p${i}`, name: `C${i}` }));
        await expect(demo.putWatchlist(six)).rejects.toThrow(/maximum of 5/);
    });

    test('getCompare returns self + watchlist rows and renders the matrix', async () => {
        const rows = await demo.getCompare({ granularity: 'day', date: today });
        expect(rows.some((r) => r.isSelf)).toBe(true);
        expect(rows.length).toBeGreaterThanOrEqual(2);
        render(<CompareView rows={rows} />);
        expect(screen.getByRole('button', { name: 'Zomato' })).toBeInTheDocument();
    });

    test('getNewOpenings surfaces the recent fast-starters within 5 km', async () => {
        const openings = await demo.getNewOpenings({ sinceDays: 30 });
        expect(openings.length).toBeGreaterThan(0);
        expect(openings.some((o) => o.fastStarter)).toBe(true);
        render(
            <NewOpeningsView openings={openings} sinceDays={30} onSinceDaysChange={() => {}} atCapacity={false} trackedPlaceIds={new Set()} onAdd={() => {}} onNavigate={() => {}} />,
        );
        expect(screen.getByText('New openings within 5 km')).toBeInTheDocument();
    });
});
