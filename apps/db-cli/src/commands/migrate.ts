import chalk from 'chalk';
import ora from 'ora';
import { connect, getConfig, disconnect } from '../config/database.js';

/**
 * Migration: subscription-history
 *
 * Transitions the subscriptions collection from a hard unique index on
 * restaurantId to a partial unique index (unique only where endedAt is null).
 * This allows multiple historical subscription records per restaurant while
 * still enforcing at most one active subscription at a time.
 *
 * Steps:
 *   1. Backfill endedAt: null on all existing documents that lack the field
 *   2. Drop the old restaurantId_1 unique index
 *   3. Create the new partial unique index
 */
export async function migrateCommand(options: { migration: string }): Promise<void> {
    const migrations: Record<string, () => Promise<void>> = {
        'subscription-history': migrateSubscriptionHistory,
        'rename-strategy-id-to-cycle-id': migrateRenameStrategyIdToCycleId,
    };

    const run = migrations[options.migration];
    if (!run) {
        console.error(chalk.red(`Unknown migration: "${options.migration}"`));
        console.log(chalk.gray('Available migrations:'));
        for (const name of Object.keys(migrations)) {
            console.log(chalk.gray(`  - ${name}`));
        }
        process.exit(1);
    }

    await run();
}

async function migrateRenameStrategyIdToCycleId(): Promise<void> {
    const config = getConfig();
    const spinner = ora();

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        const col = db.collection('posts');

        spinner.start('Renaming posts.strategyId -> posts.cycleId...');
        const rename = await col.updateMany(
            { strategyId: { $exists: true } },
            [{ $set: { cycleId: '$strategyId' } }, { $unset: 'strategyId' }],
        );
        spinner.succeed(`Renamed on ${rename.modifiedCount} document(s)`);

        spinner.start('Creating compound index { cycleId: 1, scheduledFor: 1 }...');
        await col.createIndex(
            { cycleId: 1, scheduledFor: 1 },
            { name: 'cycleId_1_scheduledFor_1' },
        );
        spinner.succeed('Created compound index: cycleId_1_scheduledFor_1');

        console.log(chalk.green('\nMigration rename-strategy-id-to-cycle-id complete!'));
    } catch (err: any) {
        spinner.fail('Migration failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}

async function migrateSubscriptionHistory(): Promise<void> {
    const config = getConfig();
    const spinner = ora();

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        const col = db.collection('subscriptions');

        // Step 1: backfill endedAt: null on all documents that don't have it
        spinner.start('Backfilling endedAt: null on existing subscription documents...');
        const backfill = await col.updateMany(
            { endedAt: { $exists: false } },
            { $set: { endedAt: null } },
        );
        spinner.succeed(`Backfilled ${backfill.modifiedCount} document(s)`);

        // Step 2: drop the old hard unique index (if it exists)
        spinner.start('Dropping old unique index on restaurantId...');
        try {
            await col.dropIndex('restaurantId_1');
            spinner.succeed('Dropped old restaurantId_1 index');
        } catch (err: any) {
            if (err.codeName === 'IndexNotFound' || err.code === 27) {
                spinner.warn('Old restaurantId_1 index not found — already dropped or never created');
            } else {
                throw err;
            }
        }

        // Step 3: create new partial unique index
        spinner.start('Creating partial unique index on restaurantId where endedAt is null...');
        await col.createIndex(
            { restaurantId: 1 },
            { unique: true, partialFilterExpression: { endedAt: null }, name: 'restaurantId_1_active' },
        );
        spinner.succeed('Created partial unique index: restaurantId_1_active');

        console.log(chalk.green('\nMigration subscription-history complete!'));
        console.log(chalk.gray('  Run "npm run validate" to confirm indexes are in place.'));

    } catch (err: any) {
        spinner.fail('Migration failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}
