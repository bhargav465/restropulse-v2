import { describe, test, expect } from 'vitest';
import { buildDigest } from '../../src/services/intelligence/watchlist-digest.js';
import type { DailySnapshot, WatchlistEntry } from '@restropulse/shared';

const entries: WatchlistEntry[] = [
    { placeId: 'p-meghana', name: 'Meghana Foods', addedAt: new Date('2026-08-10') },
    { placeId: 'p-empire', name: 'Empire', addedAt: new Date('2026-08-10') },
];

const snap = (target: string, date: string, rating: number, reviews: Array<[number, string]>): DailySnapshot => ({
    _id: `s-${target}-${date}`,
    restaurantId: 'r1',
    targetPlaceId: target,
    isSelf: false,
    source: 'google',
    date,
    rating,
    reviewCount: 1000,
    photoCount: 50,
    newReviews: reviews.map(([r, text]) => ({ rating: r, text, time: date })),
    capturedAt: new Date(`${date}T02:00:00Z`),
});

describe('buildDigest — rivals you track, day/week reviews + comments', () => {
    test('splits yesterday and the week into positive / negative, with comments', () => {
        const snapshots = [
            snap('p-meghana', '2026-08-13', 4.3, [[5, 'Great biryani'], [2, 'Slow service']]),
            snap('p-meghana', '2026-08-18', 4.4, [[5, 'Outstanding'], [4, 'Good'], [1, 'AC broken']]),
        ];
        const res = buildDigest(entries, snapshots, 4.1);
        expect(res.hasData).toBe(true);

        const m = res.rivals.find((r) => r.placeId === 'p-meghana')!;
        expect(m.latest).toMatchObject({ date: '2026-08-18', rating: 4.4 });
        expect(m.yesterday).toMatchObject({ date: '2026-08-18', total: 3, positive: 2, negative: 1 });
        expect(m.week).toMatchObject({ total: 5, positive: 3, negative: 2 });
        expect(m.positiveComments.map((c) => c.text)).toContain('Outstanding');
        expect(m.negativeComments.map((c) => c.text)).toContain('AC broken');
        expect(m.aheadOnRating).toBe(true);
    });

    test('a rival with no checks yet is present but empty, and hasData reflects the set', () => {
        const res = buildDigest(entries, [snap('p-meghana', '2026-08-18', 4.0, [])], 4.1);
        const e = res.rivals.find((r) => r.placeId === 'p-empire')!;
        expect(e.latest).toBeUndefined();
        expect(e.yesterday.total).toBe(0);
        const m = res.rivals.find((r) => r.placeId === 'p-meghana')!;
        expect(m.aheadOnRating).toBe(false);

        const none = buildDigest(entries, [], 4.1);
        expect(none.hasData).toBe(false);
    });

    test('self and zomato snapshots are ignored', () => {
        const selfSnap = { ...snap('p-self', '2026-08-18', 4.1, [[5, 'mine']]), isSelf: true };
        const zomatoSnap = { ...snap('p-meghana', '2026-08-18', 4.4, [[5, 'z']]), source: 'zomato' as const };
        const res = buildDigest(entries, [selfSnap, zomatoSnap]);
        expect(res.hasData).toBe(false);
    });
});
