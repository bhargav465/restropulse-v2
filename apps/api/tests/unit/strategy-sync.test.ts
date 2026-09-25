import { describe, it, expect, beforeEach } from 'vitest';
import { getContentStrategiesCollection, getStrategyCyclesCollection, ObjectId } from '@restropulse/db';
import { ensureCycleForRestaurant } from '../../src/services/strategy-sync.js';

const TEST_RESTAURANT_ID = 'sync-test-restaurant';

// Billing period helpers
function makePeriod(startMs: number, durationDays = 30): { start: Date; end: Date } {
    const start = new Date(startMs);
    const end = new Date(startMs + durationDays * 86_400_000);
    return { start, end };
}

const MAY_2026_PERIOD = makePeriod(new Date('2026-05-01T00:00:00.000Z').getTime());

describe('ensureCycleForRestaurant', () => {
    beforeEach(async () => {
        const strategiesCol = getContentStrategiesCollection();
        const cyclesCol = getStrategyCyclesCollection();
        await strategiesCol.deleteMany({ restaurantId: TEST_RESTAURANT_ID });
        await cyclesCol.deleteMany({ restaurantId: TEST_RESTAURANT_ID });
    });

    it('creates a cycle when none exists for the billing period', async () => {
        await ensureCycleForRestaurant(TEST_RESTAURANT_ID, 'starter', MAY_2026_PERIOD);

        const cyclesCol = getStrategyCyclesCollection();
        const cycles = await cyclesCol.find({ restaurantId: TEST_RESTAURANT_ID }).toArray();

        expect(cycles).toHaveLength(1);
        expect(cycles[0].status).toBe('PENDING_GENERATION');
        expect(cycles[0].startDate).toBe(MAY_2026_PERIOD.start.toISOString());
        expect(cycles[0].endDate).toBe(MAY_2026_PERIOD.end.toISOString());
    });

    it('creates ContentStrategy if none exists', async () => {
        await ensureCycleForRestaurant(TEST_RESTAURANT_ID, 'growth', MAY_2026_PERIOD);

        const strategiesCol = getContentStrategiesCollection();
        const strategy = await strategiesCol.findOne({ restaurantId: TEST_RESTAURANT_ID });

        expect(strategy).not.toBeNull();
        expect(strategy!.postsPerWeek).toBe(7);
        expect(Array.isArray(strategy!.focusCategories)).toBe(true);
    });

    it('updates postsPerWeek when plan changes', async () => {
        const strategiesCol = getContentStrategiesCollection();
        await strategiesCol.insertOne({
            restaurantId: TEST_RESTAURANT_ID,
            postsPerWeek: 5,
            focusCategories: [],
            bestTime: '10:00',
            nextScheduledDate: '',
            theme: '',
            createdAt: new Date(),
            updatedAt: new Date(),
        } as any);

        await ensureCycleForRestaurant(TEST_RESTAURANT_ID, 'growth', MAY_2026_PERIOD);

        const updated = await strategiesCol.findOne({ restaurantId: TEST_RESTAURANT_ID });
        expect(updated!.postsPerWeek).toBe(7);
    });

    it('is idempotent: calling twice creates only one cycle', async () => {
        await ensureCycleForRestaurant(TEST_RESTAURANT_ID, 'starter', MAY_2026_PERIOD);
        await ensureCycleForRestaurant(TEST_RESTAURANT_ID, 'starter', MAY_2026_PERIOD);

        const cyclesCol = getStrategyCyclesCollection();
        const cycles = await cyclesCol.find({ restaurantId: TEST_RESTAURANT_ID }).toArray();
        expect(cycles).toHaveLength(1);
    });

    it('is idempotent within +-3 day tolerance on startDate', async () => {
        // First call with the base period
        await ensureCycleForRestaurant(TEST_RESTAURANT_ID, 'starter', MAY_2026_PERIOD);

        // Second call with start shifted by +2 days (within tolerance)
        const shiftedPeriod = makePeriod(MAY_2026_PERIOD.start.getTime() + 2 * 86_400_000);
        await ensureCycleForRestaurant(TEST_RESTAURANT_ID, 'starter', shiftedPeriod);

        const cyclesCol = getStrategyCyclesCollection();
        const cycles = await cyclesCol.find({ restaurantId: TEST_RESTAURANT_ID }).toArray();
        expect(cycles).toHaveLength(1);
    });

    it('archives ACTIVE cycles whose endDate is before the billing period start', async () => {
        const cyclesCol = getStrategyCyclesCollection();

        // Insert an ACTIVE cycle that ended before the new billing period starts
        const oldEnd = new Date(MAY_2026_PERIOD.start.getTime() - 86_400_000); // 1 day before start
        const oldStart = new Date(oldEnd.getTime() - 30 * 86_400_000);
        await cyclesCol.insertOne({
            _id: new ObjectId(),
            restaurantId: TEST_RESTAURANT_ID,
            status: 'ACTIVE',
            period: 'April 2026',
            startDate: oldStart.toISOString(),
            endDate: oldEnd.toISOString(),
            plannedPosts: [],
            focus: [],
            summary: '',
            createdAt: new Date(),
            updatedAt: new Date(),
        } as any);

        await ensureCycleForRestaurant(TEST_RESTAURANT_ID, 'starter', MAY_2026_PERIOD);

        const cycles = await cyclesCol.find({ restaurantId: TEST_RESTAURANT_ID }).toArray();
        const historyCycles = cycles.filter(c => c.status === 'HISTORY');
        const activeCycles = cycles.filter(c => c.status === 'PENDING_GENERATION');

        expect(historyCycles).toHaveLength(1);
        expect(activeCycles).toHaveLength(1);
    });

    it('does not archive an ACTIVE cycle that overlaps with the current billing period', async () => {
        const cyclesCol = getStrategyCyclesCollection();

        // Insert an ACTIVE cycle that overlaps (endDate is after billing period start)
        const overlapEnd = new Date(MAY_2026_PERIOD.start.getTime() + 15 * 86_400_000);
        const overlapStart = new Date(MAY_2026_PERIOD.start.getTime() - 5 * 86_400_000);
        await cyclesCol.insertOne({
            _id: new ObjectId(),
            restaurantId: TEST_RESTAURANT_ID,
            status: 'ACTIVE',
            period: 'Overlap Period',
            startDate: overlapStart.toISOString(),
            endDate: overlapEnd.toISOString(),
            plannedPosts: [],
            focus: [],
            summary: '',
            createdAt: new Date(),
            updatedAt: new Date(),
        } as any);

        await ensureCycleForRestaurant(TEST_RESTAURANT_ID, 'starter', MAY_2026_PERIOD);

        const cycles = await cyclesCol.find({ restaurantId: TEST_RESTAURANT_ID }).toArray();
        const historyCycles = cycles.filter(c => c.status === 'HISTORY');

        // The overlapping ACTIVE cycle should NOT be archived
        expect(historyCycles).toHaveLength(0);
    });

    it('maps postsPerWeek correctly: starter=5, growth=7, premium=14, unknown=5', async () => {
        const strategiesCol = getContentStrategiesCollection();

        const tiers: Array<{ slug: string; expected: number }> = [
            { slug: 'starter', expected: 5 },
            { slug: 'growth', expected: 7 },
            { slug: 'premium', expected: 14 },
            { slug: 'unknown-plan', expected: 5 },
        ];

        for (const { slug, expected } of tiers) {
            await strategiesCol.deleteMany({ restaurantId: TEST_RESTAURANT_ID });
            await ensureCycleForRestaurant(TEST_RESTAURANT_ID, slug, MAY_2026_PERIOD);
            const strategy = await strategiesCol.findOne({ restaurantId: TEST_RESTAURANT_ID });
            expect(strategy!.postsPerWeek).toBe(expected);
        }
    });

    it('does not create a new cycle when a PENDING_APPROVAL cycle already exists for the period', async () => {
        const cyclesCol = getStrategyCyclesCollection();

        // Pre-insert a PENDING_APPROVAL cycle for the same period
        await cyclesCol.insertOne({
            _id: new ObjectId(),
            restaurantId: TEST_RESTAURANT_ID,
            status: 'PENDING_APPROVAL',
            period: 'May 2026',
            startDate: MAY_2026_PERIOD.start.toISOString(),
            endDate: MAY_2026_PERIOD.end.toISOString(),
            plannedPosts: [],
            focus: [],
            summary: '',
            createdAt: new Date(),
            updatedAt: new Date(),
        } as any);

        await ensureCycleForRestaurant(TEST_RESTAURANT_ID, 'starter', MAY_2026_PERIOD);

        const cycles = await cyclesCol.find({ restaurantId: TEST_RESTAURANT_ID }).toArray();
        expect(cycles).toHaveLength(1);
        expect(cycles[0].status).toBe('PENDING_APPROVAL');
    });
});
