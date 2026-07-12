import { describe, it, expect, beforeEach } from 'vitest';
import { getIntelligenceReportsCollection, MAX_REPORTS_PER_RESTAURANT } from '@restropulse/db';
import { pruneReports } from '../../src/prune.js';
import { makeReport } from '../fixtures.js';

async function seedReports(restaurantId: string, count: number): Promise<void> {
    const col = getIntelligenceReportsCollection();
    for (let i = 0; i < count; i++) {
        const report = makeReport({
            restaurantId,
            _id: `${restaurantId}-r${i}`,
            generatedAt: new Date(Date.UTC(2026, 0, 1 + i)), // ascending
        });
        await col.insertOne(report as unknown as Record<string, unknown>);
    }
}

describe('pruneReports', () => {
    beforeEach(async () => {
        await getIntelligenceReportsCollection().deleteMany({});
    });

    it('keeps only the newest MAX_REPORTS_PER_RESTAURANT (12) and deletes the rest', async () => {
        await seedReports('rest-A', 15);
        const deleted = await pruneReports('rest-A');
        expect(deleted).toBe(3);

        const remaining = await getIntelligenceReportsCollection().find({ restaurantId: 'rest-A' }).toArray();
        expect(remaining).toHaveLength(MAX_REPORTS_PER_RESTAURANT);

        // The survivors are the newest 12 (r3..r14); the 3 oldest are gone.
        const ids = remaining.map((r) => r._id).sort();
        expect(ids).not.toContain('rest-A-r0');
        expect(ids).not.toContain('rest-A-r1');
        expect(ids).not.toContain('rest-A-r2');
        expect(ids).toContain('rest-A-r14');
    });

    it('deletes nothing when at or below the cap', async () => {
        await seedReports('rest-B', MAX_REPORTS_PER_RESTAURANT);
        expect(await pruneReports('rest-B')).toBe(0);
        expect(await getIntelligenceReportsCollection().countDocuments({ restaurantId: 'rest-B' })).toBe(
            MAX_REPORTS_PER_RESTAURANT,
        );
    });

    it('is scoped per restaurant (does not touch other tenants)', async () => {
        await seedReports('rest-C', 14);
        await seedReports('rest-D', 5);
        await pruneReports('rest-C');
        expect(await getIntelligenceReportsCollection().countDocuments({ restaurantId: 'rest-D' })).toBe(5);
    });

    it('is idempotent (second run deletes nothing)', async () => {
        await seedReports('rest-E', 20);
        expect(await pruneReports('rest-E')).toBe(8);
        expect(await pruneReports('rest-E')).toBe(0);
    });
});
