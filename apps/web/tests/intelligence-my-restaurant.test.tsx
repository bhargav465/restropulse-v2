/**
 * My Restaurant bucket (Brief 09 §5): DailyTrends gap/backfilled/zomato-hidden
 * and FeedbackChanges theme-chip filter + negative-trend alert.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from './utils/test-utils';
import { DailyTrendsView } from '../components/v2/intelligence/my-restaurant/DailyTrends';
import { FeedbackChangesView, negativeTrendingThemes } from '../components/v2/intelligence/my-restaurant/FeedbackChanges';
import type { SnapshotSeriesPoint, FeedbackDay } from '../api';

// ---- DailyTrends ----

// Google series with a GAP (2026-06-03 missing) and a backfilled point.
const googlePoints: SnapshotSeriesPoint[] = [
    { date: '2026-06-01', source: 'google', rating: 4.2, reviewCount: 800, newReviews: 3, photoCount: 40, seoScore: 55 },
    { date: '2026-06-02', source: 'google', rating: 4.2, reviewCount: 804, newReviews: 4, photoCount: 40, seoScore: 55, backfilled: true },
    // 2026-06-03 intentionally absent → gap
    { date: '2026-06-04', source: 'google', rating: 4.3, reviewCount: 812, newReviews: 5, photoCount: 40, seoScore: 57 },
];

describe('DailyTrendsView', () => {
    test('renders gaps as breaks, not zeros (fewer markers than day-axis labels)', () => {
        const { container } = render(<DailyTrendsView points={googlePoints} mode="range" onAddZomato={() => {}} />);
        // Day axis spans 2026-06-01..2026-06-04 = 4 labels, but only 3 google points.
        // The rating chart's google line therefore plots 3 markers (gap day omitted),
        // and none sits at rating 0.
        const titles = Array.from(container.querySelectorAll('title')).map((t) => t.textContent ?? '');
        const ratingMarkers = titles.filter((t) => t.startsWith('Google rating'));
        expect(ratingMarkers.length).toBe(3);
        expect(ratingMarkers.some((t) => /· 0\.0/.test(t))).toBe(false);
    });

    test('backfilled points get a hollow marker (title notes backfilled)', () => {
        const { container } = render(<DailyTrendsView points={googlePoints} mode="range" onAddZomato={() => {}} />);
        const titles = Array.from(container.querySelectorAll('title')).map((t) => t.textContent ?? '');
        expect(titles.some((t) => t.includes('(backfilled)'))).toBe(true);
    });

    test('Zomato section hidden without data → shows Add-your-Zomato-numbers card', () => {
        const onAdd = vi.fn();
        render(<DailyTrendsView points={googlePoints} mode="range" onAddZomato={onAdd} />);
        expect(screen.getByRole('heading', { name: 'Add your Zomato numbers' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Add Zomato numbers' }));
        expect(onAdd).toHaveBeenCalled();
    });

    test('Zomato series shown when zomato points exist (no add card)', () => {
        const withZomato: SnapshotSeriesPoint[] = [
            ...googlePoints,
            { date: '2026-06-04', source: 'zomato', rating: 4.1, reviewCount: 300, newReviews: 2, photoCount: 60 },
        ];
        render(<DailyTrendsView points={withZomato} mode="range" onAddZomato={() => {}} />);
        expect(screen.queryByRole('heading', { name: 'Add your Zomato numbers' })).not.toBeInTheDocument();
    });

    test('specific-date mode renders stat cards with day-over-day deltas', () => {
        render(<DailyTrendsView points={googlePoints} mode="date" onAddZomato={() => {}} />);
        expect(screen.getByText('Rating')).toBeInTheDocument();
        expect(screen.getAllByText(/vs prev day/).length).toBeGreaterThan(0);
    });
});

// ---- FeedbackChanges ----

const feedbackDays: FeedbackDay[] = [
    {
        date: '2026-07-10',
        ratingBefore: 4.3,
        ratingAfter: 4.2,
        themesTrending: ['delivery-time'],
        newReviews: [
            { rating: 1, text: '[SAMPLE] Delivery too slow', source: 'google', themes: ['delivery-time'], time: 't1' },
            { rating: 2, text: '[SAMPLE] Cold food on arrival', source: 'google', themes: ['delivery-time'], time: 't2' },
            { rating: 5, text: '[SAMPLE] Great ambience', source: 'google', themes: ['ambience'], time: 't3' },
        ],
    },
    {
        date: '2026-07-09',
        ratingBefore: 4.3,
        ratingAfter: 4.3,
        themesTrending: ['food-quality'],
        newReviews: [{ rating: 5, text: '[SAMPLE] Loved the biryani', source: 'zomato', themes: ['food-quality'], time: 't4' }],
    },
];

describe('FeedbackChangesView', () => {
    test('negativeTrendingThemes flags a theme with ≥2 low-star mentions in 7 days', () => {
        expect(negativeTrendingThemes(feedbackDays)).toContain('delivery-time');
    });

    test('renders the negative-trend alert card', () => {
        render(<FeedbackChangesView days={feedbackDays} onNavigate={() => {}} />);
        expect(screen.getByTestId('negative-trend-alert')).toBeInTheDocument();
    });

    test('theme chip filters the feed to matching reviews', () => {
        render(<FeedbackChangesView days={feedbackDays} onNavigate={() => {}} />);
        // Before filtering, the ambience review is visible.
        expect(screen.getByText('[SAMPLE] Great ambience')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '#delivery-time', pressed: false }));
        // After filtering to #delivery-time, the ambience review is gone.
        expect(screen.queryByText('[SAMPLE] Great ambience')).not.toBeInTheDocument();
        expect(screen.getByText('[SAMPLE] Delivery too slow')).toBeInTheDocument();
    });

    test('Reply now deep-links to Get started', () => {
        const onNavigate = vi.fn();
        render(<FeedbackChangesView days={feedbackDays} onNavigate={onNavigate} />);
        fireEvent.click(screen.getAllByRole('button', { name: /Reply now/ })[0]);
        expect(onNavigate).toHaveBeenCalled();
        expect(onNavigate.mock.calls[0][0].bucket).toBe('GET_STARTED');
        expect(onNavigate.mock.calls[0][0].href).toContain('/admin-v2/get-started');
    });
});
