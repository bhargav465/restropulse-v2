import chalk from 'chalk';
import ora from 'ora';
import { connect, getConfig, disconnect } from '../config/database.js';
import {
    ensureIntelligenceIndexes,
    assertWatchlistSize,
    INTELLIGENCE_SNAPSHOTS_DEMO_SEED,
    DEMO_SNAPSHOTS_RESTAURANT_ID,
    DEMO_WATCHLIST,
    DEMO_SELF_ZOMATO_URL,
    DEMO_SNAPSHOT_COUNTS,
} from '@restropulse/db';

/**
 * Seeds the Intelligence v2 demo data (daily snapshots + nearby sightings) for
 * restaurant "demo-r1", and writes the demo watchlist + self Zomato URL onto
 * the restaurant document. All sample docs live in
 * packages/db/src/seeds/intelligence-snapshots-demo.ts. Upserts by _id, so it
 * is safe to run repeatedly.
 */
export async function seedIntelligenceSnapshotsCommand(): Promise<void> {
    const config = getConfig();
    const spinner = ora();

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        console.log(chalk.cyan(`\nSeeding intelligence v2 snapshots into: ${chalk.bold(config.database)}`));

        spinner.start('Ensuring intelligence indexes...');
        await ensureIntelligenceIndexes(db);
        spinner.succeed('Intelligence indexes verified');

        for (const [collectionName, documents] of Object.entries(INTELLIGENCE_SNAPSHOTS_DEMO_SEED)) {
            spinner.start(`Seeding: ${collectionName}`);
            const col = db.collection(collectionName);

            for (const doc of documents) {
                await col.replaceOne({ _id: doc._id as any }, doc, { upsert: true });
            }

            spinner.succeed(`Seeded ${collectionName}: ${documents.length} document(s)`);
        }

        spinner.start('Writing demo watchlist onto the restaurant...');
        assertWatchlistSize(DEMO_WATCHLIST);
        await db.collection('restaurants').updateOne(
            { _id: DEMO_SNAPSHOTS_RESTAURANT_ID as any },
            { $set: { intelligence: { watchlist: DEMO_WATCHLIST, selfZomatoUrl: DEMO_SELF_ZOMATO_URL } } },
            { upsert: false },
        );
        spinner.succeed(`Watchlist written: ${DEMO_WATCHLIST.length} competitor(s)`);

        console.log(chalk.green('\nIntelligence v2 snapshot seed complete!'));
        console.log(chalk.cyan('\n--- Demo intelligence v2 data ---'));
        console.log(chalk.gray(`  Restaurant   : ${DEMO_SNAPSHOTS_RESTAURANT_ID}`));
        console.log(chalk.gray(`  Snapshots    : ${DEMO_SNAPSHOT_COUNTS.snapshotsTotal}`));
        console.log(chalk.gray(`  Sightings    : ${DEMO_SNAPSHOT_COUNTS.nearbySightings}`));
        console.log(chalk.gray(`  Watchlist    : ${DEMO_SNAPSHOT_COUNTS.watchlist}`));
    } catch (err) {
        spinner.fail('Intelligence v2 snapshot seed failed');
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}
