import chalk from 'chalk';
import ora from 'ora';
import { connect, getConfig, disconnect } from '../config/database.js';
import {
    ensureIntelligenceIndexes,
    INTELLIGENCE_DEMO_SEED,
    DEMO_INTELLIGENCE_RESTAURANT_ID,
    DEMO_INTELLIGENCE_REPORT_ID,
} from '@restropulse/db';

/**
 * Seeds the demo Restaurant Intelligence report (attaches to restaurant "demo-r1").
 * All sample documents live in packages/db/src/seeds/intelligence-demo.ts.
 * Upserts by _id, so it is safe to run repeatedly.
 */
export async function seedIntelligenceCommand(): Promise<void> {
    const config = getConfig();
    const spinner = ora();

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        console.log(chalk.cyan(`\nSeeding intelligence demo data into: ${chalk.bold(config.database)}`));

        spinner.start('Ensuring intelligence indexes...');
        await ensureIntelligenceIndexes(db);
        spinner.succeed('Intelligence indexes verified');

        for (const [collectionName, documents] of Object.entries(INTELLIGENCE_DEMO_SEED)) {
            spinner.start(`Seeding: ${collectionName}`);
            const col = db.collection(collectionName);

            for (const doc of documents) {
                await col.replaceOne({ _id: doc._id as any }, doc, { upsert: true });
            }

            spinner.succeed(`Seeded ${collectionName}: ${documents.length} document(s)`);
        }

        console.log(chalk.green('\nIntelligence demo seed complete!'));
        console.log(chalk.cyan('\n--- Demo intelligence report ---'));
        console.log(chalk.gray(`  Restaurant : ${DEMO_INTELLIGENCE_RESTAURANT_ID}`));
        console.log(chalk.gray(`  Report id  : ${DEMO_INTELLIGENCE_REPORT_ID} (restroScore 68, grade C)`));
    } catch (err) {
        spinner.fail('Intelligence seed failed');
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}
