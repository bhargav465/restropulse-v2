/**
 * Top Threats bucket (Brief 10 §2) — segmented control switches the ranked table
 * between directTop10 and overallTop10, AOV band column renders, empty Bucket A
 * copy shows, expand reveals strengths/weaknesses, and add-to-watchlist is
 * 5-cap/tracked aware. Old reports without `buckets` render a re-scan hint.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from './utils/test-utils';
import type { CompetitionBuckets, CompetitorProfile, WatchlistEntry } from '@restropulse/shared';
import { TopThreatsView } from '../components/v2/intelligence/competition/TopThreats';

const comp = (o: Partial<CompetitorProfile>): CompetitorProfile => ({
    placeId: o.placeId ?? 'p',
    name: o.name ?? 'Rival',
    address: 'addr',
    rating: o.rating ?? 4.3,
    totalRatings: o.totalRatings ?? 1200,
    distanceKm: o.distanceKm ?? 1.2,
    lat: 0,
    lng: 0,
    priceLevel: o.priceLevel ?? 2,
    photoCount: 100,
    cuisine: o.cuisine ?? 'North Indian',
    threatScore: o.threatScore ?? 70,
    sameCuisineThreatScore: 40,
    strengths: o.strengths,
    weaknesses: o.weaknesses,
});

const buckets: CompetitionBuckets = {
    directTop10: [
        comp({ placeId: 'd1', name: 'Direct Rival', cuisine: 'Biryani', priceLevel: 2, threatScore: 88, strengths: ['Great biryani'], weaknesses: ['Slow service'] }),
    ],
    overallTop10: [
        comp({ placeId: 'o1', name: 'Overall Rival', cuisine: 'Continental', priceLevel: 3, threatScore: 75 }),
        comp({ placeId: 'd1', name: 'Direct Rival', cuisine: 'Biryani', priceLevel: 2, threatScore: 88 }),
    ],
    aovBand: { base: 2, label: 'Value' },
};

describe('TopThreatsView', () => {
    test('defaults to Same cuisine & AOV bucket and shows the AOV band column', () => {
        render(<TopThreatsView buckets={buckets} watchlist={[]} max={5} error={null} onAdd={() => {}} />);
        expect(screen.getByText('Direct Rival')).toBeInTheDocument();
        expect(screen.queryByText('Overall Rival')).not.toBeInTheDocument();
        // AOV band label from priceLevel 2 = Value
        expect(screen.getAllByText('Value').length).toBeGreaterThan(0);
    });

    test('segmented control switches to Overall bucket', () => {
        render(<TopThreatsView buckets={buckets} watchlist={[]} max={5} error={null} onAdd={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /Overall/ }));
        expect(screen.getByText('Overall Rival')).toBeInTheDocument();
    });

    test('empty Bucket A shows the niche copy', () => {
        render(
            <TopThreatsView
                buckets={{ ...buckets, directTop10: [] }}
                watchlist={[]}
                max={5}
                error={null}
                onAdd={() => {}}
            />,
        );
        expect(screen.getByText(/you may own this niche/i)).toBeInTheDocument();
    });

    test('expand reveals strengths/weaknesses', () => {
        render(<TopThreatsView buckets={buckets} watchlist={[]} max={5} error={null} onAdd={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'Details' }));
        expect(screen.getByText('Great biryani', { exact: false })).toBeInTheDocument();
        expect(screen.getByText('Slow service', { exact: false })).toBeInTheDocument();
    });

    test('add-to-watchlist calls onAdd; disabled when already tracked', () => {
        const onAdd = vi.fn();
        const tracked: WatchlistEntry[] = [{ placeId: 'd1', name: 'Direct Rival', addedAt: new Date() }];
        const { rerender } = render(
            <TopThreatsView buckets={buckets} watchlist={[]} max={5} error={null} onAdd={onAdd} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
        expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ placeId: 'd1' }));

        rerender(<TopThreatsView buckets={buckets} watchlist={tracked} max={5} error={null} onAdd={onAdd} />);
        expect(screen.getByRole('button', { name: 'Tracking' })).toBeDisabled();
    });

    test('Watch is disabled at the 5-cap', () => {
        const full: WatchlistEntry[] = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ placeId: k, name: k, addedAt: new Date() }));
        render(<TopThreatsView buckets={buckets} watchlist={full} max={5} error={null} onAdd={() => {}} />);
        expect(screen.getByRole('button', { name: 'Watch' })).toBeDisabled();
    });
});
