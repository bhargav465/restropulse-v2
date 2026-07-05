import chalk from 'chalk';
import ora from 'ora';
import { connect, getConfig, disconnect } from '../config/database.js';
import { getResolvedEnv, requireNonDevConfirmation } from '../lib/env.js';
import { SEED_DATA } from '../data/seedData.js';
import { COLLECTIONS } from '../schemas/collections.js';

interface SeedOptions {
    clean?: boolean;
}

export async function seedCommand(options: SeedOptions): Promise<void> {
    if (options.clean) {
        const env = getResolvedEnv();
        if (env === 'development') {
            // 5-second countdown
            console.log(chalk.yellow('\n  WARNING: --clean will delete all existing data.\n'));
            for (let i = 5; i > 0; i--) {
                process.stdout.write(chalk.yellow(`  Proceeding in ${i}s... (Ctrl+C to cancel)\r`));
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            console.log();
        } else {
            await requireNonDevConfirmation('seed --clean');
        }
    }

    const config = getConfig();
    const spinner = ora();

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        console.log(chalk.cyan(`\nSeeding database: ${chalk.bold(config.database)}`));

        // Ensure indexes exist before seeding
        spinner.start('Ensuring indexes exist...');
        for (const schema of COLLECTIONS) {
            const col = db.collection(schema.name);
            for (const index of schema.indexes) {
                try {
                    await col.createIndex(index.spec, index.options || {});
                } catch (err: any) {
                    // Ignore "index already exists" errors
                    if (err.code !== 85 && err.code !== 86) {
                        console.log(chalk.yellow(`\n    Warning: Could not create index on ${schema.name}: ${err.message}`));
                    }
                }
            }
        }
        spinner.succeed('Indexes verified');

        if (options.clean) {
            spinner.start('Clearing existing data...');
            for (const collectionName of Object.keys(SEED_DATA)) {
                try {
                    await db.collection(collectionName).deleteMany({});
                } catch (err) {
                    // Collection might not exist
                }
            }
            spinner.succeed('Cleared existing data');
        }

        // Seed each collection
        for (const [collectionName, documents] of Object.entries(SEED_DATA)) {
            if (!documents || documents.length === 0) continue;

            spinner.start(`Seeding: ${collectionName}`);

            try {
                const col = db.collection(collectionName);

                // Add timestamps
                const docsWithTimestamps = documents.map(doc => ({
                    ...doc,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }));

                // Use upsert to avoid duplicates
                for (const doc of docsWithTimestamps) {
                    if (doc._id) {
                        await col.replaceOne(
                            { _id: doc._id },
                            doc,
                            { upsert: true }
                        );
                    } else {
                        await col.insertOne(doc);
                    }
                }

                spinner.succeed(`Seeded ${collectionName}: ${documents.length} document(s)`);
            } catch (err: any) {
                spinner.fail(`Failed to seed ${collectionName}: ${err.message}`);
            }
        }

        console.log(chalk.green('\nSeeding complete!'));

        // Show summary
        console.log(chalk.cyan('\n--- Data Summary ---'));
        for (const [collectionName] of Object.entries(SEED_DATA)) {
            const count = await db.collection(collectionName).countDocuments();
            console.log(chalk.gray(`  ${collectionName}: ${count} documents`));
        }

    } catch (err: any) {
        spinner.fail('Seeding failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}
