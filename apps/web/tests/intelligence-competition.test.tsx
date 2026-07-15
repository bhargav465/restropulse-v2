/**
 * Competition bucket (Brief 09 §5): Watchlist 5-cap + 422 surfacing, Compare
 * source toggle, WhereTheyBeatYou severity sort + empty guard, NewOpenings
 * sinceDays filter + fastStarter + disabled add.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from './utils/test-utils';
import type { CompareRow, WatchlistEntry, MetricGap } from '@restropulse/shared';
import { WatchlistView, type WatchlistCandidate, type WatchlistCardData } from '../components/v2/intelligence/competition/Watchlist';
import { CompareView } from '../components/v2/intelligence/competition/Compare';
import { WhereTheyBeatYouView, rowSeverity } from '../components/v2/intelligence/competition/WhereTheyBeatYou';
import { NewOpeningsView } from '../components/v2/intelligence/competition/NewOpenings';
import type { NewOpening } from '../api';

// ---- Watchlist ----
const entry = (placeId: string, name: string): WatchlistEntry => ({ placeId, name, addedAt: new Date() });
const card = (placeId: string, name: string): WatchlistCardData => ({ entry: entry(placeId, name) });

describe('WatchlistView', () => {
    test('5/5 counter and Add disabled at capacity', () => {
        const cards = ['a', 'b', 'c', 'd', 'e'].map((k) => card(k, `C ${k}`));
        const candidates: WatchlistCandidate[] = [{ placeId: 'x', name: 'New Rival' }];
        render(<WatchlistView cards={cards} candidates={candidates} max={5} error={null} onAdd={() => {}} onRemove={() => {}} />);
        expect(screen.getByTestId('watchlist-counter')).toHaveTextContent('5/5');
        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    });

    test('surfaces a server 422 message', () => {
        render(
            <WatchlistView
                cards={[]}
                candidates={[]}
                max={5}
                error="Watchlist exceeds the maximum of 5 competitors."
                onAdd={() => {}}
                onRemove={() => {}}
            />,
        );
        expect(screen.getByRole('alert')).toHaveTextContent(/maximum of 5 competitors/);
    });
});

// ---- Compare ----
const src = (rating: number, reviews: number, nw: number, photos: number) => ({ rating, reviewCount: reviews, newReviews: nw, photoCount: photos });
const rows: CompareRow[] = [
    { placeId: 'self', name: 'Demo Kitchen', isSelf: true, google: src(4.4, 820, 5, 46), zomato: src(4.3, 320, 2, 60), beatsYou: [] },
    {
        placeId: 'c1', name: 'Meghana', isSelf: false, google: src(4.6, 5400, 9, 640), zomato: src(4.5, 1400, 4, 260),
        beatsYou: [{ metric: 'rating', source: 'google', yours: 4.4, theirs: 4.6, gap: 0.2 }],
    },
];

describe('CompareView', () => {
    test('source toggle switches the displayed numbers', () => {
        render(<CompareView rows={rows} />);
        // Google (default): self rating 4.4 shown.
        expect(screen.getAllByText('4.4').length).toBeGreaterThan(0);
        // Toggle to Zomato → self zomato rating 4.3 appears.
        fireEvent.click(screen.getByRole('button', { name: 'Zomato', pressed: false }));
        expect(screen.getAllByText('4.3').length).toBeGreaterThan(0);
    });

    test('Both mode renders google and zomato side by side', () => {
        render(<CompareView rows={rows} />);
        fireEvent.click(screen.getByRole('button', { name: 'Both' }));
        // Slash separators appear between the two sources.
        expect(screen.getAllByText('/').length).toBeGreaterThan(0);
    });
});

// ---- WhereTheyBeatYou ----
describe('WhereTheyBeatYouView', () => {
    const bigGap: MetricGap = { metric: 'reviewVelocity', source: 'google', yours: 1, theirs: 5, gap: 4 };
    const smallGap: MetricGap = { metric: 'rating', source: 'google', yours: 4.4, theirs: 4.5, gap: 0.1 };
    const compareRows: CompareRow[] = [
        { placeId: 'self', name: 'You', isSelf: true, beatsYou: [] },
        { placeId: 'small', name: 'Small Threat', isSelf: false, beatsYou: [smallGap] },
        { placeId: 'big', name: 'Big Threat', isSelf: false, beatsYou: [bigGap] },
    ];

    test('sorts cards by summed gap severity (most severe first)', () => {
        render(<WhereTheyBeatYouView rows={compareRows} profilesByName={{}} onNavigate={() => {}} />);
        const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
        expect(headings.indexOf('Big Threat')).toBeLessThan(headings.indexOf('Small Threat'));
        expect(rowSeverity(compareRows[2])).toBeGreaterThan(rowSeverity(compareRows[1]));
    });

    test('renders nothing but a message when no competitor beats you', () => {
        render(
            <WhereTheyBeatYouView
                rows={[{ placeId: 'self', name: 'You', isSelf: true, beatsYou: [] }]}
                profilesByName={{}}
                onNavigate={() => {}}
            />,
        );
        expect(screen.getByText(/No competitor is beating you/)).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    });

    test('Close this gap deep-links by top gap type', () => {
        const onNavigate = vi.fn();
        render(<WhereTheyBeatYouView rows={compareRows} profilesByName={{}} onNavigate={onNavigate} />);
        fireEvent.click(screen.getAllByRole('button', { name: /Close this gap/ })[0]);
        expect(onNavigate).toHaveBeenCalled();
    });
});

// ---- NewOpenings ----
const opening = (placeId: string, name: string, fast: boolean): NewOpening => ({
    placeId, name, distanceKm: 0.9, cuisine: 'Biryani', firstSeenAt: '2026-07-01T06:00:00.000Z',
    ratingAtFirstSeen: 4.6, reviewsAtFirstSeen: 180, currentReviewCount: 330, reviewsSinceFirstSeen: 150,
    daysSinceFirstSeen: 10, fastStarter: fast,
});

describe('NewOpeningsView', () => {
    test('sinceDays chips call onSinceDaysChange', () => {
        const onSince = vi.fn();
        render(
            <NewOpeningsView openings={[opening('o1', 'Biryani Blues', true)]} sinceDays={30} onSinceDaysChange={onSince} atCapacity={false} trackedPlaceIds={new Set()} onAdd={() => {}} onNavigate={() => {}} />,
        );
        fireEvent.click(screen.getByRole('button', { name: '60d' }));
        expect(onSince).toHaveBeenCalledWith(60);
    });

    test('fastStarter flagged and add disabled at capacity', () => {
        render(
            <NewOpeningsView openings={[opening('o1', 'Biryani Blues', true)]} sinceDays={30} onSinceDaysChange={() => {}} atCapacity={true} trackedPlaceIds={new Set()} onAdd={() => {}} onNavigate={() => {}} />,
        );
        expect(screen.getByText('Fast starter')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add to watchlist' })).toBeDisabled();
    });

    test('empty state copy', () => {
        render(
            <NewOpeningsView openings={[]} sinceDays={90} onSinceDaysChange={() => {}} atCapacity={false} trackedPlaceIds={new Set()} onAdd={() => {}} onNavigate={() => {}} />,
        );
        expect(screen.getByText(/quiet streets are good news/)).toBeInTheDocument();
    });

    test('Draft a response post deep-links to Content', () => {
        const onNavigate = vi.fn();
        render(
            <NewOpeningsView openings={[opening('o1', 'Biryani Blues', false)]} sinceDays={30} onSinceDaysChange={() => {}} atCapacity={false} trackedPlaceIds={new Set()} onAdd={() => {}} onNavigate={onNavigate} />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Draft a response post/ }));
        expect(onNavigate.mock.calls[0][0].bucket).toBe('CONTENT');
    });
});
