import chalk from 'chalk';
import ora from 'ora';
import bcrypt from 'bcryptjs';
import { connect, getConfig, disconnect } from '../config/database.js';
import {
    ensureOrderingIndexes,
    ORDERING_DEMO_SEED,
    DEMO_CUSTOMER_EMAIL,
    DEMO_CUSTOMER_PASSWORD,
    DEMO_OWNER,
} from '@restropulse/db';

const BCRYPT_SALT_ROUNDS = 10;

/**
 * Seeds the demo online-ordering storefront (slug "demo").
 * All sample documents live in packages/db/src/seeds/ordering-demo.ts.
 * Upserts by _id, so it is safe to run repeatedly.
 */
export async function seedOrderingCommand(): Promise<void> {
    const config = getConfig();
    const spinner = ora();

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        console.log(chalk.cyan(`\nSeeding ordering demo data into: ${chalk.bold(config.database)}`));

        spinner.start('Ensuring ordering indexes...');
        await ensureOrderingIndexes(db);
        spinner.succeed('Ordering indexes verified');

        spinner.start('Hashing demo customer password...');
        const passwordHash = await bcrypt.hash(DEMO_CUSTOMER_PASSWORD, BCRYPT_SALT_ROUNDS);
        spinner.succeed('Demo customer password hashed');

        for (const [collectionName, documents] of Object.entries(ORDERING_DEMO_SEED)) {
            spinner.start(`Seeding: ${collectionName}`);
            const col = db.collection(collectionName);

            for (const doc of documents) {
                const withMeta: Record<string, unknown> = {
                    ...doc,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
                if (collectionName === 'customers') {
                    withMeta.passwordHash = passwordHash;
                }
                await col.replaceOne({ _id: withMeta._id as any }, withMeta, { upsert: true });
            }

            spinner.succeed(`Seeded ${collectionName}: ${documents.length} document(s)`);
        }

        console.log(chalk.green('\nOrdering demo seed complete!'));
        console.log(chalk.cyan('\n--- Demo storefront ---'));
        console.log(chalk.gray('  Storefront slug : demo  (GET /api/storefront/demo/config)'));
        console.log(chalk.gray(`  Demo owner      : ${DEMO_OWNER.email} (merchant, role OWNER)`));
        console.log(chalk.gray(`  Demo customer   : ${DEMO_CUSTOMER_EMAIL} / ${DEMO_CUSTOMER_PASSWORD} (sample credentials)`));
    } catch (err) {
        spinner.fail('Ordering seed failed');
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}
