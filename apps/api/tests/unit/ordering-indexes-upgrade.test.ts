/**
 * ensureOrderingIndexes menu_items unique-upgrade path (DESIGN-03 §G1).
 *
 * Runs against the shared in-memory MongoDB (tests/setup.ts). Verifies:
 *   1. fresh collection          -> unique (restaurantId, name) index created
 *   2. pre-existing NON-unique   -> dropped + recreated as unique (no dup data)
 *   3. legacy duplicate rows     -> falls back to NON-unique + warns + boot OK
 *
 * The legacy-duplicate case is the point of the brief: startup must NEVER crash
 * over pre-existing duplicate menu-item names.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { ensureOrderingIndexes, getDB } from '@restropulse/db';
import { createLogger } from '@restropulse/telemetry/server';

const NAME_KEY = { restaurantId: 1, name: 1 };

async function nameIndex(): Promise<{ name: string; unique?: boolean } | undefined> {
    const indexes = await getDB().collection('menu_items').indexes();
    return indexes.find(
        (ix) => JSON.stringify(ix.key) === JSON.stringify(NAME_KEY),
    ) as { name: string; unique?: boolean } | undefined;
}

async function resetMenuItems(): Promise<void> {
    try {
        await getDB().collection('menu_items').drop();
    } catch {
        // Collection may not exist yet — ignore.
    }
}

beforeEach(async () => {
    await resetMenuItems();
});

describe('ensureOrderingIndexes — menu_items unique upgrade', () => {
    test('fresh collection: creates a UNIQUE (restaurantId, name) index', async () => {
        await ensureOrderingIndexes(getDB());

        const ix = await nameIndex();
        expect(ix).toBeDefined();
        expect(ix?.unique).toBe(true);
    });

    test('pre-existing NON-unique index: upgraded to unique', async () => {
        await getDB().collection('menu_items').createIndex(NAME_KEY);
        const before = await nameIndex();
        expect(before?.unique).toBeUndefined();

        await ensureOrderingIndexes(getDB());

        const after = await nameIndex();
        expect(after).toBeDefined();
        expect(after?.unique).toBe(true);
    });

    test('legacy duplicate rows: falls back to NON-unique, warns, boot succeeds', async () => {
        const col = getDB().collection('menu_items');
        await col.createIndex(NAME_KEY); // non-unique
        await col.insertMany([
            { restaurantId: 'r1', name: 'Paneer Tikka', createdAt: new Date() },
            { restaurantId: 'r1', name: 'Paneer Tikka', createdAt: new Date() },
        ]);

        const warn = createLogger('db:ordering').warn as unknown as { mockClear: () => void };
        warn.mockClear();

        // Must NOT throw despite the duplicate data.
        await expect(ensureOrderingIndexes(getDB())).resolves.toBeUndefined();

        // Index preserved for query perf, but stays NON-unique.
        const ix = await nameIndex();
        expect(ix).toBeDefined();
        expect(ix?.unique).toBeUndefined();

        // Warned, naming the remediation command.
        expect(createLogger('db:ordering').warn).toHaveBeenCalledWith(
            expect.anything(),
            expect.stringContaining('dedupe-menu-items'),
        );
    });
});
