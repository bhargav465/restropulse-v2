import { describe, test, expect } from 'vitest';
import {
    buildCohorts,
    computeCohorts,
    COHORT_CATALOG,
    DROP_OFF_WINDOW_DAYS,
    LAPSED_WINDOW_DAYS,
} from '../../src/services/ordering/cohorts.js';

const NOW = new Date('2026-07-05T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * DAY_MS).toISOString();

describe('computeCohorts', () => {
    test('empty inputs produce all-zero cohorts', () => {
        expect(computeCohorts([], [], [], NOW)).toEqual({
            drop_off_cart: 0,
            non_transacted: 0,
            lapsed_30d: 0,
        });
    });

    describe('drop_off_cart (session-scoped, last 7 days)', () => {
        test('counts unique sessions with cart intent and no order_placed', () => {
            const events = [
                { name: 'add_to_cart', sessionId: 's1', ts: daysAgo(1) },
                { name: 'begin_checkout', sessionId: 's1', ts: daysAgo(1) }, // same session — counted once
                { name: 'begin_checkout', sessionId: 's2', ts: daysAgo(2) },
                { name: 'add_to_cart', sessionId: 's3', ts: daysAgo(3) },
                { name: 'order_placed', sessionId: 's3', ts: daysAgo(3) },   // s3 converted
                { name: 'menu_view', sessionId: 's4', ts: daysAgo(1) },      // browsing only — not a cart
            ];
            const counts = computeCohorts(events, [], [], NOW);
            expect(counts.drop_off_cart).toBe(2); // s1 + s2
        });

        test('ignores cart events outside the drop-off window', () => {
            const events = [
                { name: 'add_to_cart', sessionId: 'old', ts: daysAgo(DROP_OFF_WINDOW_DAYS + 1) },
                { name: 'add_to_cart', sessionId: 'fresh', ts: daysAgo(DROP_OFF_WINDOW_DAYS - 1) },
            ];
            expect(computeCohorts(events, [], [], NOW).drop_off_cart).toBe(1);
        });

        test('ignores events with missing sessionId or invalid timestamps', () => {
            const events = [
                { name: 'add_to_cart', sessionId: '', ts: daysAgo(1) },
                { name: 'add_to_cart', sessionId: 's1', ts: 'not-a-date' },
            ];
            expect(computeCohorts(events, [], [], NOW).drop_off_cart).toBe(0);
        });
    });

    describe('non_transacted + lapsed_30d (customer-scoped)', () => {
        const customers = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }];

        test('splits customers into never-ordered vs lapsed vs active', () => {
            const orders = [
                { customerId: 'c1', createdAt: daysAgo(2) },                        // active
                { customerId: 'c2', createdAt: daysAgo(LAPSED_WINDOW_DAYS + 5) },   // lapsed
                { customerId: 'c2', createdAt: daysAgo(LAPSED_WINDOW_DAYS + 20) },  // older order — latest wins
                // c3, c4 never ordered
            ];
            const counts = computeCohorts([], orders, customers, NOW);
            expect(counts.non_transacted).toBe(2); // c3 + c4
            expect(counts.lapsed_30d).toBe(1);     // c2
        });

        test('a recent order rescues a customer from the lapsed cohort (latest order wins)', () => {
            const orders = [
                { customerId: 'c1', createdAt: daysAgo(LAPSED_WINDOW_DAYS + 10) },
                { customerId: 'c1', createdAt: daysAgo(3) }, // came back
            ];
            const counts = computeCohorts([], orders, customers, NOW);
            expect(counts.lapsed_30d).toBe(0);
            expect(counts.non_transacted).toBe(3); // c2, c3, c4
        });

        test('orders from unknown customers do not affect the counts', () => {
            const orders = [{ customerId: 'ghost', createdAt: daysAgo(1) }];
            const counts = computeCohorts([], orders, customers, NOW);
            expect(counts.non_transacted).toBe(4);
            expect(counts.lapsed_30d).toBe(0);
        });
    });
});

describe('buildCohorts', () => {
    test('maps counts onto the owner-facing catalog in order', () => {
        const cohorts = buildCohorts({ drop_off_cart: 34, non_transacted: 58, lapsed_30d: 21 });
        expect(cohorts).toHaveLength(COHORT_CATALOG.length);
        expect(cohorts.map((c) => [c.id, c.count])).toEqual([
            ['drop_off_cart', 34],
            ['non_transacted', 58],
            ['lapsed_30d', 21],
        ]);
        for (const cohort of cohorts) {
            expect(cohort.name).toBeTruthy();
            expect(cohort.emoji).toBeTruthy();
            expect(cohort.description).toBeTruthy();
        }
    });
});
