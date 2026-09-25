import chalk from 'chalk';
import ora from 'ora';
import { connect, getConfig, disconnect } from '../config/database.js';
import { COLLECTIONS } from '../schemas/collections.js';

export async function setupCommand(): Promise<void> {
    const config = getConfig();
    const spinner = ora();

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        console.log(chalk.cyan(`\nSetting up database: ${chalk.bold(config.database)}`));

        const db = client.db(config.database);

        for (const collection of COLLECTIONS) {
            spinner.start(`Creating collection: ${collection.name}`);

            try {
                // Check if collection exists
                const collections = await db.listCollections({ name: collection.name }).toArray();

                if (collections.length === 0) {
                    // Create collection with validator
                    await db.createCollection(collection.name, {
                        validator: collection.validator,
                        validationLevel: 'moderate',
                        validationAction: 'warn',
                    });
                    spinner.succeed(`Created collection: ${collection.name}`);
                } else {
                    // Update validator on existing collection
                    await db.command({
                        collMod: collection.name,
                        validator: collection.validator,
                        validationLevel: 'moderate',
                        validationAction: 'warn',
                    });
                    spinner.succeed(`Updated collection: ${collection.name}`);
                }

                // Create indexes
                const col = db.collection(collection.name);
                for (const index of collection.indexes) {
                    try {
                        await col.createIndex(index.spec, index.options || {});
                    } catch (indexError: any) {
                        if (indexError.code !== 85) { // Index already exists with different options
                            throw indexError;
                        }
                    }
                }
                console.log(chalk.gray(`    Created ${collection.indexes.length} index(es)`));

            } catch (err: any) {
                spinner.fail(`Failed to create collection: ${collection.name}`);
                console.error(chalk.red(`    Error: ${err.message}`));
            }
        }

        console.log(chalk.green('\nDatabase setup complete!'));

    } catch (err: any) {
        spinner.fail('Setup failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}
